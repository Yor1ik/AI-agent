import { it, expect } from "vitest";
import { complete, getUsage } from "../server/llm/client.js";
import { response } from "./helpers.js";
const ctx = (fetchImpl) => ({
  env: {
    OPENROUTER_API_KEY: "test-key",
    LLM_MODEL: "vendor/fixed:free",
    SEARCH_ENABLED: "true",
  },
  fetchImpl,
});
it("uses fixed model and keeps search opt-in", async () => {
  let payload;
  const c = ctx(async (url, options) => {
    payload = JSON.parse(options.body);
    return response({ text: "질문" });
  });
  const r = await complete(c, {
    purpose: "dialogue",
    messages: [],
    search: false,
  });
  expect(r.content.text).toBe("질문");
  expect(payload.model).toBe("vendor/fixed:free");
  expect(payload.plugins).toBeUndefined();
});
it("rejects random routing, Gemma and paid model", async () => {
  for (const model of ["openrouter/free", "google/gemma:free", "vendor/paid"])
    await expect(
      complete(
        { ...ctx(fetch), env: { ...ctx(fetch).env, LLM_MODEL: model } },
        { purpose: "dialogue", messages: [] },
      ),
    ).rejects.toMatchObject({ code: "MODEL_CONFIG" });
});
it("requires actual provider annotations for search sources", async () => {
  await expect(
    complete(
      ctx(async () =>
        response({
          answer: "출처 없는 결과",
          sources: ["https://invented.test"],
        }),
      ),
      { purpose: "research", messages: [], search: true },
    ),
  ).rejects.toMatchObject({ code: "SEARCH_UNSUPPORTED" });
  const r = await complete(
    ctx(async () =>
      response({ answer: "조사 결과" }, [
        {
          type: "url_citation",
          url_citation: { url: "https://example.org/article", title: "원문" },
        },
      ]),
    ),
    { purpose: "research", messages: [], search: true },
  );
  expect(r.sources[0].url).toBe("https://example.org/article");
});
it("distinguishes rate, daily, auth and malformed responses", async () => {
  for (const [status, error, code] of [
    [401, { message: "bad key" }, "LLM_AUTH"],
    [429, { message: "rate limit" }, "RATE_LIMIT"],
    [429, { message: "daily limit exceeded" }, "DAILY_LIMIT"],
  ])
    await expect(
      complete(
        ctx(async () => Response.json({ error }, { status })),
        { purpose: "dialogue", messages: [] },
      ),
    ).rejects.toMatchObject({ code });
  await expect(
    complete(
      ctx(async () => response("{broken")),
      { purpose: "dialogue", messages: [] },
    ),
  ).rejects.toMatchObject({ code: "LLM_FORMAT" });
});
it("does not equate credit remaining with free requests", async () => {
  const r = await getUsage(
    ctx(async () =>
      Response.json({ data: { limit_remaining: 9.9, usage_daily: 0.1 } }),
    ),
  );
  expect(r.creditRemaining).toBe(9.9);
  expect(r.providerRemainingCalls).toBeNull();
});
it("rejects search when disabled and truncated output", async () => {
  await expect(
    complete(
      { ...ctx(fetch), env: { ...ctx(fetch).env, SEARCH_ENABLED: "false" } },
      { purpose: "research", messages: [], search: true },
    ),
  ).rejects.toMatchObject({ code: "SEARCH_DISABLED" });
  await expect(
    complete(
      ctx(async () =>
        Response.json({
          choices: [{ message: { content: "{}" }, finish_reason: "length" }],
        }),
      ),
      { purpose: "dialogue", messages: [] },
    ),
  ).rejects.toMatchObject({ code: "LLM_TRUNCATED" });
});
