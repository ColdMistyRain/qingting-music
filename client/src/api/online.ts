import type { OnlineLyricsInfo, OnlineSearchResult, OnlineStreamInfo } from "@qingting/shared";
import { apiGet } from "./http";

/**
 * 在线音源 API（PRD 3.5 / ON-01~05）：全部经自建后端透传（浏览器不直连音源 API）。
 * 错误语义：404 = 没有这个音源 / 未配置；502 = 音源暂时连不上；400 = 参数不合法。
 */

/** 关键词搜索（ON-02），结果为统一格式 */
export function fetchOnlineSearch(provider: string, keyword: string): Promise<OnlineSearchResult> {
  return apiGet<OnlineSearchResult>(
    `/api/online/${encodeURIComponent(provider)}/search?keywords=${encodeURIComponent(keyword)}`,
  );
}

/** 播放直链（ON-03）：`null` = 暂无可用音源（VIP / 无版权） */
export function fetchOnlineStreamUrl(provider: string, nativeId: string): Promise<string | null> {
  return apiGet<OnlineStreamInfo>(
    `/api/online/${encodeURIComponent(provider)}/stream?id=${encodeURIComponent(nativeId)}`,
  ).then((info) => info.url);
}

/** 歌词原文（ON-05）：LRC / yrc；`null` = 这首歌没有歌词 */
export function fetchOnlineLyrics(provider: string, nativeId: string): Promise<string | null> {
  return apiGet<OnlineLyricsInfo>(
    `/api/online/${encodeURIComponent(provider)}/lyrics?id=${encodeURIComponent(nativeId)}`,
  ).then((info) => info.lyrics);
}
