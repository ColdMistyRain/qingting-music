import type { Playlist, PlaylistItem } from "@qingting/shared";
import type { PlaylistEntry } from "./playlistEntries";

/**
 * 歌单导出（PS-06）：把歌单写成文件。
 *
 * 两种格式，各有各的用处：
 * - **M3U8**：别的播放器/车机/音响能直接读的通用格式。云端曲目写**绝对地址**
 *   （`<origin>/audio/<storedName>`，手机上的播放器也够得着）；本地曲目与还没接上的
 *   在线音源在文件里**没有可用的地址**，写成注释行把名字留住 —— 不假装它们能播
 *   （与歌单页“这条能不能播”同一套口径）。
 * - **JSON**：自留一份备份（`format` + `version` + 整份 items），换机器/重装后能照着还原。
 *
 * 纯函数，全部有单测（约定：基础函数必须带正常 + 异常路径）。
 */

export interface M3U8Options {
  /** 让云端曲目写成绝对地址（浏览器里传 location.origin）；不传则写相对路径 */
  origin?: string;
}

/** M3U8 的时长字段：不知道就写 -1（规范允许），别写 0 冒充 */
function extinfSeconds(seconds: number | null | undefined): number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds)
    : -1;
}

/** 把一首歌写成 M3U8 的那几行（能播的给地址，不能播的给注释） */
function m3u8Lines(entry: PlaylistEntry, origin: string): string[] {
  const { item, track } = entry;
  const label = `${item.artist ? `${item.artist} - ` : ""}${item.title}`;
  const head = `#EXTINF:${extinfSeconds(item.duration)},${label}`;

  if (track && track.source === "server") {
    return [head, `${origin}${track.url}`];
  }
  if (item.source === "local") {
    return [`# 本地文件（导出时不带地址）：${label}`];
  }
  if (item.source === "online") {
    return [`# 在线音源（未接入）：${label}`];
  }
  return [`# 已不在曲库：${label}`];
}

export function toM3U8(
  playlistName: string,
  entries: readonly PlaylistEntry[],
  options: M3U8Options = {},
): string {
  const origin = options.origin ?? "";
  const lines = [`#EXTM3U`, `# ${playlistName}`];
  for (const entry of entries) lines.push(...m3u8Lines(entry, origin));
  // 文件末尾留一个换行：多数播放器对此宽容，但按行读的工具会少读到一行
  return `${lines.join("\n")}\n`;
}

export const EXPORT_FORMAT = "qingting-playlist";
export const EXPORT_VERSION = 1;

export interface PlaylistExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  name: string;
  exportedAt: string;
  items: PlaylistItem[];
}

/** JSON 备份：存的是歌单原本那份 items（含来源与引用），以后可以照它还原 */
export function toExportJson(playlist: Playlist, exportedAt: string): string {
  const payload: PlaylistExportFile = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    name: playlist.name,
    exportedAt,
    items: playlist.items.map((item) => ({ ...item })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** 文件名清洗：Windows / macOS / Linux 的非法字符统一换成下划线，空白折叠成一个 */
export function exportFileName(playlistName: string, extension: "m3u8" | "json"): string {
  const cleaned = playlistName
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned || "歌单"}.${extension}`;
}
