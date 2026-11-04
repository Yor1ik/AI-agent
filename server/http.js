import { AppError } from "./errors.js";
export async function body(request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("VALIDATION", "JSON 형식으로 보내 주세요.", 415);
  const text = await request.text();
  if (text.length > 100000)
    throw new AppError("VALIDATION", "입력이 너무 깁니다.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION", "입력 형식을 확인해 주세요.");
  }
}
export const json = (value, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
