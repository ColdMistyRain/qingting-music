import type { Song } from "@qingting/shared";
import { ApiError } from "./http";

/**
 * 上传（LB-01 / AD-01）：用 XMLHttpRequest 而不是 fetch——fetch 没有上传进度事件，
 * 而 PRD 要求"每文件实时进度 + 总进度"。
 */

export interface UploadOptions {
  /** 上传进度回调（0~1） */
  onProgress?: (ratio: number) => void;
  /** 同名同大小时覆盖已有文件（LB-02），默认跳过（后端 409 + 业务码） */
  overwrite?: boolean;
  signal?: AbortSignal;
}

/**
 * 这个错误值不值得给“重试”：
 * - 网络中断 / 5xx / 429 / 超时 → 值得（同一文件再试一次可能就过了）；
 * - 400 / 413 / 415 这类“文件本身不合规” → 不值得，重试永远不会成功，
 *   给重试按钮只会误导（v4.27 用户追问“这是最优解法吗”）。
 */
export function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 429) return true;
  return error.status >= 500;
}

/** 解析上传响应：成功返回歌曲，失败抛出带状态码与业务码的错误（纯函数，便于单测） */
export function parseUploadResponse(status: number, body: string): Song {
  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    // 网关错误页之类不是 JSON 的响应，走下面的兜底
  }

  const record = (payload ?? {}) as { code?: number; message?: string; data?: Song };
  if (status >= 200 && status < 300 && record.code === 0 && record.data) return record.data;

  throw new ApiError(status, record.code ?? status, record.message ?? `上传失败（HTTP ${status}）`);
}

export function uploadSong(file: File, options: UploadOptions = {}): Promise<Song> {
  return new Promise<Song>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file, file.name);

    const query = options.overwrite ? "?overwrite=1" : "";
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/songs/upload${query}`);
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        resolve(parseUploadResponse(xhr.status, xhr.responseText));
      } catch (error) {
        reject(error);
      }
    };
    xhr.onerror = () => reject(new Error("网络中断，上传失败"));
    xhr.onabort = () => reject(new DOMException("已取消", "AbortError"));

    if (options.signal) {
      if (options.signal.aborted) {
        xhr.abort();
        return;
      }
      options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
}
