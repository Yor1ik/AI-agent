import { it, expect, beforeEach, afterEach } from "vitest";
import { fixture, response } from "./helpers.js";
import { createSession } from "../server/sessions.js";
import {
  createResearch,
  advanceResearch,
  getResearch,
  retryStep,
  pauseResearch,
} from "../server/research.js";
let f, s;
beforeEach(async () => {
  f = await fixture();
  f.ctx.env = {
    OPENROUTER_API_KEY: "test",
    LLM_MODEL: "vendor/fixed:free",
    SEARCH_ENABLED: "true",
  };
  s = await createSession(f.ctx);
});
afterEach(async () => {
  await f?.mf.dispose();
});
const citations = [
  {
    type: "url_citation",
    url_citation: { url: "https://example.org/source", title: "공식 자료" },
  },
];
it.each([1, 7])(
  "accepts %i relevant questions without an artificial count cap",
  async (n) => {
    f.ctx.fetchImpl = async () =>
      response({ questions: Array.from({ length: n }, (_, i) => `질문 ${i}`) });
    const r = await createResearch(f.ctx, s.id, {
      declaration: "  원문 그대로  ",
      expectedRevision: 0,
    });
    const next = await advanceResearch(f.ctx, r.id, {
      expectedRevision: r.revision,
    });
    expect(next.declaration).toBe("  원문 그대로  ");
    expect(next.steps).toHaveLength(n);
    expect(next.status).toBe("ready");
  },
);
it("preserves successful work when another question fails and synthesizes partial results", async () => {
  let calls = 0;
  f.ctx.fetchImpl = async () => {
    calls++;
    if (calls === 1) return response({ questions: ["질문 A", "질문 B"] });
    if (calls === 2)
      return response({ answer: "확인한 사실", uncertainties: [] }, citations);
    if (calls === 3)
      return Response.json(
        { error: { message: "unavailable" } },
        { status: 503 },
      );
    const current = await getResearch(f.ctx, r.id);
    return response({
      answer: "부분 조사 결과",
      sourceIds: current.steps[0].sources.map((x) => x.id),
      uncertainties: ["B는 미확인"],
    });
  };
  let r = await createResearch(f.ctx, s.id, {
    declaration: "대상",
    expectedRevision: 0,
  });
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: r.revision });
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: r.revision });
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: r.revision });
  expect(r.steps.map((x) => x.status)).toEqual(["completed", "failed"]);
  expect(r.steps[0].sources[0].url).toBe("https://example.org/source");
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: r.revision });
  expect(r.status).toBe("partial");
});
it("two tabs cannot run the same active step twice", async () => {
  let calls = 0,
    resolve,
    started;
  const start = new Promise((r) => (started = r));
  f.ctx.fetchImpl = () => {
    calls++;
    started();
    return new Promise((r) => (resolve = r));
  };
  const r = await createResearch(f.ctx, s.id, {
    declaration: "대상",
    expectedRevision: 0,
  });
  const pending = advanceResearch(f.ctx, r.id, {
    expectedRevision: r.revision,
  });
  await start;
  await expect(
    advanceResearch(f.ctx, r.id, { expectedRevision: r.revision }),
  ).rejects.toMatchObject({ status: 409 });
  resolve(response({ questions: ["하나"] }));
  await pending;
  expect(calls).toBe(1);
});
it("pausing invalidates a delayed result and explicit retry can resume", async () => {
  let resolve, started;
  const start = new Promise((r) => (started = r));
  f.ctx.fetchImpl = () => {
    started();
    return new Promise((r) => (resolve = r));
  };
  const r = await createResearch(f.ctx, s.id, {
    declaration: "대상",
    expectedRevision: 0,
  });
  const pending = advanceResearch(f.ctx, r.id, { expectedRevision: 0 });
  await start;
  const stopped = await pauseResearch(f.ctx, r.id);
  expect(stopped.status).toBe("paused");
  resolve(response({ questions: ["늦은 결과"] }));
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect((await getResearch(f.ctx, r.id)).steps).toHaveLength(0);
});
it("large decompositions use a bounded number of D1 statements", async () => {
  let count = 0;
  const real = f.ctx.db;
  f.ctx.db = {
    prepare(sql) {
      count++;
      return real.prepare(sql);
    },
    batch: (statements) => real.batch(statements),
  };
  f.ctx.fetchImpl = async () =>
    response({ questions: Array.from({ length: 80 }, (_, i) => `질문 ${i}`) });
  const r = await createResearch(f.ctx, s.id, {
    declaration: "여러 항목 조사",
    expectedRevision: 0,
  });
  count = 0;
  const next = await advanceResearch(f.ctx, r.id, { expectedRevision: 0 });
  expect(next.steps).toHaveLength(80);
  expect(count).toBeLessThan(30);
});
it("stops the pipeline on provider rate limits instead of consuming remaining calls", async () => {
  let calls = 0;
  f.ctx.fetchImpl = async () => {
    calls++;
    return calls === 1
      ? response({ questions: ["A", "B"] })
      : Response.json(
          { error: { message: "rate limit" } },
          { status: 429, headers: { "Retry-After": "20" } },
        );
  };
  let r = await createResearch(f.ctx, s.id, {
    declaration: "대상",
    expectedRevision: 0,
  });
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: 0 });
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: r.revision });
  expect(r.status).toBe("failed");
  expect(r.error.code).toBe("RATE_LIMIT");
  expect(r.steps[1].status).toBe("pending");
  expect(calls).toBe(2);
});
it("pause before step commit leaves no obsolete citations and resume replaces the source set", async () => {
  const { resumeResearch } = await import("../server/research.js");
  f.ctx.fetchImpl = async () => response({ questions: ["하위 질문"] });
  let r = await createResearch(f.ctx, s.id, {
    declaration: "대상",
    expectedRevision: 0,
  });
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: 0 });
  const real = f.ctx.db;
  f.ctx.fetchImpl = async () =>
    response({ answer: "폐기될 응답", uncertainties: [] }, [
      {
        type: "url_citation",
        url_citation: { url: "https://example.org/old", title: "이전 자료" },
      },
    ]);
  f.ctx.db = {
    prepare: (...args) => real.prepare(...args),
    batch: async (statements) => {
      await pauseResearch({ ...f.ctx, db: real }, r.id);
      return real.batch(statements);
    },
  };
  await expect(
    advanceResearch(f.ctx, r.id, { expectedRevision: r.revision }),
  ).rejects.toMatchObject({ status: 409 });
  f.ctx.db = real;
  r = await getResearch(f.ctx, r.id);
  expect(r.steps[0].sources).toHaveLength(0);
  r = await resumeResearch(f.ctx, r.id, { expectedRevision: r.revision });
  f.ctx.fetchImpl = async () =>
    response({ answer: "새 응답", uncertainties: [] }, [
      {
        type: "url_citation",
        url_citation: { url: "https://example.org/new", title: "새 자료" },
      },
    ]);
  r = await advanceResearch(f.ctx, r.id, { expectedRevision: r.revision });
  expect(r.steps[0].sources.map((x) => x.url)).toEqual([
    "https://example.org/new",
  ]);
});
