export class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export const conflict = () =>
  new AppError(
    "CONFLICT",
    "다른 요청이 기록을 변경했습니다. 새로고침 후 다시 시도하세요.",
    409,
  );
export function publicError(error) {
  if (error instanceof AppError)
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  return Response.json(
    {
      error: {
        code: "INTERNAL",
        message: "처리하지 못했습니다. 기존 기록은 유지됩니다.",
      },
    },
    { status: 500 },
  );
}
