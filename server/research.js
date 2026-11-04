import {
  id,
  now,
  stmt,
  all,
  first,
  owned,
  mutate,
  gate,
  gateArgs,
} from "./db.js";
import { getSession, insertMessage } from "./sessions.js";
import { AppError, conflict } from "./errors.js";
import { complete } from "./llm/client.js";
import {
  decomposePrompt,
  researchPrompt,
  synthesisPrompt,
} from "./llm/prompts.js";
import { decomposition, researchOutput, synthesisOutput } from "./schemas.js";
async function runOwned(ctx, rid) {
  const r = await first(
    ctx,
    "SELECT r.* FROM research_runs r JOIN sessions s ON s.id=r.session_id WHERE r.id=? AND s.owner_id=?",
    rid,
    ctx.ownerId,
  );
  if (!r) throw new AppError("NOT_FOUND", "탐색을 찾을 수 없습니다.", 404);
  return r;
}
export async function getResearch(ctx, rid) {
  const r = await runOwned(ctx, rid);
  const steps = await all(
    ctx,
    "SELECT * FROM research_steps WHERE run_id=? ORDER BY position",
    rid,
  );
  const sources = await all(
    ctx,
    "SELECT sources.* FROM sources JOIN research_steps ON research_steps.id=sources.step_id WHERE research_steps.run_id=?",
    rid,
  );
  for (const s of steps) {
    s.sources = sources
      .filter((source) => source.step_id === s.id)
      .map(({ id, title, url }) => ({ id, title, url }));
    s.uncertainties = JSON.parse(s.uncertainties ?? "[]");
    s.error = s.error ? JSON.parse(s.error) : null;
  }
  return {
    id: r.id,
    sessionId: r.session_id,
    declaration: r.declaration,
    status: r.status,
    revision: r.revision,
    activeStepId: r.active_step_id,
    steps: steps.map((s) => ({
      id: s.id,
      position: s.position,
      question: s.question,
      status: s.status,
      result: s.result,
      sources: s.sources,
      uncertainties: s.uncertainties,
      error: s.error,
    })),
    result: r.result ? JSON.parse(r.result) : null,
    error: r.error ? JSON.parse(r.error) : null,
  };
}
export async function listResearch(ctx, sid) {
  await owned(ctx, sid);
  return all(
    ctx,
    "SELECT id,declaration,status FROM research_runs WHERE session_id=? ORDER BY created_at DESC",
    sid,
  );
}
export async function createResearch(
  ctx,
  sid,
  { declaration, expectedRevision },
) {
  const current = await getSession(ctx, sid);
  const rid = id();
  await mutate(ctx, sid, expectedRevision, (t) => [
    stmt(
      ctx,
      `INSERT INTO research_runs (id,session_id,declaration,base_position,created_at) SELECT ?,?,?,?,? WHERE ${gate}`,
      rid,
      sid,
      declaration,
      current.messages.at(-1)?.position ?? -1,
      now(ctx),
      ...gateArgs(ctx, sid, t),
    ),
  ]);
  return getResearch(ctx, rid);
}
const runGate =
  "EXISTS (SELECT 1 FROM research_runs r JOIN sessions s ON s.id=r.session_id WHERE r.id=? AND s.owner_id=? AND r.active_token=? AND r.revision=?)";
