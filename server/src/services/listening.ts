import {
  EMPTY_LISTENING,
  RECENT_LIMIT,
  playlistItemKey,
  type ListeningData,
  type PlaylistItem,
  type RecentEntry,
} from "@qingting/shared";
import { createJsonStore } from "./jsonStore.js";
import { sanitizePlaylistItem } from "./playlists.js";

/**
 * 收藏与最近播放的存储（PS-05 / PRD 12：`data/listening.json`）。
 *
 * 与曲库索引、歌单共用同一份实现（`services/jsonStore.ts`）：原子写、读-改-写串行、读坏了当空。
 * 为什么要放**服务端**而不是 localStorage：这两份是“我的音乐”的一部分 ——
 * 手机上收藏的、电脑上要能看见；清一次浏览器数据不该把它清掉（自部署的私有数据）。
 *
 * 两个列表放同一个文件：它们总是一起被读、一起被写，分成两个文件只会多一份原子写入的代码。
 */

const store = createJsonStore<ListeningData>({
  fileName: "listening.json",
  fallback: () => ({ ...EMPTY_LISTENING }),
  parse: (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("listening.json 不是一个对象");
    }
    const record = value as Record<string, unknown>;
    return { favorites: sanitizeItems(record.favorites), recent: sanitizeRecent(record.recent) };
  },
});

export function listeningFilePath(dataDir: string): string {
  return store.filePath(dataDir);
}

/** 读取；文件不存在、内容损坏、条目脏都按“还没有”处理（不崩） */
export function loadListening(dataDir: string): Promise<ListeningData> {
  return store.load(dataDir);
}

/** 原子写入 */
export function saveListening(dataDir: string, data: ListeningData): Promise<void> {
  return store.save(dataDir, data);
}

/**
 * 读-改-写收藏/最近播放（v6.8）：mutator 原样返回同一个引用则视为“没变化”不落盘
 * —— 现有 `withFavorite` / `withoutFavorite` 就是这么写的（幂等请求不必反复写盘）。
 */
export function updateListening(
  dataDir: string,
  change: (current: ListeningData) => ListeningData | Promise<ListeningData>,
): Promise<ListeningData> {
  return store.update(dataDir, change);
}

function sanitizeItems(value: unknown): PlaylistItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizePlaylistItem).filter((item): item is PlaylistItem => item !== null);
}

function sanitizeRecent(value: unknown): RecentEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = sanitizePlaylistItem(entry);
    if (!item) return [];
    const playedAt = (entry as Record<string, unknown>).playedAt;
    return [{ ...item, playedAt: typeof playedAt === "string" ? playedAt : "" }];
  });
}

/**
 * 收藏（PS-05）：**幂等** —— 已经收藏过的再来一次就原样返回，不重复、也不改顺序
 * （顺序就是“收藏的先后”，改它没有意义，反而会让列表在点第二次时跳一下）。
 */
export function withFavorite(data: ListeningData, item: PlaylistItem): ListeningData {
  const key = playlistItemKey(item);
  if (data.favorites.some((entry) => playlistItemKey(entry) === key)) return data;
  return { ...data, favorites: [...data.favorites, item] };
}

/** 取消收藏：不在里面也算成功（幂等），返回的列表与之前一致 */
export function withoutFavorite(data: ListeningData, key: string): ListeningData {
  const favorites = data.favorites.filter((entry) => playlistItemKey(entry) !== key);
  return favorites.length === data.favorites.length ? data : { ...data, favorites };
}

/**
 * 记一次播放（PS-05）：同一首只留一条、**移到最前**（最近播的排最前），
 * 超出 `RECENT_LIMIT` 的从尾部丢掉。曲目信息用最新的一版覆盖（改过名之后历史也跟着变）。
 */
export function withRecent(
  data: ListeningData,
  item: PlaylistItem,
  playedAt: string,
): ListeningData {
  const key = playlistItemKey(item);
  const rest = data.recent.filter((entry) => playlistItemKey(entry) !== key);
  const recent = [{ ...item, playedAt }, ...rest].slice(0, RECENT_LIMIT);
  return { ...data, recent };
}
