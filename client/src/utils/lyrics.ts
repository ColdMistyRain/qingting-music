/**
 * 歌词解析（LR-01 / PRD 11.2：LRC 行级 + yrc 逐字，非法行必须容错）。
 *
 * 纯函数、不碰 DOM，便于单测（后续歌词引擎只消费这里的输出）。
 * - LRC：`[mm:ss.xx]歌词`，一行可挂多个时间标签；支持 `[offset:±ms]`。
 * - 增强型 LRC：行内再带词级标签 `[mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字…`（v4.87 补上）。
 *   这类文件很常见（各地歌词站导出、K 歌软件），末尾那个没有文字的标签就是**收尾标记**，
 *   所以最后一个字的时长靠它落定；没有收尾标签时用下一句的开始时间兜底。
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
/** 增强型 LRC 的词级标签 `<mm:ss.xx>`（同一个正则也用于行首时间标签） */
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
/** yrc 行头：`[起始ms,时长ms]` */
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/;
/** yrc 行内的逐字片段：`(偏移ms,时长ms,0)字` */
const YRC_WORD = /\((\d+),(\d+),-?\d+\)([^()]*)/g;
/** 元信息标签：`[ti:歌名]` 之类 */
const LRC_META = /^\[([a-z]{2,8}):(.*)\]$/i;
/** 末字拿不到时长时的兜底（秒）：宁可能亮起来，也不要它一直不亮 */
const WORD_FALLBACK_SECONDS = 0.2;
/** 末句（没有下一句可参照）的兜底整句时长（秒）：增强型 LRC 的尾巴补时长用它 */
const LINE_FALLBACK_SECONDS = 6;

/** 把 "ss.xx" 里的小数部分换算成秒（1 位是 0.1s，2 位 0.01s，3 位 0.001s） */
function fractionToSeconds(fraction: string | undefined): number {
  if (!fraction) return 0;
  const digits = fraction.replace(/[.:]/, "");
  const value = Number(`0.${digits}`);
  return Number.isFinite(value) ? value : 0;
}

