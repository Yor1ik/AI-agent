import { id, owned, mutate, stmt, gate, gateArgs } from "./db.js";
import { getSession, insertMessage } from "./sessions.js";
import { AppError } from "./errors.js";
import { complete } from "./llm/client.js";
import { dialoguePrompt } from "./llm/prompts.js";
import { dialogueOutput } from "./schemas.js";
async function release(ctx, sid, token) {
  await stmt(
    ctx,
    "UPDATE sessions SET busy_token=NULL,revision=revision+1 WHERE id=? AND owner_id=? AND busy_token=?",
    sid,
    ctx.ownerId,
    token,
  ).run();
}
export async function sendMessage(ctx, sid, { content, expectedRevision }) {
  const s = await owned(ctx, sid);
  if (s.status === "paused")
    throw new AppError("PAUSED", "문답을 재개한 후 입력해 주세요.", 409);
  const token = id();
  await mutate(
    ctx,
    sid,
    expectedRevision,
    (t) => [
      insertMessage(ctx, sid, t, { role: "user", content }),
      stmt(
        ctx,
        `UPDATE sessions SET busy_token=?,title=CASE WHEN title='새로운 생각' THEN ? ELSE title END WHERE ${gate}`,
        token,
        content.slice(0, 32),
        ...gateArgs(ctx, sid, t),
      ),
    ],
    { requireIdle: true },
  );
  try {
    const current = await getSession(ctx, sid);
    const { content: answer } = await complete(
      { ...ctx, sessionId: sid },
      {
        purpose: "dialogue",
        messages: [
          { role: "system", content: dialoguePrompt },
          ...current.messages
            .filter((m) => m.mode === "dialogue")
            .map((m) => ({ role: m.role, content: m.content })),
        ],
        schema: dialogueOutput,
      },
    );
    await mutate(
      ctx,
      sid,
      expectedRevision + 1,
      (t) => [
        insertMessage(ctx, sid, t, { role: "assistant", content: answer.text }),
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
    await release(ctx, sid, token);
    throw e;
  }
}
export async function regenerate(ctx, sid, { messageId, expectedRevision }) {
  const { messages, session } = await getSession(ctx, sid);
  if (session.status === "paused")
    throw new AppError("PAUSED", "문답을 재개한 후 다시 생성해 주세요.", 409);
  const m = messages.find((x) => x.id === messageId);
  if (!m || m.role !== "assistant" || m.mode !== "dialogue")
    throw new AppError("VALIDATION", "문답 질문을 선택해 주세요.");
  const token = id();
  await mutate(
    ctx,
    sid,
    expectedRevision,
    (t) => [
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
    const { content: answer } = await complete(
      { ...ctx, sessionId: sid },
      {
        purpose: "dialogue",
        messages: [
          {
            role: "system",
            content:
              dialoguePrompt +
              " 같은 사용자 발언을 유지하고 표현이나 검토 유형만 바꾸세요. 새 전제는 금지합니다.",
          },
          ...messages
            .filter((x) => x.mode === "dialogue" && x.position < m.position)
            .map((x) => ({ role: x.role, content: x.content })),
        ],
        schema: dialogueOutput,
      },
    );
    await mutate(
      ctx,
      sid,
      expectedRevision + 1,
      (t) => [
        stmt(
          ctx,
          `DELETE FROM research_runs WHERE session_id=? AND base_position>=? AND ${gate}`,
          sid,
          m.position,
          ...gateArgs(ctx, sid, t),
        ),
        stmt(
          ctx,
          `DELETE FROM messages WHERE session_id=? AND position>? AND ${gate}`,
          sid,
          m.position,
          ...gateArgs(ctx, sid, t),
        ),
        stmt(
          ctx,
          `UPDATE messages SET content=? WHERE id=? AND session_id=? AND ${gate}`,
          answer.text,
          messageId,
          sid,
          ...gateArgs(ctx, sid, t),
        ),
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
    await release(ctx, sid, token);
    throw e;
  }
}
export async function cancelGeneration(ctx, sid, { expectedRevision }) {
  await owned(ctx, sid);
  await mutate(ctx, sid, expectedRevision, (t) => [
    stmt(
      ctx,
      `UPDATE sessions SET busy_token=NULL,graph_busy_token=NULL WHERE ${gate}`,
      ...gateArgs(ctx, sid, t),
    ),
  ]);
  return getSession(ctx, sid);
}
export async function continueDialogue(ctx, sid, { expectedRevision }) {
  const { session, messages } = await getSession(ctx, sid);
  const conversation = messages.filter((m) => m.mode === "dialogue");
  if (session.status === "paused" || conversation.at(-1)?.role !== "user")
    throw new AppError("VALIDATION", "답변 대기 중인 내 발언이 없습니다.");
  const token = id();
  await mutate(
    ctx,
    sid,
    expectedRevision,
    (t) => [
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
    const { content: answer } = await complete(
      { ...ctx, sessionId: sid },
      {
        purpose: "dialogue",
        messages: [
          { role: "system", content: dialoguePrompt },
          ...conversation.map((m) => ({ role: m.role, content: m.content })),
        ],
        schema: dialogueOutput,
      },
    );
    await mutate(
      ctx,
      sid,
      expectedRevision + 1,
      (t) => [
        insertMessage(ctx, sid, t, { role: "assistant", content: answer.text }),
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
    await release(ctx, sid, token);
    throw e;
  }
}
