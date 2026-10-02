import type { Song, SongListResult, SongMetaPatch } from "@qingting/shared";
import { ApiError, apiDelete, apiGet, apiPut, apiPutForm } from "./http";

/** 云端曲库接口（PRD 3.4 / LB-04）。列表一次拿全，过滤与排序在客户端做（LB-07） */
export function fetchSongs(): Promise<SongListResult> {
  return apiGet<SongListResult>("/api/songs");
}

/** 删除一首云端曲目（LB-05）：服务端会一并删掉音频与封面文件 */
export function deleteSong(id: string): Promise<{ id: string }> {
  return apiDelete<{ id: string }>(`/api/songs/${encodeURIComponent(id)}`);
}

/**
 * 修改曲目的显示信息（AD-02，管理级）：只传改过的字段。
 * 服务端改的是曲库索引（不动音频容器里的标签），并把改过的字段记进 `editedFields`，
 * 重建索引时会保住它们。
 */
export function updateSong(id: string, patch: SongMetaPatch): Promise<Song> {
  return apiPut<Song>(`/api/songs/${encodeURIComponent(id)}`, patch);
}

/**
 * 云端曲目的内嵌歌词（LR-02 第一优先级）。
 * 正文不进列表响应（一首几 KB，列表不该拖着它走），开播时按需取；没有歌词时 lyrics 为 null。
 */
export function fetchLyrics(id: string): Promise<{ lyrics: string | null }> {
  return apiGet<{ lyrics: string | null }>(`/api/songs/${encodeURIComponent(id)}/lyrics`);
}

/**
 * 换一张封面（AD-02 扩展，v6.13）：管理员接口，服务端会把新图落盘并把索引指过去。
 * 浏览器侧的选图预检（扩展名 / 大小）在弹窗里做，这里只管发出去。
 */
export function uploadSongCover(id: string, file: File): Promise<Song> {
  const form = new FormData();
  form.append("cover", file, file.name);
  return apiPutForm<Song>(`/api/songs/${encodeURIComponent(id)}/cover`, form);
}

/** 去掉封面（回到占位图）：索引里不再引用，服务端顺手删掉那张图 */
export function deleteSongCover(id: string): Promise<Song> {
  return apiDelete<Song>(`/api/songs/${encodeURIComponent(id)}/cover`);
}

/**
 * 设置歌词正文（AD-02 扩展，v6.13）：
 * 「上传 .lrc」与「直接粘文本」两条路都走这一个接口 —— 文件那一侧由浏览器先读成文本
 * （`utils/lyricsLibrary` 的 `decodeLyricsBytes`，认 UTF-8 / UTF-16 / GBK）。
 */
export function saveSongLyrics(id: string, text: string): Promise<Song> {
  return apiPut<Song>(`/api/songs/${encodeURIComponent(id)}/lyrics`, { text });
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
