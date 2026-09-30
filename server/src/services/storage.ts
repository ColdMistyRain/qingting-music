import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { Song, SongListResult } from "@qingting/shared";

/**
 * 曲库索引读写（LB-04 / LB-11，PRD 12 数据目录结构）。
 *
 * 索引就是 `data/songs.json` 一个文件：单进程自用场景没必要上数据库（PRD 5.1）。
 * 写入用「先写 .tmp 再 rename」的原子替换——同文件系统内 rename 是原子的，
 * 进程半路被杀也不会留下半个 JSON 把索引搞坏。
 * 每次请求现读现写（文件很小），不做内存缓存：省掉一整套缓存失效的坑。
 */

export function songsFilePath(dataDir: string): string {
  return path.join(dataDir, "songs.json");
}

/** 读取曲库索引；文件不存在或内容损坏都当空库处理（宁可重建，也不要启动即崩） */
export async function loadSongs(dataDir: string): Promise<Song[]> {
  try {
    const raw = await readFile(songsFilePath(dataDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSong);
  } catch {
    return [];
  }
}

/** 原子写入曲库索引 */
export async function saveSongs(dataDir: string, songs: readonly Song[]): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const target = songsFilePath(dataDir);
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(songs, null, 2), "utf8");
  await rename(temp, target);
}

/** 曲目 id（nanoid）：给前端引用用，与落盘名分开生成 */
export function createSongId(): string {
  return nanoid();
}

/** 落盘用的随机名：杜绝路径穿越，也避免同名文件互相覆盖 */
export function createStoredName(extension: string): string {
  return extension ? `${nanoid()}.${extension}` : nanoid();
}

/** 列表接口的返回：总占用一次算好，概览页直接用（LB-10） */
export function toSongListResult(songs: readonly Song[]): SongListResult {
  return {
    songs: [...songs],
    totalSize: songs.reduce((sum, song) => sum + song.size, 0),
  };
}

/** 运行期校验：手工改坏的 songs.json 里混进脏对象时不至于把接口带崩 */
function isSong(value: unknown): value is Song {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.storedName === "string" &&
    typeof record.title === "string" &&
    typeof record.size === "number"
  );
}
