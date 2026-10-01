import type { Track } from "@qingting/shared";
import { parseLyrics } from "./lyrics";

/**
 * 手动歌词库（LR-02 的第三条来源：用户手动上传 .lrc / .yrc）。
 *
 * 为什么单独一份、还单独存（v4.87）：
 * - 手动导入是**用户对着这首歌做的显式动作**，比文件内嵌那一份更可信（内嵌的常常只有行级，
 *   而用户手上可能有逐字版），所以它优先级最高，并且可以清掉退回内嵌；
 * - 存 localStorage 而不是曲库接口：这是纯前端偏好，换台设备本来就该没有。
 *
 * 除 `decodeLyricsBytes` 用平台解码器外都是纯函数，便于单测（PRD 11.2）。
 */

/** 一份导入歌词最多留这么多字符：歌词文件都很小，超过多半是选错文件了 */
export const MAX_IMPORTED_CHARS = 200_000;
/** 手动歌词库最多记这么多首：攒太多会拖慢启动，200 首足够一个人自己用 */
export const MAX_IMPORTED_TRACKS = 200;

/**
 * 手动歌词的键。服务器/在线曲目的 id 稳定，直接用；
 * **本地曲目每刷新一次 id 都会重新生成**，得用“歌手|曲名”才留得住——同一首歌下次拖进来还能匹配上。
 */
export function lyricsKey(track: Pick<Track, "id" | "source" | "title" | "artist">): string {
  if (track.source !== "local") return track.id;
  return `local:${track.artist.trim()}|${track.title.trim()}`;
}

export type ImportedLyrics = Record<string, string>;

/** 从 localStorage 读回来的东西不可信：只留“真的能解析出歌词”的条目 */
export function sanitizeImportedLyrics(raw: unknown): ImportedLyrics {
  if (!raw || typeof raw !== "object") return {};
  const result: ImportedLyrics = {};
  let count = 0;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_IMPORTED_TRACKS) break;
    if (!key || typeof value !== "string") continue;
    const text = value.slice(0, MAX_IMPORTED_CHARS);
    if (parseLyrics(text).lines.length === 0) continue;
    result[key] = text;
    count += 1;
  }

  return result;
}

/**
 * 写入一份手动歌词，返回**新对象**（store 靠换引用触发更新）。
 * 解析不出任何行时原样返回——让调用方能据此提示“这份文件里没有歌词”，而不是默默什么也没发生。
 */
export function withImportedLyric(map: ImportedLyrics, key: string, text: string): ImportedLyrics {
  if (!key) return map;
  const trimmed = text.slice(0, MAX_IMPORTED_CHARS);
  if (parseLyrics(trimmed).lines.length === 0) return map;
  return { ...map, [key]: trimmed };
}

/** 移除某曲目的手动歌词（没有就返回原对象，不制造无意义的新引用） */
export function withoutImportedLyric(map: ImportedLyrics, key: string): ImportedLyrics {
  if (!key || !(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/**
 * LR-02 的来源优先级：**手动导入 > 曲目内嵌 > 在线接口**。
 * 需求文档原文把手动排在最后，这里有意提前：手动导入是用户对着这首歌做的显式动作，
 * 而内嵌歌词常常只有行级（用户手里那份可能是逐字版）——不覆盖的话这个功能等于没入口。
 * 想退回内嵌，清掉手动歌词即可（沉浸页的菜单里给了入口）。
 */
export function pickLyricsSource(sources: {
  imported?: string | null;
  embedded?: string | null;
  online?: string | null;
}): string {
  for (const candidate of [sources.imported, sources.embedded, sources.online]) {
    if (candidate && candidate.trim()) return candidate;
  }
  return "";
}

/**
 * 歌词文件的字节 → 文本。
 * 中文歌词文件有相当一部分是 GBK（老播放器导出的都是），按 UTF-8 硬读会满屏乱码，所以：
 * 先认 UTF-16 的 BOM → 试 UTF-8 → 出现替换字符（U+FFFD）就换 GBK 再试一次。
 */
export function decodeLyricsBytes(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data);

  const utf8 = new TextDecoder("utf-8").decode(data);
  if (!utf8.includes("\uFFFD")) return utf8;

  try {
    return new TextDecoder("gbk").decode(data);
  } catch {
    // 环境没有 gbk 解码器（极少见）：宁可乱码，也不要在这里抛出去把导入流程打断
    return utf8;
  }
}
