import { it, expect, beforeEach, afterEach } from "vitest";
import { fixture, response } from "./helpers.js";
import { handleApi } from "../server/api.js";
let f;
beforeEach(async () => (f = await fixture()));
afterEach(async () => f?.mf.dispose());
const request = (path, method = "GET", data) =>
  new Request(`http://127.0.0.1:8788/api${path}`, {
    method,
    headers: {
      origin: "http://127.0.0.1:8788",
      ...(data ? { "content-type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
const local = { ENVIRONMENT: "local", LOCAL_DEV: "true" };
it("creates, reads and validates a local session through the real route", async () => {
  const env = { ...local, DB: f.ctx.db };
  const s = await (
    await handleApi(request("/sessions", "POST", {}), env)
  ).json();
  expect(s.id).toBeTruthy();
  expect(
    (await (await handleApi(request(`/sessions/${s.id}`), env)).json())
      .messages,
  ).toEqual([]);
  const bad = await handleApi(
    request(`/sessions/${s.id}/messages`, "POST", {
      content: "",
      expectedRevision: 0,
    }),
    env,
  );
  expect(bad.status).toBe(400);
});
it("rejects unauthenticated remote API before reading D1", async () => {
  const r = await handleApi(
    new Request("https://app.pages.dev/api/sessions"),
    {},
  );
  expect(r.status).toBe(503);
  expect((await r.json()).error.code).toBe("AUTH_CONFIG");
});
