import type { Playlist, PlaylistItem, PlaylistListResult } from "@qingting/shared";
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from "./http";

/** 歌单接口（PRD 3.6 / 5.6）。全部是访客级（AC-03），登录的访客也能建与改 */
export function fetchPlaylists(): Promise<PlaylistListResult> {
  return apiGet<PlaylistListResult>("/api/playlists");
}

export function createPlaylist(name: string): Promise<Playlist> {
  return apiPost<Playlist>("/api/playlists", { name });
}

export function renamePlaylist(id: string, name: string): Promise<Playlist> {
  return apiPut<Playlist>(`/api/playlists/${encodeURIComponent(id)}`, { name });
}

/** 整表替换曲目：添加、移除、排序都是它（服务端会再去重一次） */
export function replacePlaylistItems(
  id: string,
  items: readonly PlaylistItem[],
): Promise<Playlist> {
  return apiPut<Playlist>(`/api/playlists/${encodeURIComponent(id)}/items`, { items });
}

export function deletePlaylist(id: string): Promise<{ id: string }> {
  return apiDelete<{ id: string }>(`/api/playlists/${encodeURIComponent(id)}`);
}

/** 后端不可用/未接入时给页面一句可读的话，而不是白屏 */
export function playlistErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已失效，请重新登录后再看歌单。";
    if (error.status === 404) return "这个歌单不在了，可能已在别处删除。";
    return error.message;
  }
  return "连接不上服务器，请确认后端已启动。";
}
