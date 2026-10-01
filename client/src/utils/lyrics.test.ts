import { describe, expect, it } from "vitest";
import { currentLineIndex, parseLyrics } from "./lyrics";

/** LR-01 / PRD 11.2：LRC + yrc 解析，非法行容错 */
describe("parseLyrics（LRC 行级）", () => {
  it("解析基本行并换算成秒", () => {
    const { lines, hasWordTiming } = parseLyrics("[00:12.50]第一句\n[01:05.25]第二句");

    expect(lines).toEqual([
      { time: 12.5, text: "第一句" },
      { time: 65.25, text: "第二句" },
    ]);
    expect(hasWordTiming).toBe(false);
  });

  it("一位小数与不带小数都认（0.1s / 0.01s / 0.001s 精度）", () => {
    const { lines } = parseLyrics("[00:01.5]a\n[00:02.05]b\n[00:03.005]c\n[00:04]d");

    expect(lines.map((line) => line.time)).toEqual([1.5, 2.05, 3.005, 4]);
  });

  it("一行挂多个时间标签：展开成多行（副歌重复的常见写法）", () => {
    const { lines } = parseLyrics("[00:10.00][00:20.00]副歌");

    expect(lines).toEqual([
      { time: 10, text: "副歌" },
      { time: 20, text: "副歌" },
    ]);
  });

  it("按时间排序（文件里常常不是顺序的）", () => {
    const { lines } = parseLyrics("[00:30.00]后\n[00:10.00]前");

    expect(lines.map((line) => line.text)).toEqual(["前", "后"]);
  });

  it("应用 [offset:±ms]（不少歌词文件靠它对齐）", () => {
    const { lines } = parseLyrics("[offset:-500]\n[00:10.00]早半秒");

    expect(lines[0]?.time).toBe(9.5);
  });

  it("元信息标签被忽略，不会当成歌词", () => {
    const { lines } = parseLyrics("[ti:歌名]\n[ar:歌手]\n[al:专辑]\n[by:某人]\n[00:01.00]正文");

    expect(lines).toEqual([{ time: 1, text: "正文" }]);
  });

  it("非法行/空行/纯时间戳行一律跳过（容错，不抛错）", () => {
    const { lines } = parseLyrics("这是没有时间戳的一行\n\n[00:05.00]\n[abc]乱写\n[00:07.00]正常");

    expect(lines).toEqual([{ time: 7, text: "正常" }]);
  });

  it("空字符串与纯空白不崩", () => {
    expect(parseLyrics("")).toEqual({ lines: [], hasWordTiming: false });
    expect(parseLyrics("\n\n   \n")).toEqual({ lines: [], hasWordTiming: false });
  });
});

describe("parseLyrics（yrc 逐字）", () => {
  it("解析逐字片段：行时间与字时间都换算成秒，行文本由字拼接", () => {
    const { lines, hasWordTiming } = parseLyrics("[1000,2000](0,500,0)你(500,500,0)好(1000,1000,0)世界");

    expect(hasWordTiming).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.time).toBe(1);
    expect(lines[0]?.text).toBe("你好世界");
    expect(lines[0]?.words).toEqual([
      { start: 0, duration: 0.5, text: "你" },
      { start: 0.5, duration: 0.5, text: "好" },
      { start: 1, duration: 1, text: "世界" },
    ]);
  });

  it("无逐字片段的 yrc 行退化为行级", () => {
    const { lines, hasWordTiming } = parseLyrics("[2000,3000]只有行时间");

    expect(hasWordTiming).toBe(false);
    expect(lines).toEqual([{ time: 2, text: "只有行时间" }]);
  });

  it("同一份歌词里混着 LRC 与 yrc 也不崩（极端情况，按行各自解析）", () => {
    const { lines, hasWordTiming } = parseLyrics("[00:01.00]普通行\n[2000,1000](0,400,0)逐(400,600,0)字");

    expect(hasWordTiming).toBe(true);
    expect(lines.map((line) => line.text)).toEqual(["普通行", "逐字"]);
  });
});

describe("currentLineIndex（LR-06 自动居中 / LR-04 景深都靠它）", () => {
  const { lines } = parseLyrics("[00:10.00]一\n[00:20.00]二\n[00:30.00]三");

  it("取最后一条 time <= 当前时间", () => {
    expect(currentLineIndex(lines, 5)).toBe(-1); // 还没到第一句
    expect(currentLineIndex(lines, 10)).toBe(0);
    expect(currentLineIndex(lines, 19.9)).toBe(0);
    expect(currentLineIndex(lines, 20)).toBe(1);
    expect(currentLineIndex(lines, 999)).toBe(2);
  });

  it("空歌词返回 -1", () => {
    expect(currentLineIndex([], 10)).toBe(-1);
  });
});
