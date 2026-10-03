import type { OnlinePlaylistInfo, OnlineProfile, OnlineTrack } from "@qingting/shared";
import type { AppConfig } from "../../config.js";
import { createNeteaseProvider } from "./netease.js";

/**
 * 音源适配层（ON-01）：统一 Provider 接口。
 *
 * 播放器与前端页面**不感知具体音源**：路由层只认这里的四个方法，
 * QQ 音乐（ON-06）/ 酷狗（ON-08）将来各自实现一份、在 `resolveProvider` 里挂上即可。
 * 多源架构参考 Folia（folia-major，AGPL-3.0）的**思路** —— 只借鉴分层，不搬代码（见 PRD 9 风险）。
 */
/** 音源内的账号能力（ON-10）。QQ（微信扫码）/ 酷狗接入时实现同一形状 */
export interface OnlineAccount {
  /** 生成一次扫码登录：返回轮询 key 与二维码（data URL，客户端直接 <img>） */
  createLogin(): Promise<{ key: string; qrDataUrl: string }>;
  /** 轮询扫码状态；`success` 时带回会话 Cookie（服务端落盘） */
  checkLogin(key: string): Promise<{
    state: "waiting" | "scanned" | "success" | "expired";
    cookie: string[];
  }>;
  /** 用会话拿账号资料；会话无效返回 null */
  getProfile(cookie: string[]): Promise<OnlineProfile | null>;
  /** 让上游注销这个会话（本地凭据由路由层清）；尽力而为，不因上游失败而中断退出 */
  logout(cookie: string[]): Promise<void>;
}

/** 音源内的收藏夹（登录后的"我在这个平台的歌单"） */
export interface OnlineCollections {
  getPlaylists(userId: string, cookie: string[]): Promise<OnlinePlaylistInfo[]>;
  /** 拉全一份歌单的曲目（适配器自己分页，调用方一次拿全） */
  getPlaylistTracks(playlistId: string, cookie: string[]): Promise<OnlineTrack[]>;
}

export interface OnlineProvider {
  /** 路由段：`/api/online/:provider/...` 里的那个名字 */
  id: string;
  /** 关键词搜索（ON-02），结果为统一格式 `OnlineTrack`；`cookie` = 登录会话（可选，影响可播范围） */
  search(keyword: string, cookie?: string[]): Promise<OnlineTrack[]>;
  /**
   * 播放直链（ON-03）。`null` = 暂无可用音源（VIP / 无版权 / 下架）——
   * **用 null 表达"没有"**，别用抛错：那是可预期的业务结果，不是故障。
   * 带登录会话时适配器可以请求更高音质档位。
   */
  getStreamUrl(id: string, cookie?: string[]): Promise<string | null>;
  /**
   * 歌词原文（LRC / yrc 均可，客户端解析器都认）+ 可选的翻译 LRC（tlyric，
   * 与原文同时间轴，v6.40）。`lyrics: null` = 这首歌没有歌词（ON-05）。
   */
  getLyrics(
    id: string,
    cookie?: string[],
  ): Promise<{
    lyrics: string | null;
    translation: string | null;
    roman: string | null;
  }>;
  /**
   * 封面代理白名单（SSRF 防线）：`/api/online/:provider/cover` 只转发**这里放行**的 URL。
   * 音源返回的封面地址都在它自家 CDN 上，按 host 后缀放行即可；别写成"任意 URL 都转发"。
   */
  canProxyCover(url: string): boolean;
  /** 账号能力（扫码登录）；音源不支持时缺省，路由层据此回 404 */
  account?: OnlineAccount;
  /** 收藏夹能力；音源不支持时缺省 */
  collections?: OnlineCollections;
}

/**
 * 上游音源不可达 / 回应不成形（超时、非 JSON、HTTP 5xx、缺关键字段）。
 * 路由层据此回 502 —— 与"音源没配"（404）和"没这首歌的地址"（业务 null）区分开。
 * `status` 带上游的 HTTP 状态（内嵌库从 body.code 归一出来），给"接口不存在回落"这类判断用。
 */
export class UpstreamError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

/**
 * 按路由段找到音源实例；没这个 provider 返回 `null`，路由层统一回 404。
 * 所有 provider 的创建都收在这一处：加新音源只改这个函数。
 *
 * 网易云（v6.29 起）**默认走内嵌库**（`@neteasecloudmusicapienhanced/api`，MIT）——
 * 部署零配置；配了 `NETEASE_API_BASE` 则改走外接自部署服务（想用 docker 版 /
 * 换增强分支 / 隔离版本时用），两种接法共享同一套映射。
 */
export function resolveProvider(config: AppConfig, id: string): OnlineProvider | null {
  if (id === "netease") {
    return config.neteaseApiBase
      ? createNeteaseProvider({ baseUrl: config.neteaseApiBase })
      : createNeteaseProvider({});
  }
  return null;
}
