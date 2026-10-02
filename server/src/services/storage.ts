import { nanoid } from "nanoid";
import {
  SONG_ASSET_FIELDS,
  SONG_EDITABLE_FIELDS,
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  type Song,
  type SongAssetField,
  type SongEditableField,
  type SongListResult,
  type SongMetaPatch,
} from "@qingting/shared";
import { createJsonStore } from "./jsonStore.js";

/**
 * 曲库索引读写（LB-04 / LB-11，PRD 12 数据目录结构）。
 *
 * 索引就是 `data/songs.json` 一个文件：单进程自用场景没必要上数据库（PRD 5.1）。
 * 原子写、读-改-写串行化、坏文件留证都在 `services/jsonStore.ts` 里（歌单与收藏共用同一份）。
 */

const store = createJsonStore<Song[]>({
  fileName: "songs.json",
  fallback: () => [],
  parse: (value) => {
    if (!Array.isArray(value)) throw new Error("songs.json 不是一个数组");
    return value.filter(isSong);
  },
});

export function songsFilePath(dataDir: string): string {
  return store.filePath(dataDir);
}

/** 读取曲库索引；文件不存在或内容损坏都当空库处理（宁可重建，也不要启动即崩） */
export function loadSongs(dataDir: string): Promise<Song[]> {
  return store.load(dataDir);
}

/** 原子写入曲库索引 */
export function saveSongs(dataDir: string, songs: readonly Song[]): Promise<void> {
  return store.save(dataDir, [...songs]);
}

/**
 * 读-改-写曲库索引（v6.8）：路由里的“读一份、改一份、写回”要走这里。
 * 两个并发上传各自读到同一份旧列表时，后写的会把先写的整条覆盖掉（lost update）——
 * 同一个文件的 update 在进程内排队，逐个读-改-写，就不会丢。
 */
export function updateSongs(
  dataDir: string,
  change: (songs: Song[]) => Song[] | Promise<Song[]>,
): Promise<Song[]> {
  return store.update(dataDir, change);
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

/**
 * 读出“手动设置过的资源”（AD-02 扩展，v6.13）。与 `songEditedFields` 同一套清洗：
 * 手改坏的 json 里它可能是字符串，不拦一下会算出 `["c","o",…]` 这种脏值。
 */
export function songEditedAssets(song: Song): SongAssetField[] {
  if (!Array.isArray(song.editedAssets)) return [];
  return SONG_ASSET_FIELDS.filter((asset) => song.editedAssets?.includes(asset));
}

/**
 * 记下“封面/歌词是手动设的”（AD-02 扩展）。
 * 重建索引会拿文件里的内嵌资源重抽一遍，不记账的话一次 reindex 就把人手动选的封面
 * 与手动粘的歌词冲掉了 —— 与 `withSongMeta` 的 `editedFields` 是同一件道理的两种资源。
 */
export function withSongAssets(song: Song, assets: readonly SongAssetField[]): Song {
  const edited = new Set([...songEditedAssets(song), ...assets]);
  return { ...song, editedAssets: SONG_ASSET_FIELDS.filter((asset) => edited.has(asset)) };
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
