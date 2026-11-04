export async function api(path, method = "GET", data) {
  let r;
  try {
    r = await fetch("/api" + path, {
      method,
      headers: data ? { "Content-Type": "application/json" } : undefined,
      body: data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw Object.assign(
      new Error(
        "서버에 연결할 수 없습니다. 기록을 새로고침한 뒤 다시 시도하세요.",
      ),
      { code: "NETWORK" },
    );
  }
  let value;
  try {
    value = await r.json();
  } catch {
    throw new Error("서버 응답을 확인하지 못했습니다.");
  }
  if (!r.ok)
    throw Object.assign(
      new Error(value.error?.message ?? "요청을 처리하지 못했습니다."),
      value.error ?? {},
    );
  return value;
}
