import { it, expect, beforeEach, afterEach } from "vitest";
import { fixture } from "./helpers.js";
import {
  createSession,
  listSessions,
  getSession,
  editMessage,
  previewEdit,
  deleteSession,
  appendMessage,
} from "../server/sessions.js";
let f;
beforeEach(async () => {
  f = await fixture();
});
afterEach(async () => {
  await f?.mf.dispose();
});
it("persists ordered messages and isolates owners", async () => {
  const s = await createSession(f.ctx);
  await appendMessage(f.ctx, s.id, {
    role: "user",
    content: "진로가 고민돼",
    expectedRevision: 0,
  });
  expect((await getSession(f.ctx, s.id)).messages[0].content).toBe(
    "진로가 고민돼",
  );
  expect(await listSessions(f.ctx)).toHaveLength(1);
  await expect(
    getSession({ ...f.ctx, ownerId: "other" }, s.id),
  ).rejects.toMatchObject({ status: 404 });
});
it("stale edits leave the entire suffix intact; successful edit truncates only its session", async () => {
  const s = await createSession(f.ctx),
    other = await createSession(f.ctx);
  await appendMessage(f.ctx, s.id, {
    role: "user",
    content: "첫 발언",
    expectedRevision: 0,
  });
  await appendMessage(f.ctx, s.id, {
    role: "assistant",
    content: "질문",
    expectedRevision: 1,
  });
  const before = await getSession(f.ctx, s.id);
  const mid = before.messages[0].id;
  expect((await previewEdit(f.ctx, s.id, mid)).affected.messages).toBe(1);
  await expect(
    editMessage(f.ctx, s.id, mid, { content: "수정", expectedRevision: 0 }),
  ).rejects.toMatchObject({ status: 409 });
  expect((await getSession(f.ctx, s.id)).messages).toHaveLength(2);
  await editMessage(f.ctx, s.id, mid, { content: "수정", expectedRevision: 2 });
  expect(
    (await getSession(f.ctx, s.id)).messages.map((x) => x.content),
  ).toEqual(["수정"]);
  expect((await getSession(f.ctx, other.id)).session.id).toBe(other.id);
});
it("concurrent edits have exactly one winner", async () => {
  const s = await createSession(f.ctx);
  await appendMessage(f.ctx, s.id, {
    role: "user",
    content: "원문",
    expectedRevision: 0,
  });
  const mid = (await getSession(f.ctx, s.id)).messages[0].id;
  const out = await Promise.allSettled(
    ["A", "B"].map((content) =>
      editMessage(f.ctx, s.id, mid, { content, expectedRevision: 1 }),
    ),
  );
  expect(out.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect((await getSession(f.ctx, s.id)).session.revision).toBe(2);
});
it("deletes a session without deleting another", async () => {
  const a = await createSession(f.ctx),
    b = await createSession(f.ctx);
  await deleteSession(f.ctx, a.id, 0);
  expect((await listSessions(f.ctx)).map((s) => s.id)).toEqual([b.id]);
});
it("pausing one session never changes another session without its revision", async () => {
  const { setSessionStatus } = await import("../server/sessions.js");
  const a = await createSession(f.ctx),
    b = await createSession(f.ctx);
  await setSessionStatus(f.ctx, a.id, {
    status: "paused",
    expectedRevision: 0,
  });
  const other = (await getSession(f.ctx, b.id)).session;
  expect(other.status).toBe("active");
  expect(other.revision).toBe(0);
});
