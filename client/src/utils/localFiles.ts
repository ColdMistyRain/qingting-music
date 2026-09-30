import { fileExtension, isAudioFileName, type Track } from "@qingting/shared";

/**
 * 本地文件相关纯逻辑（PRD 3.3 LC-02/03）。
 * 只做字符串与对象变换，不碰 DOM，便于单测。
 */

export interface LocalNameParts {
  title: string;
  artist: string;
}

const UNKNOWN_ARTIST = "未知歌手";
/** 曲序前缀："01. " / "1 - " / "03_" / "12)" */
const TRACK_NUMBER_PREFIX = /^\s*\d{1,3}\s*[-._)]\s*/;
/** 首选分隔符：空格包围的连字符（"周杰伦 - 晴天"） */
const SPACED_SEPARATOR = /\s+[-–—]\s+/;
/** 备选：最后一个连字符，覆盖 "BEYOND-海阔天空"、"A-Lin-给我一个理由忘记" 这类无空格命名 */
const ANY_DASH = /[-–—]/g;

/**
 * 文件名回退解析（LC-03）：无标签时按 "歌手 - 歌名" 拆分；
 * 识别不出歌手时标题用整段文件名，歌手记为"未知歌手"。
 */
export function parseLocalFileName(fileName: string): LocalNameParts {
  const extension = fileExtension(fileName);
  const withoutExtension = extension ? fileName.slice(0, fileName.length - extension.length - 1) : fileName;
  const cleaned = withoutExtension.replace(TRACK_NUMBER_PREFIX, "").trim();

  const spaced = SPACED_SEPARATOR.exec(cleaned);
  if (spaced) {
    const artist = cleaned.slice(0, spaced.index).trim();
    const title = cleaned.slice(spaced.index + spaced[0].length).trim();
    if (artist && title) return { title, artist };
  }

  return splitOnLastDash(cleaned) ?? { title: cleaned || fileName.trim(), artist: UNKNOWN_ARTIST };
}

/**
 * 按最后一个连字符拆分（"BEYOND-海阔天空"）。
 * 两侧都要求 ≥ 2 个字符：既能拆 "Adele-Rolling in the Deep"，
 * 又不会把本身就是连字符的歌手名（"A-Lin"）拆成 A / Lin。
 * 局限：纯西文的 "Hello-World" 这种标题会被误拆——有标签时以标签为准。
 */
function splitOnLastDash(text: string): LocalNameParts | null {
  const matches = [...text.matchAll(ANY_DASH)];
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return null;

  const artist = text.slice(0, last.index).trim();
  const title = text.slice(last.index + 1).trim();
  if (artist.length < 2 || title.length < 2) return null;
  return { title, artist };
}

/** 过滤出音频文件（LC-02），非音频交给调用方提示 */
export function pickAudioFiles<T extends { name: string }>(files: readonly T[]): T[] {
  return files.filter((file) => isAudioFileName(file.name));
}

/** 文件名 + 大小 + 修改时间构成稳定 ID，重复拖入同一文件时可直接去重 */
export function localTrackId(file: { name: string; size: number; lastModified: number }): string {
  return `local:${file.name}:${file.size}:${file.lastModified}`;
}

/** 由本地文件信息与 Blob URL 组装统一曲目对象（LC-06：URL 仅在浏览器本地有效） */
export function toLocalTrack(
  file: { name: string; size: number; lastModified: number },
  url: string,
): Track {
  const { title, artist } = parseLocalFileName(file.name);
  return {
    id: localTrackId(file),
    source: "local",
    url,
    title,
    artist,
    album: "本地文件",
    cover: null,
    duration: null,
  };
}

/**
 * 读出音频时长（本地文件没有标签可读时的唯一来源）；读不出返回 null。
 * createElement 可注入，便于单测用假元素驱动 loadedmetadata / error。
 */
export function probeDuration(
  url: string,
  createElement: () => HTMLAudioElement = () => new Audio(),
): Promise<number | null> {
  return new Promise((resolve) => {
    const element = createElement();
    let settled = false;

    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      element.src = "";
      resolve(value);
    };

    element.addEventListener("loadedmetadata", () => {
      const seconds = element.duration;
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    });
    element.addEventListener("error", () => finish(null));

    element.preload = "metadata";
    element.src = url;
  });
}
