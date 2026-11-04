import { it, expect, beforeEach, afterEach } from "vitest";
import { fixture, response } from "./helpers.js";
import {
  createSession,
  appendMessage,
  getSession,
} from "../server/sessions.js";
import {
  getGraph,
  refreshGraph,
  saveEdge,
  deleteEdge,
} from "../server/graph.js";
let f, s, a, b;
beforeEach(async () => {
  f = await fixture();
  f.ctx.env = { OPENROUTER_API_KEY: "test", LLM_MODEL: "vendor/fixed:free" };
  s = await createSession(f.ctx);
  await appendMessage(f.ctx, s.id, {
    role: "user",
    content: "프로젝트가 좋아",
    expectedRevision: 0,
  });
  await appendMessage(f.ctx, s.id, {
    role: "user",
    content: "완성할 때 뿌듯해",
    expectedRevision: 1,
  });
  [a, b] = (await getSession(f.ctx, s.id)).messages.map((x) => x.id);
});
afterEach(async () => {
  await f?.mf.dispose();
});
it("preserves user edits and deleted edges during regeneration", async () => {
  f.ctx.fetchImpl = async () =>
    response({ edges: [{ sourceId: a, targetId: b, type: "근거" }] });
  let g = await refreshGraph(f.ctx, s.id, { expectedRevision: 2, force: true });
  expect(g.edges[0].type).toBe("근거");
  await saveEdge(f.ctx, s.id, { sourceId: a, targetId: b, type: "예시" });
  g = await refreshGraph(f.ctx, s.id, { expectedRevision: 3, force: true });
  expect(g.edges[0].type).toBe("예시");
  await deleteEdge(f.ctx, s.id, g.edges[0].id);
  g = await refreshGraph(f.ctx, s.id, { expectedRevision: 4, force: true });
  expect(g.edges).toHaveLength(0);
});
it("rejects foreign-session nodes and invalid types", async () => {
  const other = await createSession(f.ctx);
  await appendMessage(f.ctx, other.id, {
    role: "user",
    content: "다른 대화",
    expectedRevision: 0,
  });
  const foreign = (await getSession(f.ctx, other.id)).messages[0].id;
  await expect(
    saveEdge(f.ctx, s.id, { sourceId: a, targetId: foreign, type: "근거" }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    saveEdge(f.ctx, s.id, { sourceId: a, targetId: b, type: "진단" }),
  ).rejects.toMatchObject({ status: 400 });
});
it("uses saved graph when no messages changed", async () => {
  let calls = 0;
  f.ctx.fetchImpl = async () => {
    calls++;
    return response({ edges: [] });
  };
  await refreshGraph(f.ctx, s.id, { expectedRevision: 2 });
  await refreshGraph(f.ctx, s.id, { expectedRevision: 2 });
  expect(calls).toBe(1);
  expect((await getGraph(f.ctx, s.id)).nodes).toHaveLength(2);
});
it("can cancel a disconnected graph request and discard its late proposal", async () => {
  const { cancelGeneration } = await import("../server/dialogue.js");
  let resolve, started;
  const ready = new Promise((r) => (started = r));
  f.ctx.fetchImpl = () => {
    started();
    return new Promise((r) => (resolve = r));
  };
  const pending = refreshGraph(f.ctx, s.id, {
    expectedRevision: 2,
    force: true,
  });
  await ready;
  const cancelled = await cancelGeneration(f.ctx, s.id, {
    expectedRevision: 2,
  });
  f.ctx.fetchImpl = async () => response({ edges: [] });
  await expect(
    refreshGraph(f.ctx, s.id, {
      expectedRevision: cancelled.session.revision,
      force: true,
    }),
  ).resolves.toMatchObject({ edges: [] });
  resolve(response({ edges: [{ sourceId: a, targetId: b, type: "근거" }] }));
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect((await getGraph(f.ctx, s.id)).edges).toHaveLength(0);
});
