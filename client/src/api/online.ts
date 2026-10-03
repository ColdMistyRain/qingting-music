import type {
  OnlineAccountInfo,
  OnlineCollectionsInfo,
  OnlineLyricsInfo,
  OnlinePlaylistTracks,
  OnlineQrCheck,
  OnlineQrLogin,
  OnlineSearchResult,
  OnlineStreamInfo,
} from "@qingting/shared";
import { apiDelete, apiGet, apiPost } from "./http";
import { readOnlineSession, sessionHeaderValue } from "@/utils/onlineSession";

/**
 * 会话头（v6.31）：音源登录 Cookie 存在浏览器 localStorage，每次请求带给自家后端，
 * 后端转交给音源（服务端不留副本）。没有登录就是空头 —— 上游按匿名处理。
 * 封面代理除外：它是 <img> 的 src 带不了自定义头，封面本来就是公开 CDN 资源。
 */
function withSession(provider: string, init: RequestInit = {}): RequestInit {
  const value = sessionHeaderValue(readOnlineSession(provider));
  if (!value) return init;
  return {
    ...init,
    headers: { ...(init.headers ?? {}), "X-Online-Auth": value },
  };
}

/**
 * 在线音源 API（PRD 3.5 / ON-01~05）：全部经自建后端透传（浏览器不直连音源 API）。
 * 错误语义：404 = 没有这个音源 / 未配置；502 = 音源暂时连不上；400 = 参数不合法。
 */

/** 关键词搜索（ON-02），结果为统一格式 */
export function fetchOnlineSearch(provider: string, keyword: string): Promise<OnlineSearchResult> {
  return apiGet<OnlineSearchResult>(
    `/api/online/${encodeURIComponent(provider)}/search?keywords=${encodeURIComponent(keyword)}`,
    withSession(provider),
  );
}

/** 播放直链（ON-03）：`null` = 暂无可用音源（VIP / 无版权） */
export function fetchOnlineStreamUrl(provider: string, nativeId: string): Promise<string | null> {
  return apiGet<OnlineStreamInfo>(
    `/api/online/${encodeURIComponent(provider)}/stream?id=${encodeURIComponent(nativeId)}`,
    withSession(provider),
  ).then((info) => info.url);
}

/** 歌词原文（ON-05）：LRC / yrc；`null` = 这首歌没有歌词 */
export function fetchOnlineLyrics(
  provider: string,
  nativeId: string,
): Promise<{ lyrics: string | null; translation: string | null; roman: string | null }> {
  return apiGet<OnlineLyricsInfo>(
    `/api/online/${encodeURIComponent(provider)}/lyrics?id=${encodeURIComponent(nativeId)}`,
    withSession(provider),
  ).then((info) => ({
    lyrics: info.lyrics,
    translation: info.translation ?? null,
    roman: info.roman ?? null,
  }));
}

/* ---------- 账号（ON-10：扫码登录，听自己在音源收的歌）---------- */

/** 这个 server 记着的音源账号（登录状态 + 资料） */
export function fetchOnlineAccount(provider: string): Promise<OnlineAccountInfo> {
  return apiGet<OnlineAccountInfo>(`/api/online/${encodeURIComponent(provider)}/login`, withSession(provider));
}

/** 生成一次扫码登录的二维码 */
export function createOnlineQrLogin(provider: string): Promise<OnlineQrLogin> {
  return apiPost<OnlineQrLogin>(`/api/online/${encodeURIComponent(provider)}/login/qr`);
}

/** 轮询扫码状态（成功时服务端已把会话存下） */
export function checkOnlineQrLogin(provider: string, key: string): Promise<OnlineQrCheck> {
  return apiGet<OnlineQrCheck>(
    `/api/online/${encodeURIComponent(provider)}/login/check?key=${encodeURIComponent(key)}`,
    withSession(provider),
  );
}

/** 退出登录（上游注销 + 清本服务器的凭据） */
export function logoutOnline(provider: string): Promise<void> {
  return apiDelete(`/api/online/${encodeURIComponent(provider)}/login`, withSession(provider));
}

/** 账号在音源里的歌单（收藏夹） */
export function fetchOnlineCollections(provider: string): Promise<OnlineCollectionsInfo> {
  return apiGet<OnlineCollectionsInfo>(
    `/api/online/${encodeURIComponent(provider)}/collections`,
    withSession(provider),
  );
}

/** 一份歌单的全部曲目 */
export function fetchOnlineCollectionTracks(
  provider: string,
  playlistId: string,
): Promise<OnlinePlaylistTracks> {
  return apiGet<OnlinePlaylistTracks>(
    `/api/online/${encodeURIComponent(provider)}/collections/${encodeURIComponent(playlistId)}`,
    withSession(provider),
  );
}
