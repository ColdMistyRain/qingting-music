/**
 * 本项目歌词行 → AMLL 播放器行（LR-01/05 的桥接层，v4.84 接入 AMLL）。
 *
 * 两边的差异只有两处，都在这里收口：
 * - **时间单位**：我们（LRC/yrc 解析结果）用秒，AMLL 用**毫秒整数**；
 * - **行级歌词的表达**：只有行时间的格式（LyRiC），AMLL 要求每行至少有一个词，
 *   惯例是"一个词覆盖整行"（其类型注释明确这么写）。逐字（yrc）则把字级偏移
 *   叠加到行起点上。
 * 纯函数、不碰 DOM，便于单测（PRD 11.2）。
 */
import type {
  LyricLine as AmllLyricLine,
  LyricWord as AmllLyricWord,
} from "@applemusic-like-lyrics/core";
import type { LyricLine } from "./lyrics";

/** 末句没有下一句可依时的兜底展示时长（秒） */
export const AMLL_LAST_LINE_FALLBACK_SECONDS = 6;

export function toAmllLines(lines: readonly LyricLine[]): AmllLyricLine[] {
  return lines.map((line, index) => {
    const next = lines[index + 1];
    const startTime = Math.round(line.time * 1000);
    /* 行尾优先取**逐字数据的最后一个字**（yrc 行头自带时长，最后一个字的结束时间
       与它一致），其次取下一句起点，末句才用兜底；并保证 end > start（AMLL 对
       零时长行会按“未开始”处理）。 */
    const wordEnd = line.words?.length
      ? Math.max(...line.words.map((word) => Math.round((word.start + word.duration) * 1000)))
      : null;
    const rawEnd =
      wordEnd !== null
        ? startTime + wordEnd
        : (next ? next.time : line.time + AMLL_LAST_LINE_FALLBACK_SECONDS) * 1000;
    const endTime = Math.max(startTime + 1, Math.round(rawEnd));

    const words: AmllLyricWord[] = line.words?.length
      ? line.words.map((word) => ({
          word: word.text,
          // 字级时间是相对行首的，换算成绝对毫秒
          startTime: startTime + Math.round(word.start * 1000),
          endTime: startTime + Math.round((word.start + word.duration) * 1000),
          obscene: false,
        }))
      : [{ word: line.text, startTime, endTime, obscene: false }];

    return {
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime,
      endTime,
      isBG: false,
      isDuet: false,
    };
  });
}
