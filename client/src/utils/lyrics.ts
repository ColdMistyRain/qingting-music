/**
 * 歌词解析（LR-01 / PRD 11.2：LRC 行级 + yrc 逐字，非法行必须容错）。
 *
 * 纯函数、不碰 DOM，便于单测（后续歌词引擎只消费这里的输出）。
 * - LRC：`[mm:ss.xx]歌词`，一行可挂多个时间标签；支持 `[offset:±ms]`。
 * - yrc（网易云逐字）：行头 `[起始ms,时长ms]`，行内 `(偏移ms,时长ms,0)字`。
 * - 认不出来的行一律跳过（真实歌词文件里总有空行、注释、乱七八糟的标签）。
 */

/** 逐字片段：时间相对**行首**，单位秒 */
export interface LyricWord {
  start: number;
  duration: number;
  text: string;
}

export interface LyricLine {
  /** 行起始时间，单位秒（已应用 offset、已排序） */
  time: number;
  text: string;
  /** 逐字时间轴（仅 yrc 有），供 LR-05 的卡拉OK填充用 */
  words?: LyricWord[];
}

export interface ParsedLyrics {
  lines: LyricLine[];
  /** 是否存在逐字数据：无则 LR-05 自动退化为整句渐亮 */
  hasWordTiming: boolean;
}

/** `[mm:ss.xx]` / `[mm:ss:xx]` / `[mm:ss]`，一行里可能连着好几个 */
const LRC_TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** yrc 行头：`[起始ms,时长ms]` */
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
/** yrc 行内的逐字片段：`(偏移ms,时长ms,0)字` */
const YRC_WORD = /\((\d+),(\d+),-?\d+\)([^()]*)/g;
/** 元信息标签：`[ti:歌名]` 之类 */
const LRC_META = /^\[([a-z]{2,8}):(.*)\]$/i;

/** 把 "ss.xx" 里的小数部分换算成秒（1 位是 0.1s，2 位 0.01s，3 位 0.001s） */
function fractionToSeconds(fraction: string | undefined): number {
  if (!fraction) return 0;
  const digits = fraction.replace(/[.:]/, "");
  const value = Number(`0.${digits}`);
  return Number.isFinite(value) ? value : 0;
}

export function parseLyrics(raw: string): ParsedLyrics {
  const lines: LyricLine[] = [];
  let hasWordTiming = false;
  /** LRC 的 offset 是毫秒、作用于所有行（不少歌词文件靠它对齐） */
  let offsetMs = 0;

  for (const source of raw.split(/\r?\n/)) {
    const line = source.trim();
    if (!line) continue;

    const meta = LRC_META.exec(line);
    if (meta) {
      if (meta[1]!.toLowerCase() === "offset") {
        const value = Number(meta[2]);
        if (Number.isFinite(value)) offsetMs = value;
      }
      continue;
    }

    const yrc = YRC_LINE.exec(line);
    if (yrc) {
      const startMs = Number(yrc[1]);
      const text = yrc[3]!.trim();
      if (!Number.isFinite(startMs)) continue;

      const words: LyricWord[] = [];
      for (const match of yrc[3]!.matchAll(YRC_WORD)) {
        const offset = Number(match[1]);
        const duration = Number(match[2]);
        const word = match[3] ?? "";
        if (!Number.isFinite(offset) || !Number.isFinite(duration) || !word) continue;
        words.push({ start: offset / 1000, duration: duration / 1000, text: word });
      }

      if (words.length > 0) {
        hasWordTiming = true;
        lines.push({ time: startMs / 1000, text: words.map((word) => word.text).join(""), words });
      } else if (text) {
        lines.push({ time: startMs / 1000, text });
      }
      continue;
    }

    LRC_TIMESTAMP.lastIndex = 0;
    const stamps = [...line.matchAll(LRC_TIMESTAMP)];
    if (stamps.length === 0) continue; // 不认识的行走掉（容错）

    const text = line.replace(LRC_TIMESTAMP, "").trim();
    if (!text) continue;

    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]);
      const time = minutes * 60 + seconds + fractionToSeconds(stamp[3]) + offsetMs / 1000;
      if (Number.isFinite(time)) lines.push({ time, text });
    }
  }

  // 真实歌词文件常常不是按时间排的（多标签展开后更明显）
  lines.sort((a, b) => a.time - b.time);

  return { lines, hasWordTiming };
}

/**
 * 当前该高亮的行：二分找最后一条 `time <= 当前时间`（LR-06 自动居中、LR-04 景深都靠它）。
 * 还没到第一句时返回 -1。
 */
export function currentLineIndex(lines: readonly LyricLine[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const line = lines[mid];
    if (line && line.time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/**
 * 逐字填充进度（LR-05）：返回当前句每个字的进度 0~1。
 * 字自带时长时按它算（yrc）；没有时长就退化为"到下一个字就算满"——
 * 宁可早亮也不要亮不起来（真实歌词里残缺的逐字时间轴很多）。
 */
export function wordFillProgress(line: LyricLine, time: number): number[] {
  const words = line.words;
  if (!words?.length) return [];
  return words.map((word) => {
    const span = word.duration > 0 ? word.duration : 0.001;
    if (time >= word.start + span) return 1;
    if (time <= word.start) return 0;
    return (time - word.start) / span;
  });
}

/**
 * 行级进度 0~1（LR-05 的降级路径："仅行级数据时整句渐亮"）。
 * 句子时长取"到下一句开始"——这是 LRC 唯一能给出的时长信息；
 * 末句没有下一句，给一个兜底秒数免得整句瞬间满格（太小）或永远不满（太大）。
 */
export function lineProgress(lines: readonly LyricLine[], index: number, time: number): number {
  const line = lines[index];
  if (!line) return 0;
  const next = lines[index + 1];
  const span = Math.max((next ? next.time : line.time + LINE_FALLBACK_SECONDS) - line.time, 0.3);
  return Math.min(1, Math.max(0, (time - line.time) / span));
}

/** 末句时长兜底（秒）：没有下一句可参照时的默认整句时长 */
const LINE_FALLBACK_SECONDS = 6;