/** `mm:ss(.xx)` 三段 → 秒；非法返回 NaN */
function stampSeconds(minutes: string, seconds: string, fraction?: string): number {
  const value = Number(minutes) * 60 + Number(seconds) + fractionToSeconds(fraction);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * 归整到毫秒。歌词时间本来就是毫秒精度，而时间相减会留下浮点尾巴
 * （`12.8 − 12 = 0.8000000000000007`）——这个尾巴会一路带到逐字填充与辉光时长上，纯属噪音。
 */
function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * 增强型 LRC 的词级拆分：标签之间的文字就是那个字/词的文本。
 * `base` 传所在行**首个时间标签**的秒数（不带 offset），返回的 `start` 相对行首——与 yrc 同一口径。
 * 行首挂了多个时间标签时，每个副本共用这套相对时间（标签的差量是一样的；
 * 两边的 offset 一起抵消，所以 offset 不会影响词。
 * 末尾那个没有文字的收尾标签会被跳过，于是前一个字的时长正好落在它身上。
 */
function parseWordTags(body: string, base: number): LyricWord[] | null {
  const tags = [...body.matchAll(WORD_TAG)];
  if (tags.length === 0) return null;

  const words: LyricWord[] = [];
  tags.forEach((tag, index) => {
    const start = stampSeconds(tag[1]!, tag[2]!, tag[3]) - base;
    const next = tags[index + 1];
    const end = next ? stampSeconds(next[1]!, next[2]!, next[3]) - base : Number.NaN;
    const text = body.slice(tag.index! + tag[0].length, next ? next.index! : body.length).trim();
    if (!text) return;
    words.push({
      start: roundMs(Math.max(0, start)),
      duration: Number.isFinite(end) ? roundMs(Math.max(0, end - start)) : 0,
      text,
    });
  });

  return words.length > 0 ? words : null;
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
      // offset 是整份文件级的，yrc 也要跟着走（此前只有 LRC 那一支吃了 offset）
      const time = startMs / 1000 + offsetMs / 1000;

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
        lines.push({ time, text: words.map((word) => word.text).join(""), words });
      } else if (text) {
        lines.push({ time, text });
      }
      continue;
    }

    LRC_TIMESTAMP.lastIndex = 0;
    const stamps = [...line.matchAll(LRC_TIMESTAMP)];
    if (stamps.length === 0) continue; // 不认识的行走掉（容错）

    const body = line.replace(LRC_TIMESTAMP, "");
    const base = stamps[0] ? stampSeconds(stamps[0][1]!, stamps[0][2]!, stamps[0][3]) : Number.NaN;
    // 行内带词级标签就是增强型 LRC；词一律按“相对首个时间标签”算
    const words = Number.isFinite(base) ? parseWordTags(body, base) : null;
    // 没拆出词时也要把词级标签剔掉，否则它们会被当成歌词正文显示出来
    const text = words
      ? words.map((word) => word.text).join("")
      : body.replace(WORD_TAG, "").trim();
    if (!text) continue;

    for (const stamp of stamps) {
      const raw = stampSeconds(stamp[1]!, stamp[2]!, stamp[3]);
      if (!Number.isFinite(raw)) continue;
      const time = raw + offsetMs / 1000;
      if (words) {
        hasWordTiming = true;
        // 每个副本给一份自己的词对象：末字时长兑底要按各自的行时间算
        lines.push({ time, text, words: words.map((word) => ({ ...word })) });
      } else {
        lines.push({ time, text });
      }
    }
  }

  // 真实歌词文件常常不是按时间排的（多标签展开后更明显）
  lines.sort((a, b) => a.time - b.time);

  /* 末字时长兜底：没有收尾标签时它会是 0，那样最后一个字永远不会亮（其余字都亮了，
     停在倒数第二个字上很明显）。用"下一句开始 − 这句开始"剩下的时间，至少给 0.2s。 */
  for (const [index, item] of lines.entries()) {
    const words = item.words;
    const last = words?.[words.length - 1];
    if (!last || last.duration > 0) continue;
    const next = lines[index + 1];
    const end = next ? next.time : item.time + LINE_FALLBACK_SECONDS;
    last.duration = roundMs(Math.max(end - (item.time + last.start), WORD_FALLBACK_SECONDS));
  }

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
 *
 * ⚠️ **`word.start` 是“相对本句开头”的**（两个解析器都这么给，见 `parseWordTags` 与 yrc 那一支），
 * 而 `time` 是绝对秒，所以必须先把时间折成**句内进度**再比 —— 直接拿绝对时间去比的话，
 * 任何大于半秒的时间点都会让所有字都算“已完成”：表现是当前句**一上来就整句都是高亮**。
 * 这是 v6.19 实测拓到的（普通 LRC 那层“假填充”一度把这条掩盖了），有单测守着。
 */
export function wordFillProgress(line: LyricLine, time: number): number[] {
  const words = line.words;
  if (!words?.length) return [];
  const inside = time - line.time;
  return words.map((word) => {
    const span = word.duration > 0 ? word.duration : 0.001;
    if (inside >= word.start + span) return 1;
    if (inside <= word.start) return 0;
    return (inside - word.start) / span;
  });
}

/**
 * 自动居中的位移（LR-06）：把当前句挪到窗口垂直中线。
 * **正值 = 列表向上移**（DOM 那边写 `-shift`）——所以：
 * - 上端夹住：刚开头的几句若也推到中线，标题与第一句之间会空出一大片（需求方实拍定稿）；
 * - 上移到「末句刚好到中线」为止（`maxUp` 由调用方按量出来的行位置算好），
 *   再往上就把列表下留白露出来了。
 */
export function centerShift(desired: number, maxUp: number): number {
  if (!Number.isFinite(desired)) return 0;
  const limit = Number.isFinite(maxUp) ? Math.max(0, maxUp) : 0;
  return Math.min(Math.max(desired, 0), limit);
}

/** 手动滚动的位移夹取（LR-07）：同样是正值 = 上移，两端夹住 */
export function clampManualShift(value: number, maxShift: number): number {
  if (!Number.isFinite(value)) return 0;
  const max = Number.isFinite(maxShift) ? Math.max(0, maxShift) : 0;
  return Math.min(Math.max(value, 0), max);
}
