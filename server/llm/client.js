import { AppError } from "../errors.js";
import { extractSources } from "./search.js";
const base = "https://openrouter.ai/api/v1";
function config(ctx) {
  const { OPENROUTER_API_KEY: key, LLM_MODEL: model } = ctx.env;
  if (!key)
    throw new AppError(
      "LLM_CONFIG",
      "서버에 OpenRouter API 키를 설정해 주세요.",
      503,
    );
  if (
    !model ||
    model === "openrouter/free" ||
    !model.endsWith(":free") ||
    /gemma/i.test(model)
  )
    throw new AppError(
      "MODEL_CONFIG",
      "검증된 고정 무료 모델 ID를 설정해 주세요. Gemma와 무작위 라우팅은 사용하지 않습니다.",
      503,
    );
  return { key, model };
}
export async function complete(
  ctx,
  { purpose, messages, schema, search = false },
) {
  const { key, model } = config(ctx);
  if (search && ctx.env.SEARCH_ENABLED !== "true")
    throw new AppError(
      "SEARCH_DISABLED",
      "현재 검색이 꺼져 있습니다. 검색 허용 설정이 필요합니다.",
      409,
    );
  if (ctx.db && ctx.sessionId)
    await ctx.db
      .prepare(
        "UPDATE sessions SET llm_attempts=llm_attempts+1 WHERE id=? AND owner_id=?",
      )
      .bind(ctx.sessionId, ctx.ownerId)
      .run();
  let result;
  try {
    result = await (ctx.fetchImpl ?? fetch)(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Socratic Explorer",
      },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: "json_object" },
        provider: { allow_fallbacks: false, data_collection: "deny" },
        ...(search ? { plugins: [{ id: "web" }] } : {}),
      }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) {
    throw new AppError(
      e.name === "TimeoutError" || e.name === "AbortError"
        ? "LLM_TIMEOUT"
        : "LLM_NETWORK",
      "모델 연결이 완료되지 않았습니다. 재시도하면 추가 사용이 발생할 수 있습니다.",
      502,
    );
  }
  let data;
  try {
    data = await result.json();
  } catch {
    throw new AppError("LLM_FORMAT", "모델 응답 형식을 읽지 못했습니다.", 502);
  }
  if (!result.ok) {
    const message = String(data?.error?.message ?? "");
    const code =
      result.status === 401 || result.status === 403
        ? "LLM_AUTH"
        : result.status === 402
          ? "CREDIT_LIMIT"
          : result.status === 429
            ? /daily|per.day|일일/i.test(message)
              ? "DAILY_LIMIT"
              : "RATE_LIMIT"
            : search && [400, 404, 422].includes(result.status)
              ? "SEARCH_UNSUPPORTED"
              : "LLM_ERROR";
    const retryAfter = result.headers.get("Retry-After");
    throw new AppError(
      code,
      {
        LLM_AUTH: "OpenRouter 인증 또는 데이터 정책 설정을 확인해 주세요.",
        CREDIT_LIMIT: "OpenRouter 크레딧 또는 사용 한도를 확인해 주세요.",
        DAILY_LIMIT: "무료 모델의 일일 한도에 도달했습니다.",
        RATE_LIMIT: "요청 속도 제한에 도달했습니다. 잠시 후 다시 시도하세요.",
        SEARCH_UNSUPPORTED:
          "이 모델이나 제공업체는 요청한 검색을 지원하지 않습니다.",
      }[code] ?? "모델이 요청을 처리하지 못했습니다.",
      result.status === 429 ? 429 : 502,
      retryAfter ? { retryAfter } : undefined,
    );
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new AppError(
      "LLM_TRUNCATED",
      "모델 출력이 중간에 잘렸습니다. 완료된 결과로 저장하지 않았습니다.",
      502,
    );
  let content;
  try {
    content = JSON.parse(choice?.message?.content);
  } catch {
    throw new AppError(
      "LLM_FORMAT",
      "모델이 유효한 JSON을 반환하지 않았습니다.",
      502,
    );
  }
  if (!content || typeof content !== "object" || Array.isArray(content))
    throw new AppError(
      "LLM_FORMAT",
      "모델의 구조화 응답을 확인할 수 없습니다.",
      502,
    );
  if (schema) {
    const parsed = schema.safeParse(content);
    if (!parsed.success)
      throw new AppError(
        "LLM_FORMAT",
        "모델 응답의 필수 항목이 올바르지 않습니다.",
        502,
      );
    content = parsed.data;
  }
  const sources = extractSources(choice.message);
  if (search && !sources.length)
    throw new AppError(
      "SEARCH_UNSUPPORTED",
      "실제 검색 출처를 받지 못했습니다. 조사를 완료로 표시하지 않습니다.",
      502,
    );
  return { content, sources, model: data.model ?? model, purpose };
}
export async function getUsage(ctx) {
  const appAttempts = ctx.db
    ? (
        await ctx.db
          .prepare(
            "SELECT COALESCE(SUM(llm_attempts),0) AS n FROM sessions WHERE owner_id=?",
          )
          .bind(ctx.ownerId)
          .first()
      ).n
    : 0;
  if (!ctx.env.OPENROUTER_API_KEY)
    return { appAttempts, providerRemainingCalls: null, creditRemaining: null };
  try {
    const r = await (ctx.fetchImpl ?? fetch)(`${base}/key`, {
      headers: { Authorization: `Bearer ${ctx.env.OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw Error();
    const { data } = await r.json();
    return {
      appAttempts,
      providerRemainingCalls: null,
      creditRemaining:
        typeof data?.limit_remaining === "number" ? data.limit_remaining : null,
    };
  } catch {
    return { appAttempts, providerRemainingCalls: null, creditRemaining: null };
  }
}
