import type { OnlineTrack } from "@qingting/shared";
import type { AppConfig } from "../../config.js";
import { createNeteaseProvider } from "./netease.js";

/**
 * 音源适配层（ON-01）：统一 Provider 接口。
 *
 * 播放器与前端页面**不感知具体音源**：路由层只认这里的四个方法，
 * QQ 音乐（ON-06）/ 酷狗（ON-08）将来各自实现一份、在 `resolveProvider` 里挂上即可。
 * 多源架构参考 Folia（folia-major，AGPL-3.0）的**思路** —— 只借鉴分层，不搬代码（见 PRD 9 风险）。
 */
export interface OnlineProvider {
  /** 路由段：`/api/online/:provider/...` 里的那个名字 */
  id: string;
  /** 关键词搜索（ON-02），结果为统一格式 `OnlineTrack` */
  search(keyword: string): Promise<OnlineTrack[]>;
  /**
   * 播放直链（ON-03）。`null` = 暂无可用音源（VIP / 无版权 / 下架）——
   * **用 null 表达"没有"**，别用抛错：那是可预期的业务结果，不是故障。
   */
  getStreamUrl(id: string): Promise<string | null>;
  /** 歌词原文（LRC / yrc 均可，客户端解析器都认）；`null` = 这首歌没有歌词（ON-05） */
  getLyrics(id: string): Promise<string | null>;
  /**
   * 封面代理白名单（SSRF 防线）：`/api/online/:provider/cover` 只转发**这里放行**的 URL。
   * 音源返回的封面地址都在它自家 CDN 上，按 host 后缀放行即可；别写成"任意 URL 都转发"。
   */
  canProxyCover(url: string): boolean;
}

/**
 * 上游音源不可达 / 回应不成形（超时、非 JSON、HTTP 5xx、缺关键字段）。
 * 路由层据此回 502 —— 与"音源没配"（404）和"没这首歌的地址"（业务 null）区分开。
 */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * 按路由段找到音源实例；没这个 provider、或它需要的上游地址没配置（ON-04）都返回 `null`，
 * 路由层统一回 404。所有 provider 的创建都收在这一处：加新音源只改这个函数。
 */
export function resolveProvider(config: AppConfig, id: string): OnlineProvider | null {
  if (id === "netease") {
    // 未配置 NETEASE_API_BASE 就没有网易云这个音源（前端靠 /api/config 隐藏入口，这里兜底）
    if (!config.neteaseApiBase) return null;
    return createNeteaseProvider({ baseUrl: config.neteaseApiBase });
  }
  return null;
}
