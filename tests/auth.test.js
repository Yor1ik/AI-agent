import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
import { authorize, checkOrigin } from "../server/auth.js";
let keys, resolver;
const env = {
  ACCESS_ISSUER: "https://team.cloudflareaccess.com",
  ACCESS_AUDIENCE: "app",
  ALLOWED_EMAIL: "owner@example.test",
};
const req = (token, url = "https://app.pages.dev/api/sessions") =>
  new Request(url, {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
  });
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  resolver = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "one" }],
  });
});
async function token(overrides = {}) {
  return new SignJWT({ email: "owner@example.test", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "one" })
    .setIssuer(env.ACCESS_ISSUER)
    .setAudience("app")
    .setExpirationTime("1h")
    .sign(keys.privateKey);
}
describe("remote authorization", () => {
  it("accepts verified owner only", async () =>
    expect((await authorize(req(await token()), env, resolver)).ownerId).toBe(
      "owner@example.test",
    ));
  it("rejects missing configuration and token", async () => {
    await expect(authorize(req(), {})).rejects.toMatchObject({ status: 503 });
    await expect(authorize(req(), env, resolver)).rejects.toMatchObject({
      status: 401,
    });
  });
  it("rejects wrong email, audience, expiry, issuer and forged signature", async () => {
    for (const jwt of [
      await token({ email: "stranger@example.test" }),
      await new SignJWT({ email: "owner@example.test" })
        .setProtectedHeader({ alg: "RS256", kid: "one" })
        .setIssuer(env.ACCESS_ISSUER)
        .setAudience("other")
        .setExpirationTime("1h")
        .sign(keys.privateKey),
      await new SignJWT({ email: "owner@example.test" })
        .setProtectedHeader({ alg: "RS256", kid: "one" })
        .setIssuer("https://wrong.test")
        .setAudience("app")
        .setExpirationTime("1h")
        .sign(keys.privateKey),
      await new SignJWT({ email: "owner@example.test" })
        .setProtectedHeader({ alg: "RS256", kid: "one" })
        .setIssuer(env.ACCESS_ISSUER)
        .setAudience("app")
        .setExpirationTime(1)
        .sign(keys.privateKey),
      (await token()).replace(
        /\.([A-Za-z0-9_-])([A-Za-z0-9_-]+)$/,
        (_, first, rest) => "." + (first === "A" ? "B" : "A") + rest,
      ),
    ])
      await expect(authorize(req(jwt), env, resolver)).rejects.toMatchObject({
        status: 401,
      });
  });
  it("requires explicit local mode plus loopback, never bypasses deployed hostname", async () => {
    const local = { ENVIRONMENT: "local", LOCAL_DEV: "true" };
    expect(
      (await authorize(req(null, "http://127.0.0.1:8788/api/sessions"), local))
        .ownerId,
    ).toBe("local-owner");
    await expect(authorize(req(), local)).rejects.toMatchObject({
      status: 503,
    });
    await expect(
      authorize(req(null, "http://localhost:8788/api/sessions"), {
        ...local,
        ENVIRONMENT: "production",
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("rejects cross-origin mutations and missing Origin", () => {
    for (const origin of [undefined, "https://evil.test"])
      expect(() =>
        checkOrigin(
          new Request("https://app.pages.dev/api/sessions", {
            method: "POST",
            headers: origin ? { origin } : {},
          }),
        ),
      ).toThrow();
    expect(() =>
      checkOrigin(
        new Request("https://app.pages.dev/api/sessions", {
          method: "POST",
          headers: { origin: "https://app.pages.dev" },
        }),
      ),
    ).not.toThrow();
  });
});
