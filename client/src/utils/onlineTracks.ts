import type { OnlineTrack, Track } from "@qingting/shared";

/**
 * 在线曲目的纯函数工具（PRD 3.5 / 5.6.1）。
 *
 * 引用键（铁律 4）：在线曲目在歌单 / 收藏 / 最近播放里一律用 `provider:id`
 * （如 `netease:186016`）。播放器 Track 的 `id` 就是这个键，所以
 * `parseOnlineTrackId(track.id)` 随处可用。
 */

/**
 * 在线曲目播放地址的存放策略：**队列与存档里一律不存直链**。
 *
 * 网易云的直链是带签名的临时地址（约 20 分钟过期），存下来只会得到"刷新后放不出的死行"。
 * 所以搜索结果进队列时 `url` 是空串，`player` store 在开播前现解析（`resolveOnlineUrl`）；
 * 存档（PL-07）里的在线曲目同样置空，恢复后第一次按播放时重新解析——id 稳定，随时能续。
 */
export const ONLINE_EMPTY_URL = "";

/** 音源搜索结果 → 播放器曲目（url 留空，开播前由 store 解析） */
export function toOnlineTrack(provider: string, info: OnlineTrack): Track {
  return {
    id: `${provider}:${info.id}`,
    source: "online",
    url: ONLINE_EMPTY_URL,
    title: info.title,
    artist: info.artist,
    album: info.album,
    // 封面走后端代理（VS-02 取色要 same-origin；也躲开混合内容），
    // 直链只出现在搜索结果的 transit 里，不进 Track
    cover: info.cover ? onlineCoverUrl(provider, info.cover) : null,
    duration: info.duration,
    // VIP 专享标记随曲目进列表：行组件据此显示「试听」标（v6.33）
    vipOnly: info.vipOnly,
    // 无版权标记同理：行组件显示「无版权」标（v6.35 补 6）
    unavailable: info.unavailable,
  };
}

/** 音源的显示名（来源列等处用）；没收录的音源直接显示它的 id */
const PROVIDER_LABELS: Record<string, string> = {
  netease: "网易云",
  qq: "QQ 音乐",
  kugou: "酷狗音乐",
};

/**
 * 从引用键解析音源的**显示名**（v6.35 补 3，需求方："来源应该改成实际的来源，
 * 如果来自于网易云就显示网易云"）—— `netease:186016` → "网易云"。
 * 形状不对返回 null（调用方退回通用的「在线」）。
 */
export function onlineProviderLabel(trackId: string): string | null {
  const parsed = parseOnlineTrackId(trackId);
  if (!parsed) return null;
  return PROVIDER_LABELS[parsed.provider] ?? parsed.provider;
}

/** 解析 `provider:id` 引用键；形状不对返回 null（本地/云端 id 冒充在线键时防一手） */
export function parseOnlineTrackId(
  id: string,
): { provider: string; nativeId: string } | null {
  const at = id.indexOf(":");
  if (at <= 0 || at === id.length - 1) return null;
  const provider = id.slice(0, at);
  const nativeId = id.slice(at + 1);
  if (!provider.trim() || !nativeId.trim()) return null;
  return { provider, nativeId };
}

/** 封面代理地址：音源 CDN 的图经自家后端转发（白名单在服务端适配器里） */
export function onlineCoverUrl(provider: string, coverUrl: string): string {
  return `/api/online/${encodeURIComponent(provider)}/cover?url=${encodeURIComponent(coverUrl)}`;
}
