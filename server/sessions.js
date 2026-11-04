import {
  id,
  now,
  stmt,
  all,
  first,
  owned,
  mutate,
  gate,
  sessionGate,
  gateArgs,
} from "./db.js";
import { AppError, conflict } from "./errors.js";
export const sessionDto = (s) => ({
  id: s.id,
  title: s.title,
  revision: s.revision,
  status: s.status,
  busy: !!s.busy_token,
  graphBusy: !!s.graph_busy_token,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
});
export const messageDto = (m) => ({
  id: m.id,
  sessionId: m.session_id,
  position: m.position,
  role: m.role,
  content: m.content,
  mode: m.mode,
  researchRunId: m.research_run_id,
  createdAt: m.created_at,
});
export async function createSession(ctx) {
  const sid = id(),
    t = now(ctx);
  await stmt(
    ctx,
    "INSERT INTO sessions (id,owner_id,created_at,updated_at) VALUES (?,?,?,?)",
    sid,
    ctx.ownerId,
    t,
    t,
  ).run();
  return sessionDto(await owned(ctx, sid));
}
export async function listSessions(ctx) {
  return (
    await all(
      ctx,
      "SELECT * FROM sessions WHERE owner_id=? ORDER BY updated_at DESC",
      ctx.ownerId,
    )
  ).map(sessionDto);
}
export async function getSession(ctx, sid) {
  const s = await owned(ctx, sid);
  return {
    session: sessionDto(s),
    messages: (
      await all(
        ctx,
        "SELECT * FROM messages WHERE session_id=? ORDER BY position",
        sid,
      )
    ).map(messageDto),
  };
}
export function insertMessage(
  ctx,
  sid,
  token,
  { role, content, mode = "dialogue", researchRunId = null },
) {
  return stmt(
    ctx,
    `INSERT INTO messages (id,session_id,position,role,content,mode,research_run_id,created_at) SELECT ?,?,COALESCE((SELECT MAX(position)+1 FROM messages WHERE session_id=?),0),?,?,?,?,? WHERE ${gate}`,
    id(),
    sid,
    sid,
    role,
    content,
    mode,
    researchRunId,
    now(ctx),
    ...gateArgs(ctx, sid, token),
  );
}
export async function appendMessage(
  ctx,
  sid,
  { role, content, expectedRevision, mode = "dialogue", researchRunId = null },
) {
  await owned(ctx, sid);
  await mutate(ctx, sid, expectedRevision, (t) => [
    insertMessage(ctx, sid, t, { role, content, mode, researchRunId }),
  ]);
  return getSession(ctx, sid);
}
async function target(ctx, sid, mid) {
  await owned(ctx, sid);
  const m = await first(
    ctx,
    "SELECT * FROM messages WHERE id=? AND session_id=?",
    mid,
    sid,
  );
  if (!m) throw new AppError("NOT_FOUND", "발언을 찾을 수 없습니다.", 404);
  return m;
}
export async function previewEdit(ctx, sid, mid) {
  const m = await target(ctx, sid, mid),
    s = await owned(ctx, sid);
  return {
    revision: s.revision,
    affected: {
      messages: (
        await first(
          ctx,
          "SELECT COUNT(*) AS n FROM messages WHERE session_id=? AND position>?",
          sid,
          m.position,
        )
      ).n,
      research: (
        await first(
          ctx,
          "SELECT COUNT(*) AS n FROM research_runs WHERE session_id=? AND base_position>=?",
          sid,
          m.position,
        )
      ).n,
      relations: (
        await first(
          ctx,
          "SELECT COUNT(*) AS n FROM graph_edges WHERE session_id=?",
          sid,
        )
      ).n,
    },
  };
}
export async function editMessage(
  ctx,
  sid,
  mid,
  { content, expectedRevision },
) {
  const m = await target(ctx, sid, mid);
  if (m.role !== "user")
    throw new AppError("VALIDATION", "내 발언만 수정할 수 있습니다.");
  await mutate(ctx, sid, expectedRevision, (t) => [
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
      `DELETE FROM graph_edges WHERE session_id=? AND (source_id=? OR target_id=?) AND ${gate}`,
      sid,
      mid,
      mid,
      ...gateArgs(ctx, sid, t),
    ),
    stmt(
      ctx,
      `DELETE FROM graph_rejections WHERE session_id=? AND (source_id=? OR target_id=?) AND ${gate}`,
      sid,
      mid,
      mid,
      ...gateArgs(ctx, sid, t),
    ),
    stmt(
      ctx,
      `UPDATE messages SET content=? WHERE id=? AND session_id=? AND ${gate}`,
      content,
      mid,
      sid,
      ...gateArgs(ctx, sid, t),
    ),
    stmt(
      ctx,
      `UPDATE sessions SET busy_token=NULL WHERE ${sessionGate}`,
      ...gateArgs(ctx, sid, t),
    ),
  ]);
  return getSession(ctx, sid);
}
export async function deleteSession(ctx, sid, expectedRevision) {
  await owned(ctx, sid);
  const r = await stmt(
    ctx,
    "DELETE FROM sessions WHERE id=? AND owner_id=? AND revision=?",
    sid,
    ctx.ownerId,
    expectedRevision,
  ).run();
  if (!r.meta.changes) throw conflict();
}
export async function setSessionStatus(ctx, sid, { status, expectedRevision }) {
  await owned(ctx, sid);
  if (!["active", "paused"].includes(status))
    throw new AppError("VALIDATION", "상태를 확인해 주세요.");
  await mutate(ctx, sid, expectedRevision, (t) => [
    stmt(
      ctx,
      `UPDATE sessions SET status=?,busy_token=NULL WHERE ${sessionGate}`,
      status,
      ...gateArgs(ctx, sid, t),
    ),
  ]);
  return getSession(ctx, sid);
}
