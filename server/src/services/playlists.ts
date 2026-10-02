import { nanoid } from "nanoid";
import {
  dedupePlaylistItems,
  type Playlist,
  type PlaylistItem,
  type TrackSource,
} from "@qingting/shared";
import { createJsonStore } from "./jsonStore.js";

/**
 * 歌单存储（PS-01 / PRD 12：`data/playlists.json`）。
 *
 * 与曲库索引（`services/storage.ts`）完全同一套做法，而且共用同一份实现
 * （`services/jsonStore.ts`）：单文件 JSON、原子写、读-改-写串行、读坏了的条目跳过而不是让接口崩。
 */

const store = createJsonStore<Playlist[]>({
  fileName: "playlists.json",
  fallback: () => [],
  parse: (value) => {
    if (!Array.isArray(value)) throw new Error("playlists.json 不是一个数组");
    return value.map(sanitizePlaylist).filter((entry): entry is Playlist => entry !== null);
  },
});

export function playlistsFilePath(dataDir: string): string {
  return store.filePath(dataDir);
}

/** 读取歌单；文件不存在、内容损坏、条目脏都按“少一个歌单”处理 */
export function loadPlaylists(dataDir: string): Promise<Playlist[]> {
  return store.load(dataDir);
}

/** 原子写入歌单 */
export function savePlaylists(dataDir: string, playlists: readonly Playlist[]): Promise<void> {
  return store.save(dataDir, [...playlists]);
}

/** 读-改-写歌单（v6.8）：路由里的新建 / 改名 / 整表替换 / 删除都走这里 */
export function updatePlaylists(
  dataDir: string,
  change: (playlists: Playlist[]) => Playlist[] | Promise<Playlist[]>,
): Promise<Playlist[]> {
  return store.update(dataDir, change);
}

/** 新建歌单：id 用 nanoid，与曲库曲目 id 独立 */
export function createPlaylist(name: string, now: string = new Date().toISOString()): Playlist {
  return { id: nanoid(), name, items: [], createdAt: now, updatedAt: now };
}

/** 改名：只动 name 与 updatedAt，创建时间与曲目保持不动 */
export function renamePlaylist(playlist: Playlist, name: string, now: string): Playlist {
  return { ...playlist, name, updatedAt: now };
}

/**
 * 整表替换曲目（PS-02 添加 / PS-04 移除与排序）。
 *
 * 为什么是“整表替换”而不是 add/remove 两个接口：歌单是**有序列表**，
 * 添加、移除、拖动排序本质都是“新的一份顺序”，客户端把结果整份发回来最简单也最不容易错；
 * 去重与顺序在整个数组上做一次（`dedupePlaylistItems`，前后端共用一份规则）。
 */
export function withPlaylistItems(
  playlist: Playlist,
  items: readonly PlaylistItem[],
  now: string,
): Playlist {
  return { ...playlist, items: dedupePlaylistItems(items), updatedAt: now };
}

const ITEM_SOURCES: readonly TrackSource[] = ["local", "server", "online"];

/** 单条曲目引用的运行时校验：手工改坏的 JSON / 畸形请求体都不该把接口带崩 */
export function sanitizePlaylistItem(value: unknown): PlaylistItem | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.source !== "string" || !ITEM_SOURCES.includes(raw.source as TrackSource)) {
    return null;
  }
  if (typeof raw.title !== "string" || typeof raw.artist !== "string") return null;

  const item: PlaylistItem = {
    source: raw.source as TrackSource,
    title: raw.title,
    artist: raw.artist,
  };
  if (typeof raw.refId === "string" && raw.refId) item.refId = raw.refId;
  if (typeof raw.cover === "string" || raw.cover === null) item.cover = raw.cover;
  if (typeof raw.duration === "number" && Number.isFinite(raw.duration)) {
    item.duration = raw.duration;
  }
  return item;
}

/** 歌单的运行时校验：id / name 必需，其余能给默认值就给 */
function sanitizePlaylist(value: unknown): Playlist | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) return null;
  if (typeof raw.name !== "string") return null;

  const items = Array.isArray(raw.items)
    ? raw.items.map(sanitizePlaylistItem).filter((item): item is PlaylistItem => item !== null)
    : [];
  // 时间戳缺失时用 epoch：一眼能看出这条数据不对，又不至于让列表接口报错
  const fallback = new Date(0).toISOString();
  return {
    id: raw.id,
    name: raw.name,
    items,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : fallback,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : fallback,
  };
}
