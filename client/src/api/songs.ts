import type { Song, SongListResult } from "@qingting/shared";
import { ApiError, apiDelete, apiGet } from "./http";

/** 云端曲库接口（PRD 3.4 / LB-04）。列表一次拿全，过滤与排序在客户端做（LB-07） */
export function fetchSongs(): Promise<SongListResult> {
  return apiGet<SongListResult>("/api/songs");
}

/** 删除一首云端曲目（LB-05）：服务端会一并删掉音频与封面文件 */
export function deleteSong(id: string): Promise<{ id: string }> {
  return apiDelete<{ id: string }>(`/api/songs/${encodeURIComponent(id)}`);
}

/**
 * 云端曲目的内嵌歌词（LR-02 第一优先级）。
 * 正文不进列表响应（一首几 KB，列表不该拖着它走），开播时按需取；没有歌词时 lyrics 为 null。
 */
export function fetchLyrics(id: string): Promise<{ lyrics: string | null }> {
  return apiGet<{ lyrics: string | null }>(`/api/songs/${encodeURIComponent(id)}/lyrics`);
}

/** 后端不可用/未接入时给页面一个可读的提示，而不是白屏 */
export function libraryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录已失效，请重新登录后再看曲库。";
    if (error.status === 403) return "当前身份没有查看曲库的权限。";
    return error.message;
  }
  return "连接不上服务器，请确认后端已启动。";
}

export type { Song };
