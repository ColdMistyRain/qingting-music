import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  dedupePlaylistItems,
  type Playlist,
  type PlaylistItem,
  type TrackSource,
} from "@qingting/shared";

/**
 * 歌单存储（PS-01 / PRD 12：`data/playlists.json`）。
 *
 * 与曲库索引（`services/storage.ts`）完全同一套做法：单文件 JSON、**先写 .tmp 再 rename**
 * 的原子替换、每次请求现读现写、读坏了的条目跳过而不是让接口崩。
 * 单进程自用场景没必要上数据库（PRD 5.1）。
 */

export function playlistsFilePath(dataDir: string): string {
  return path.join(dataDir, "playlists.json");
}

/** 读取歌单；文件不存在、内容损坏、条目脏都按“少一个歌单”处理 */
export async function loadPlaylists(dataDir: string): Promise<Playlist[]> {
  try {
    const raw = await readFile(playlistsFilePath(dataDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizePlaylist).filter((entry): entry is Playlist => entry !== null);
  } catch {
    return [];
  }
}

/** 原子写入歌单 */
export async function savePlaylists(
  dataDir: string,
  playlists: readonly Playlist[],
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const target = playlistsFilePath(dataDir);
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(playlists, null, 2), "utf8");
  await rename(temp, target);
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
