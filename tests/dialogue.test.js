import { it, expect, beforeEach, afterEach } from "vitest";
import { fixture, response } from "./helpers.js";
import { createSession, getSession, editMessage } from "../server/sessions.js";
import { sendMessage, regenerate } from "../server/dialogue.js";
let f, s;
beforeEach(async () => {
  f = await fixture();
  f.ctx.env = { OPENROUTER_API_KEY: "test", LLM_MODEL: "vendor/fixed:free" };
  f.ctx.fetchImpl = async () => response({ text: "그 말은 어떤 의미인가요?" });
  s = await createSession(f.ctx);
});
afterEach(async () => {
  await f?.mf.dispose();
});
it("retains history and generates a single reviewed question without web search", async () => {
  let payload;
  f.ctx.fetchImpl = async (u, o) => {
    payload = JSON.parse(o.body);
    return response({ text: "어떤 경험이 있었나요?" });
  };
  const r = await sendMessage(f.ctx, s.id, {
    content: "진로가 고민돼",
    expectedRevision: 0,
  });
  expect(r.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(payload.plugins).toBeUndefined();
  const next = await sendMessage(f.ctx, s.id, {
    content: "완성했을 때 좋았어",
    expectedRevision: r.session.revision,
  });
  expect(next.messages).toHaveLength(4);
  expect(payload.messages.some((m) => m.content === "진로가 고민돼")).toBe(
    true,
  );
});
it("preserves old assistant on regeneration failure and saved user on generation failure", async () => {
  const r = await sendMessage(f.ctx, s.id, {
    content: "고민이 있어",
    expectedRevision: 0,
  });
  f.ctx.fetchImpl = async () => {
    throw Error("offline");
  };
  await expect(
    regenerate(f.ctx, s.id, {
      messageId: r.messages[1].id,
      expectedRevision: r.session.revision,
    }),
  ).rejects.toMatchObject({ code: "LLM_NETWORK" });
  expect((await getSession(f.ctx, s.id)).messages[1].content).toBe(
    "그 말은 어떤 의미인가요?",
  );
  const current = await getSession(f.ctx, s.id);
  await expect(
    sendMessage(f.ctx, s.id, {
      content: "추가 발언",
      expectedRevision: current.session.revision,
    }),
  ).rejects.toMatchObject({ code: "LLM_NETWORK" });
  expect((await getSession(f.ctx, s.id)).messages.at(-1).content).toBe(
    "추가 발언",
  );
});
it("discards delayed AI result when an earlier message was edited", async () => {
  let resolve, started;
  const start = new Promise((r) => (started = r));
  f.ctx.fetchImpl = () => {
    started();
    return new Promise((r) => (resolve = r));
  };
  const pending = sendMessage(f.ctx, s.id, {
    content: "원래 발언",
    expectedRevision: 0,
  });
  await start;
  const current = await getSession(f.ctx, s.id);
  await editMessage(f.ctx, s.id, current.messages[0].id, {
    content: "수정 발언",
    expectedRevision: current.session.revision,
  });
  resolve(response({ text: "늦은 질문" }));
  await expect(pending).rejects.toMatchObject({ status: 409 });
  expect(
    (await getSession(f.ctx, s.id)).messages.map((m) => m.content),
  ).toEqual(["수정 발언"]);
});
it("retries an unanswered user message without duplicating it", async () => {
  const { continueDialogue } = await import("../server/dialogue.js");
  f.ctx.fetchImpl = async () => {
    throw Error("offline");
  };
  await expect(
    sendMessage(f.ctx, s.id, { content: "한 번만 저장", expectedRevision: 0 }),
  ).rejects.toMatchObject({ code: "LLM_NETWORK" });
  const current = await getSession(f.ctx, s.id);
  f.ctx.fetchImpl = async () => response({ text: "이어지는 질문" });
  const r = await continueDialogue(f.ctx, s.id, {
    expectedRevision: current.session.revision,
  });
  expect(r.messages.map((m) => m.content)).toEqual([
    "한 번만 저장",
    "이어지는 질문",
  ]);
});
