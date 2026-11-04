import { createRemoteJWKSet, jwtVerify } from "jose";
import { AppError } from "./errors.js";
const resolvers = new Map();
export async function authorize(request, env, keyResolver) {
  const url = new URL(request.url);
  if (
    env.ENVIRONMENT === "local" &&
    env.LOCAL_DEV === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return { ownerId: "local-owner" };
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE || !env.ALLOWED_EMAIL)
    throw new AppError("AUTH_CONFIG", "접근 인증 설정이 필요합니다.", 503);
  const issuer = env.ACCESS_ISSUER.replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))
    throw new AppError(
      "AUTH_CONFIG",
      "올바른 Access 팀 도메인을 설정하세요.",
      503,
    );
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token)
    throw new AppError("UNAUTHORIZED", "본인 계정으로 로그인해 주세요.", 401);
  try {
    if (!keyResolver) {
      if (!resolvers.has(issuer))
        resolvers.set(
          issuer,
          createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),
        );
      keyResolver = resolvers.get(issuer);
    }
    const { payload } = await jwtVerify(token, keyResolver, {
      issuer,
      audience: env.ACCESS_AUDIENCE,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "email"],
    });
    if (
      typeof payload.email !== "string" ||
      payload.email.toLowerCase() !== env.ALLOWED_EMAIL.trim().toLowerCase()
    )
      throw Error("owner");
    return { ownerId: payload.email.toLowerCase() };
  } catch {
    throw new AppError(
      "UNAUTHORIZED",
      "본인 계정으로 다시 로그인해 주세요.",
      401,
    );
  }
}
export function checkOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new AppError(
      "ORIGIN",
      "다른 사이트에서 보낸 요청은 허용하지 않습니다.",
      403,
    );
}
