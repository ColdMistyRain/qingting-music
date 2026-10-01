import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  SONG_EDITABLE_FIELDS,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  type Song,
  type SongEditableField,
  type SongListResult,
  type SongMetaPatch,
} from "@qingting/shared";

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

/**
 * 读出“手动改过的字段”。
 * 一律过这一处清洗：手改坏的 json 里它可能是字符串（`"title".includes(...)` 又恰好为真），
 * 不拦一下会算出 `["t","i","t","l","e"]` 这种脏值。
 */
export function songEditedFields(song: Song): SongEditableField[] {
  if (!Array.isArray(song.editedFields)) return [];
  return SONG_EDITABLE_FIELDS.filter((field) => song.editedFields?.includes(field));
}

/**
 * 应用一次手动编辑（AD-02）。
 *
 * 改哪个字段就把哪个字段记进 `editedFields` —— 重建索引（LB-11）是按文件里的标签重抽的，
 * 不记账的话一次 reindex 就会把人手动填的歌名/歌手冲掉。
 * 歌手与专辑允许清空：退到“未知歌手 / 未知专辑”，列表里不会出现空白行。
 * 注意**不动 `uploadedAt`**：编辑不是重新上传，不该把曲目在“按上传时间”排序里挪位置。
 */
export function withSongMeta(song: Song, patch: SongMetaPatch): Song {
  const edited = new Set(songEditedFields(song));
  const next: Song = { ...song };

  if (patch.title !== undefined) {
    next.title = patch.title;
    edited.add("title");
  }
  if (patch.artist !== undefined) {
    next.artist = patch.artist || UNKNOWN_ARTIST;
    edited.add("artist");
  }
  if (patch.album !== undefined) {
    next.album = patch.album || UNKNOWN_ALBUM;
    edited.add("album");
  }

  // 按固定顺序输出，方便直接看 json
  next.editedFields = SONG_EDITABLE_FIELDS.filter((field) => edited.has(field));
  return next;
}

/** 运行期校验：手工改坏的 songs.json 里混进脏对象时不至于把接口带崩 */ function isSong(
  value: unknown,
): value is Song {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.storedName === "string" &&
    typeof record.title === "string" &&
    typeof record.size === "number"
  );
}
