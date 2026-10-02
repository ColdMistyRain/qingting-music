import { ApiError, apiGet } from "./http";

/** 存储统计（LB-10 / AD-03，管理级）：概览页的曲目数与占用空间 */
export interface StorageStats {
  songCount: number;
  totalSize: number;
}

/**
 * 服务端从曲库索引现算（不另存一份计数，见 `server/src/routes/stats.ts`）——
 * 所以概览页的数字与曲库管理页天然一致，不会出现“两个页面两个数”。
 */
export function fetchStats(): Promise<StorageStats> {
  return apiGet<StorageStats>("/api/stats");
}

/** 后端不可用/未登录时给页面一句人话 */
export function statsErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已失效，请重新登录后再看统计。";
    if (error.status === 403) return "当前身份没有查看存储统计的权限。";
    return error.message;
  }
  return "连接不上服务器，请确认后端已启动。";
}
