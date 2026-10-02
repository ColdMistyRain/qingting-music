/** 后端统一响应体（PRD 5.6.2）：成功 code 恒为 0，失败用 HTTP 状态码承载语义 */

interface ApiOk<T> {
  code: 0;
  data: T;
}

interface ApiErr {
  code: number;
  message: string;
}

/** 接口错误：带 HTTP 状态与业务码，供页面做分支提示 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(status: number, code: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isOk<T>(payload: unknown): payload is ApiOk<T> {
  return typeof payload === "object" && payload !== null && "code" in payload && payload.code === 0;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", ...init });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // 非 JSON 响应（网关错误页等）走下面的兜底分支
  }

  if (res.ok && isOk<T>(payload)) return payload.data;

  const failure = payload as Partial<ApiErr> | null;
  throw new ApiError(
    res.status,
    failure?.code ?? res.status,
    failure?.message ?? `请求失败（HTTP ${res.status}）`,
  );
}

/** GET 请求，直接返回 data 部分 */
export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

/** POST JSON 请求，直接返回 data 部分 */
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** PUT JSON 请求，直接返回 data 部分（歌单改名与曲目整表替换用它） */
export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/**
 * PUT 二进制（FormData）请求，直接返回 data 部分 —— 换封面（AD-02 扩展）用它。
 * ⚠️ **不要自己写 Content-Type**：多部分请求的 `boundary` 由浏览器生成，
 * 手写一个 `multipart/form-data` 只会把 boundary 弄丢，服务端解析出来是空 body。
 */
export function apiPutForm<T>(path: string, body: FormData): Promise<T> {
  return request<T>(path, { method: "PUT", body });
}

/** DELETE 请求，直接返回 data 部分 */
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}
