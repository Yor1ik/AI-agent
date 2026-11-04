import { AppError, conflict } from "./errors.js";
export const id = () => crypto.randomUUID();
export const now = (ctx) => (ctx.now ? ctx.now() : new Date().toISOString());
export const stmt = (ctx, sql, ...args) => ctx.db.prepare(sql).bind(...args);
export const all = async (ctx, sql, ...args) =>
  (await stmt(ctx, sql, ...args).all()).results;
export const first = (ctx, sql, ...args) => stmt(ctx, sql, ...args).first();
export async function owned(ctx, sessionId) {
  const s = await first(
    ctx,
    "SELECT * FROM sessions WHERE id=? AND owner_id=?",
    sessionId,
    ctx.ownerId,
  );
  if (!s) throw new AppError("NOT_FOUND", "대화를 찾을 수 없습니다.", 404);
  return s;
}
export const sessionGate = "id=? AND owner_id=? AND last_mutation_id=?";
export const gate =
  "EXISTS (SELECT 1 FROM sessions WHERE id=? AND owner_id=? AND last_mutation_id=?)";
export async function mutate(
  ctx,
  sessionId,
  expectedRevision,
  build,
  { requireIdle = false, requireToken } = {},
) {
  const token = id();
  const extra = requireToken
    ? " AND busy_token=?"
    : requireIdle
      ? " AND busy_token IS NULL"
      : "";
  const args = [
    token,
    now(ctx),
    sessionId,
    ctx.ownerId,
    expectedRevision,
    ...(requireToken ? [requireToken] : []),
  ];
  const ops = [
    stmt(
      ctx,
      `UPDATE sessions SET revision=revision+1,last_mutation_id=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?${extra}`,
      ...args,
    ),
    ...build(token),
  ];
  const results = await ctx.db.batch(ops);
  if (!results[0].meta.changes) throw conflict();
  return token;
}
export const gateArgs = (ctx, sessionId, token) => [
  sessionId,
  ctx.ownerId,
  token,
];