async function finish(
  ctx,
  r,
  token,
  claimedRevision,
  ops,
  status,
  { result = null, error = null } = {},
) {
  const args = [r.id, ctx.ownerId, token, claimedRevision];
  const statements = ops(args);
  const release = stmt(
    ctx,
    `UPDATE research_runs SET active_token=NULL,active_step_id=NULL,status=?,result=COALESCE(?,result),error=?,revision=revision+1 WHERE id=? AND active_token=? AND revision=?`,
    status,
    result ? JSON.stringify(result) : null,
    error ? JSON.stringify(error) : null,
    r.id,
    token,
    claimedRevision,
  );
  const out = await ctx.db.batch([...statements, release]);
  if (!out.at(-1).meta.changes) throw conflict();
  return getResearch(ctx, r.id);
}
export async function advanceResearch(ctx, rid, { expectedRevision }) {
  const r = await runOwned(ctx, rid);
  if (["completed", "partial", "paused"].includes(r.status))
    throw new AppError(
      "RESEARCH_STATE",
      "중단된 탐색을 재개하거나 새 탐색을 시작해 주세요.",
      409,
    );
  const current = await getResearch(ctx, rid);
  if (current.steps.some((s) => s.status === "running")) throw conflict();
  const step = current.steps.find((s) => s.status === "pending");
  const kind = !current.steps.length
    ? "decompose"
    : step
      ? "research"
      : "synthesize";
  const token = id(),
    claimedRevision = expectedRevision + 1;
  const claim = await stmt(
    ctx,
    `UPDATE research_runs SET active_token=?,active_step_id=?,status=?,revision=revision+1,error=NULL WHERE id=? AND revision=? AND active_token IS NULL AND EXISTS (SELECT 1 FROM sessions WHERE id=research_runs.session_id AND owner_id=?)`,
    token,
    step?.id ?? null,
    kind === "decompose"
      ? "decomposing"
      : kind === "research"
        ? "researching"
        : "synthesizing",
    rid,
    expectedRevision,
    ctx.ownerId,
  ).run();
  if (!claim.meta.changes) throw conflict();
  try {
    const llmCtx = { ...ctx, sessionId: r.session_id };
    if (kind === "decompose") {
      const { content } = await complete(llmCtx, {
        purpose: "decompose",
        messages: [
          { role: "system", content: decomposePrompt },
          { role: "user", content: r.declaration },
        ],
        schema: decomposition,
      });
      const questions = [...new Set(content.questions.map((s) => s.trim()))];
      const args = [rid, ctx.ownerId, token, claimedRevision];
      const rows = questions.map((question, position) => ({
        id: id(),
        question,
        position,
      }));
      await stmt(
        ctx,
        `INSERT INTO research_steps (id,run_id,position,question) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.position'),json_extract(value,'$.question') FROM json_each(?) WHERE ${runGate}`,
        rid,
        JSON.stringify(rows),
        ...args,
      ).run();
      return await finish(ctx, r, token, claimedRevision, () => [], "ready");
    }
    if (kind === "research") {
      const { content, sources } = await complete(llmCtx, {
        purpose: "research",
        messages: [
          { role: "system", content: researchPrompt },
          {
            role: "user",
            content: JSON.stringify({
              declaration: r.declaration,
              question: step.question,
            }),
          },
        ],
        schema: researchOutput,
        search: true,
      });
      const args = [rid, ctx.ownerId, token, claimedRevision];
      await stmt(
        ctx,
        `INSERT INTO sources (id,step_id,title,url) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.title'),json_extract(value,'$.url') FROM json_each(?) WHERE ${runGate}`,
        step.id,
        JSON.stringify(sources),
        ...args,
      ).run();
      return await finish(
        ctx,
        r,
        token,
        claimedRevision,
        (a) => [
          stmt(
            ctx,
            `UPDATE research_steps SET status='completed',result=?,uncertainties=?,error=NULL WHERE id=? AND ${runGate}`,
            content.answer,
            JSON.stringify(content.uncertainties),
            step.id,
            ...a,
          ),
        ],
        "ready",
      );
    }
    const successes = current.steps.filter((s) => s.status === "completed");
    if (!successes.length)
      throw new AppError(
        "RESEARCH_FAILED",
        "완료된 자료 조사가 없습니다. 실패한 질문을 재시도해 주세요.",
        409,
      );
    const { content } = await complete(llmCtx, {
      purpose: "synthesize",
      messages: [
        { role: "system", content: synthesisPrompt },
        {
          role: "user",
          content: JSON.stringify({
            declaration: r.declaration,
            steps: current.steps,
          }),
        },
      ],
      schema: synthesisOutput,
    });
    const valid = new Set(successes.flatMap((s) => s.sources.map((x) => x.id)));
    if (
      !content.sourceIds.length ||
      content.sourceIds.some((sid) => !valid.has(sid))
    )
      throw new AppError(
        "LLM_FORMAT",
        "통합 응답이 실제 출처를 올바르게 참조하지 않았습니다.",
        502,
      );
    return await finish(
      ctx,
      r,
      token,
      claimedRevision,
      () => [],
      successes.length === current.steps.length ? "completed" : "partial",
      { result: content },
    );
  } catch (e) {
    if (e.status === 409 && e.code === "CONFLICT") throw e;
    const error = {
      code: e.code ?? "RESEARCH_ERROR",
      message:
        e instanceof AppError ? e.message : "탐색을 처리하지 못했습니다.",
      ...(e.details ? { details: e.details } : {}),
    };
    const systemic = [
      "RATE_LIMIT",
      "DAILY_LIMIT",
      "CREDIT_LIMIT",
      "LLM_AUTH",
      "LLM_CONFIG",
      "MODEL_CONFIG",
      "SEARCH_DISABLED",
      "SEARCH_UNSUPPORTED",
    ].includes(error.code);
    const ops = (a) =>
      kind === "research"
        ? [
            stmt(
              ctx,
              `DELETE FROM sources WHERE step_id=? AND ${runGate}`,
              step.id,
              ...a,
            ),
            stmt(
              ctx,
              `UPDATE research_steps SET status='failed',error=? WHERE id=? AND ${runGate}`,
              JSON.stringify(error),
              step.id,
              ...a,
            ),
          ]
        : kind === "decompose"
          ? [
              stmt(
                ctx,
                `DELETE FROM research_steps WHERE run_id=? AND ${runGate}`,
                rid,
                ...a,
              ),
            ]
          : [];
    return finish(
      ctx,
      r,
      token,
      claimedRevision,
      ops,
      kind === "research" && !systemic ? "ready" : "failed",
      { error },
    );
  }
}
export async function pauseResearch(ctx, rid) {
  await runOwned(ctx, rid);
  await stmt(
    ctx,
    "UPDATE research_runs SET status='paused',active_token=NULL,active_step_id=NULL,revision=revision+1 WHERE id=?",
    rid,
  ).run();
  return getResearch(ctx, rid);
}
export async function resumeResearch(ctx, rid, { expectedRevision }) {
  await runOwned(ctx, rid);
  const out = await stmt(
    ctx,
    "UPDATE research_runs SET status=CASE WHEN EXISTS(SELECT 1 FROM research_steps WHERE run_id=?) THEN 'ready' ELSE 'pending' END,active_token=NULL,error=NULL,revision=revision+1 WHERE id=? AND revision=? AND status IN ('paused','failed')",
    rid,
    rid,
    expectedRevision,
  ).run();
  if (!out.meta.changes) throw conflict();
  return getResearch(ctx, rid);
}
export async function retryStep(ctx, rid, stepId, { expectedRevision }) {
  const r = await runOwned(ctx, rid),
    token = id();
  const step = await first(
    ctx,
    "SELECT * FROM research_steps WHERE id=? AND run_id=?",
    stepId,
    rid,
  );
  if (!step || step.status !== "failed")
    throw new AppError("VALIDATION", "실패한 질문을 선택해 주세요.");
  const out = await ctx.db.batch([
    stmt(
      ctx,
      "UPDATE research_runs SET active_token=?,revision=revision+1,status='ready',result=NULL,error=NULL WHERE id=? AND revision=? AND active_token IS NULL",
      token,
      rid,
      expectedRevision,
    ),
    stmt(
      ctx,
      `UPDATE research_steps SET status='pending',error=NULL WHERE id=? AND ${runGate}`,
      stepId,
      rid,
      ctx.ownerId,
      token,
      expectedRevision + 1,
    ),
    stmt(
      ctx,
      "UPDATE research_runs SET active_token=NULL WHERE id=? AND active_token=?",
      r.id,
      token,
    ),
  ]);
  if (!out[0].meta.changes) throw conflict();
  return getResearch(ctx, rid);
}
export async function followup(
  ctx,
  rid,
  { content, allowSearch = false, expectedRevision },
) {
  const r = await getResearch(ctx, rid);
  if (!["completed", "partial"].includes(r.status))
    throw new AppError(
      "RESEARCH_STATE",
      "조사 결과가 나온 뒤 질문해 주세요.",
      409,
    );
  const token = id(),
    sid = r.sessionId;
  await mutate(
    ctx,
    sid,
    expectedRevision,
    (t) => [
      insertMessage(ctx, sid, t, {
        role: "user",
        content,
        mode: "research",
        researchRunId: rid,
      }),
      stmt(
        ctx,
        `UPDATE sessions SET busy_token=? WHERE ${gate}`,
        token,
        ...gateArgs(ctx, sid, t),
      ),
    ],
    { requireIdle: true },
  );
  try {
    const previous = (await getSession(ctx, sid)).messages
      .filter((m) => m.researchRunId === rid)
      .map((m) => ({ role: m.role, content: m.content }));
    const result = await complete(
      { ...ctx, sessionId: sid },
      {
        purpose: "followup",
        messages: [
          {
            role: "system",
            content: `기존 탐색 결과를 참고해 한국어로 답하세요. 새로운 정보가 필요한데 검색이 허용되지 않으면 검색이 필요하다고 안내하세요. JSON {"answer":"답변","uncertainties":[]}만 출력하세요. 기존 자료: ${JSON.stringify(r)}`,
          },
          ...previous,
        ],
        schema: researchOutput,
        search: allowSearch,
      },
    );
    const answer =
      result.content.answer +
      (result.sources.length
        ? "\n\n출처\n" +
          result.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n")
        : "");
    await mutate(
      ctx,
      sid,
      expectedRevision + 1,
      (t) => [
        insertMessage(ctx, sid, t, {
          role: "assistant",
          content: answer,
          mode: "research",
          researchRunId: rid,
        }),
        stmt(
          ctx,
          `UPDATE sessions SET busy_token=NULL WHERE ${gate}`,
          ...gateArgs(ctx, sid, t),
        ),
      ],
      { requireToken: token },
    );
    return getSession(ctx, sid);
  } catch (e) {
    await stmt(
      ctx,
      "UPDATE sessions SET busy_token=NULL,revision=revision+1 WHERE id=? AND owner_id=? AND busy_token=?",
      sid,
      ctx.ownerId,
      token,
    ).run();
    throw e;
  }
}
