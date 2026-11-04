import { id, stmt, all, owned, mutate, gate, gateArgs } from "./db.js";
import { getSession } from "./sessions.js";
import { AppError, conflict } from "./errors.js";
import { complete } from "./llm/client.js";
import { graphPrompt } from "./llm/prompts.js";
import { graphOutput, edgeType } from "./schemas.js";
export async function getGraph(ctx, sid) {
  const { messages } = await getSession(ctx, sid);
  const edges = await all(
    ctx,
    "SELECT * FROM graph_edges WHERE session_id=?",
    sid,
  );
  return {
    nodes: messages.filter((m) => m.role === "user" && m.mode === "dialogue"),
    edges: edges.map((e) => ({
      id: e.id,
      sourceId: e.source_id,
      targetId: e.target_id,
      type: e.type,
      userEdited: !!e.user_edited,
    })),
  };
}
async function validateEdge(ctx, sid, e) {
  if (!edgeType.safeParse(e.type).success || e.sourceId === e.targetId)
    throw new AppError("VALIDATION", "올바른 발언 관계를 선택해 주세요.");
  const { nodes } = await getGraph(ctx, sid);
  const ids = new Set(nodes.map((m) => m.id));
  if (!ids.has(e.sourceId) || !ids.has(e.targetId))
    throw new AppError(
      "VALIDATION",
      "현재 대화의 내 발언만 연결할 수 있습니다.",
    );
}
export async function saveEdge(ctx, sid, e) {
  const s = await owned(ctx, sid);
  await validateEdge(ctx, sid, e);
  const eid = id();
  await mutate(ctx, sid, s.revision, (t) => [
    stmt(
      ctx,
      `DELETE FROM graph_rejections WHERE session_id=? AND source_id=? AND target_id=? AND ${gate}`,
      sid,
      e.sourceId,
      e.targetId,
      ...gateArgs(ctx, sid, t),
    ),
    stmt(
      ctx,
      `INSERT INTO graph_edges (id,session_id,source_id,target_id,type,user_edited) SELECT ?,?,?,?,?,1 WHERE ${gate} ON CONFLICT(session_id,source_id,target_id) DO UPDATE SET type=excluded.type,user_edited=1`,
      eid,
      sid,
      e.sourceId,
      e.targetId,
      e.type,
      ...gateArgs(ctx, sid, t),
    ),
  ]);
  return (await getGraph(ctx, sid)).edges.find(
    (x) => x.sourceId === e.sourceId && x.targetId === e.targetId,
  );
}
export async function deleteEdge(ctx, sid, eid) {
  const s = await owned(ctx, sid);
  const edge = (await getGraph(ctx, sid)).edges.find((x) => x.id === eid);
  if (!edge) throw new AppError("NOT_FOUND", "관계를 찾을 수 없습니다.", 404);
  await mutate(ctx, sid, s.revision, (t) => [
    stmt(
      ctx,
      `INSERT OR IGNORE INTO graph_rejections (session_id,source_id,target_id) SELECT ?,?,? WHERE ${gate}`,
      sid,
      edge.sourceId,
      edge.targetId,
      ...gateArgs(ctx, sid, t),
    ),
    stmt(
      ctx,
      `DELETE FROM graph_edges WHERE id=? AND session_id=? AND ${gate}`,
      eid,
      sid,
      ...gateArgs(ctx, sid, t),
    ),
  ]);
}
export async function refreshGraph(
  ctx,
  sid,
  { expectedRevision, force = false },
) {
  const s = await owned(ctx, sid),
    g = await getGraph(ctx, sid);
  const signature = JSON.stringify(g.nodes.map((m) => [m.id, m.content]));
  if (g.nodes.length < 2 || (!force && s.graph_signature === signature))
    return g;
  const token = id();
  const claim = await stmt(
    ctx,
    "UPDATE sessions SET graph_busy_token=? WHERE id=? AND owner_id=? AND revision=? AND graph_busy_token IS NULL",
    token,
    sid,
    ctx.ownerId,
    expectedRevision,
  ).run();
  if (!claim.meta.changes) throw conflict();
  try {
    const { content } = await complete(
      { ...ctx, sessionId: sid },
      {
        purpose: "graph",
        messages: [
          { role: "system", content: graphPrompt },
          {
            role: "user",
            content: JSON.stringify(
              g.nodes.map((m) => ({ id: m.id, text: m.content })),
            ),
          },
        ],
        schema: graphOutput,
      },
    );
    const ids = new Set(g.nodes.map((m) => m.id));
    if (
      content.edges.some(
        (e) =>
          !ids.has(e.sourceId) ||
          !ids.has(e.targetId) ||
          e.sourceId === e.targetId,
      )
    )
      throw new AppError(
        "LLM_FORMAT",
        "발언 관계의 참조가 올바르지 않습니다.",
        502,
      );
    const rows = content.edges.map((e) => ({ ...e, id: id() }));
    const condition =
      "EXISTS (SELECT 1 FROM sessions WHERE id=? AND owner_id=? AND revision=? AND graph_busy_token=?)";
    const out = await ctx.db.batch([
      stmt(
        ctx,
        `INSERT INTO graph_edges (id,session_id,source_id,target_id,type,user_edited) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.sourceId'),json_extract(value,'$.targetId'),json_extract(value,'$.type'),0 FROM json_each(?) WHERE ${condition} AND NOT EXISTS (SELECT 1 FROM graph_rejections WHERE session_id=? AND source_id=json_extract(value,'$.sourceId') AND target_id=json_extract(value,'$.targetId')) ON CONFLICT(session_id,source_id,target_id) DO UPDATE SET type=excluded.type WHERE graph_edges.user_edited=0`,
        sid,
        JSON.stringify(rows),
        sid,
        ctx.ownerId,
        expectedRevision,
        token,
        sid,
      ),
      stmt(
        ctx,
        "UPDATE sessions SET graph_signature=?,graph_busy_token=NULL WHERE id=? AND owner_id=? AND revision=? AND graph_busy_token=?",
        signature,
        sid,
        ctx.ownerId,
        expectedRevision,
        token,
      ),
    ]);
    if (!out.at(-1).meta.changes) throw conflict();
    return getGraph(ctx, sid);
  } catch (e) {
    await stmt(
      ctx,
      "UPDATE sessions SET graph_busy_token=NULL WHERE id=? AND owner_id=? AND graph_busy_token=?",
      sid,
      ctx.ownerId,
      token,
    ).run();
    throw e;
  }
}
