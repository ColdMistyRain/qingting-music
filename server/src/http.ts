import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ApiOk } from "@qingting/shared";

/** 成功响应：`{ code: 0, data }`（PRD 5.6.2） */
export function sendOk<T>(res: Response, data: T, status = 200): void {
  const body: ApiOk<T> = { code: 0, data };
  res.status(status).json(body);
}

/**
 * 失败响应：HTTP 状态码承载语义，body 为 `{ code, message }`。
 * businessCode 仅在前端需要分支处理时传入（如 SONG_DUPLICATE）。
 */
export function sendFail(
  res: Response,
  status: number,
  message: string,
  businessCode?: number,
): void {
  res.status(status).json({ code: businessCode ?? status, message });
}

/**
 * 包装 async 处理器，把 rejection 交给 Express 错误中间件。
 * Express 5 已内置该能力，此处保留以兼容在 v4 上运行的情形。
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

/** 未匹配的 /api 路径统一返回 JSON 404，避免前端拿到 HTML */
export function apiNotFound(_req: Request, res: Response): void {
  sendFail(res, 404, "接口不存在");
}

/** 兜底错误处理：不向前端泄露堆栈 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error("[server] 未处理的异常：", err);
  if (res.headersSent) return;
  sendFail(res, 500, "服务器内部错误");
}
