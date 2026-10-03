import type { OnlineTrack } from "@qingting/shared";

/**
 * 网易云歌单曲目的 localStorage 缓存（v6.34，需求方："每次点击第三方在线歌单，
 * 都会刷新一会儿，能不能把这个列表数据缓存在 localstorage 中"）。
 *
 * 策略是 **stale-while-revalidate**：点开歌单先把缓存的一份立刻摆出来（秒开），
 * 同时后台照常向音源拉最新的一份，到了就替换并更新缓存 —— 缓存只消灭"空白等待"，
 * 不牺牲数据新鲜度。会话本就存这台浏览器（v6.31），缓存跟着同域；退出登录时一并清掉。
 *
 * 存的是**音源原始条目**（OnlineTrack[]）而不是映射后的播放器曲目：
 * 映射很便宜且随时可做，原始数据更小、以后换映射逻辑也不用迁移缓存。
 */

const KEY_PREFIX = "qt-online-collection:";

/**
 * 缓存有效期（v6.35 补 5，需求方："列表缓存应该有过期时间"）：**24 小时**。
 * 过期即视为无缓存 —— 点开会走「加载中」重新拉取（居中进度条），「刷新列表」不受限。
 * 24h 的量级：歌单不是高频变动的数据，一天内的陈旧基本无感；调这个数只改这里。
 */
export const COLLECTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function storageKey(provider: string, playlistId: string): string {
  return `${KEY_PREFIX}${provider}:${playlistId}`;
}

export interface CachedOnlineCollection {
  provider: string;
  playlistId: string;
  /** 缓存时间（ISO，目前只作展示/排查，读取不做过期淘汰 —— 后台刷新保证新鲜） */
  cachedAt: string;
  tracks: OnlineTrack[];
}

function isOnlineTrack(value: unknown): value is OnlineTrack {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.id === "string" && typeof raw.title === "string";
}

function parse(raw: string | null, provider: string, playlistId: string): CachedOnlineCollection | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const candidate = data as Partial<CachedOnlineCollection>;
  if (candidate.provider !== provider || candidate.playlistId !== playlistId) return null;
  if (!Array.isArray(candidate.tracks)) return null;
  const tracks = candidate.tracks.filter(isOnlineTrack);
  if (tracks.length === 0) return null;
  // 有效期：cachedAt 缺失 / 不是日期 / 超过 TTL，都算过期（= 无缓存，点开会重新拉）
  const cachedAt = typeof candidate.cachedAt === "string" ? candidate.cachedAt : "";
  const cachedMs = Date.parse(cachedAt);
  if (!Number.isFinite(cachedMs)) return null;
  if (Date.now() - cachedMs > COLLECTION_CACHE_TTL_MS) return null;
  return { provider, playlistId, tracks, cachedAt };
}

/** 读某份歌单的缓存；没有 / 坏了 / 不是这份的，返回 null */
export function readCollectionCache(
  provider: string,
  playlistId: string,
): CachedOnlineCollection | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return parse(localStorage.getItem(storageKey(provider, playlistId)), provider, playlistId);
  } catch {
    return null;
  }
}

/** 写入/更新某份歌单的缓存（配额满等异常静默 —— 缓存是提速手段，不该打扰使用） */
export function writeCollectionCache(
  provider: string,
  playlistId: string,
  tracks: OnlineTrack[],
): void {
  if (typeof localStorage === "undefined") return;
  if (tracks.length === 0) return;
  const payload: CachedOnlineCollection = {
    provider,
    playlistId,
    tracks,
    cachedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(storageKey(provider, playlistId), JSON.stringify(payload));
  } catch {
    // 存不下（配额满）就算了：下次点开再等一次网络而已
  }
}

/**
 * 播放时发现某曲目不可播（连试听片段都没有，v6.36 的留白落地）：
 * 把**所有缓存歌单**里对应的条目也标上 unavailable —— 行内标跨刷新持久，
 * 不然重载后从缓存读回又会回到「试听」。没有匹配条目就是静默无操作。
 */
export function markCollectionTrackUnavailable(provider: string, nativeTrackId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const prefix = `${KEY_PREFIX}${provider}:`;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!data || typeof data !== "object") continue;
      const candidate = data as { tracks?: unknown };
      if (!Array.isArray(candidate.tracks)) continue;
      let changed = false;
      const tracks = candidate.tracks.map((entry: unknown) => {
        if (
          entry &&
          typeof entry === "object" &&
          String((entry as { id?: unknown }).id) === nativeTrackId &&
          (entry as { unavailable?: unknown }).unavailable !== true
        ) {
          changed = true;
          return { ...(entry as object), unavailable: true };
        }
        return entry;
      });
      if (changed) localStorage.setItem(key, JSON.stringify({ ...candidate, tracks }));
    }
  } catch {
    // 回写失败静默：播放时的 toast 已经把状态说清楚了
  }
}

/** 清掉某个音源的全部歌单缓存（退出登录时） */
export function clearCollectionCache(provider: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${KEY_PREFIX}${provider}:`)) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
  } catch {
    // 清不掉就算了：死缓存会被 parse 拒收
  }
}
