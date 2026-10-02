import type { ListeningData, PlaylistItem } from "@qingting/shared";
import { ApiError, apiDelete, apiGet, apiPost } from "./http";

/** 收藏与最近播放（PS-05，访客级）：两份列表都很小，接口一次给全 */
export function fetchListening(): Promise<ListeningData> {
  return apiGet<ListeningData>("/api/listening");
}

/** 收藏一条（幂等：已经收藏过也不会重复） */
export function addFavorite(item: PlaylistItem): Promise<ListeningData> {
  return apiPost<ListeningData>("/api/listening/favorites", item);
}

/** 取消收藏（key 是身份键，与歌单同一套规则） */
export function removeFavorite(key: string): Promise<ListeningData> {
  return apiDelete<ListeningData>(`/api/listening/favorites/${encodeURIComponent(key)}`);
}

/** 记一次播放（服务端去重 + 置顶 + 截到 100 条） */
export function recordRecent(item: PlaylistItem): Promise<ListeningData> {
  return apiPost<ListeningData>("/api/listening/recent", item);
}

/** 清空最近播放 */
export function clearRecent(): Promise<ListeningData> {
  return apiDelete<ListeningData>("/api/listening/recent");
}

/** 后端不可用/未登录时给页面一句人话 */
export function listeningErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已失效，请重新登录后再看收藏。";
    if (error.status === 403) return "当前身份没有查看收藏的权限。";
    return error.message;
  }
  return "连接不上服务器，请确认后端已启动。";
}
