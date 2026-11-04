import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
export async function fixture() {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-07-30",
    d1Databases: ["DB"],
  });
  const db = await mf.getD1Database("DB");
  const sql = await readFile(
    new URL("../migrations/0001_initial.sql", import.meta.url),
    "utf8",
  );
  for (const statement of sql
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
  return {
    mf,
    ctx: {
      db,
      env: {},
      ownerId: "local-owner",
      fetchImpl: fetch,
      now: () => new Date().toISOString(),
    },
  };
}
export const response = (content, annotations = []) =>
  Response.json({
    id: "gen-test",
    model: "fixed:free",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content:
            typeof content === "string" ? content : JSON.stringify(content),
          annotations,
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
