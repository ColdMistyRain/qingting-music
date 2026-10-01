import { describe, expect, it } from "vitest";
import { AMLL_LAST_LINE_FALLBACK_SECONDS, toAmllLines } from "./amllLyrics";
import { parseLyrics } from "./lyrics";

describe("toAmllLines（本项目歌词 → AMLL）", () => {
  it("行级歌词：每行一个覆盖整行的词，秒换算成毫秒整数", () => {
    const { lines } = parseLyrics("[00:01.00]第一句\n[00:03.50]第二句");
    const [first, second] = toAmllLines(lines);

    expect(first).toMatchObject({
      startTime: 1000,
      endTime: 3500,
      isBG: false,
      isDuet: false,
      translatedLyric: "",
      romanLyric: "",
    });
    expect(first!.words).toHaveLength(1);
    expect(first!.words[0]).toMatchObject({ word: "第一句", startTime: 1000, endTime: 3500 });
    expect(second!.startTime).toBe(3500);
  });

  it("末句没有下一句：给兜底时长，且结束时间必定大于起始", () => {
    const { lines } = parseLyrics("[00:10.00]只有一句");
    const [only] = toAmllLines(lines);

    expect(only!.endTime).toBe(10_000 + AMLL_LAST_LINE_FALLBACK_SECONDS * 1000);
    expect(only!.endTime).toBeGreaterThan(only!.startTime);
  });

  it("同起点的多句（多标签展开）：仍保证 end > start", () => {
    const { lines } = parseLyrics("[00:05.00]甲\n[00:05.00]乙");
    const amll = toAmllLines(lines);

    // 下一句与它同起点 → 原本会得到零时长行，这里往上顶 1ms
    expect(amll[0]!.endTime).toBe(5001);
    expect(amll[0]!.endTime).toBeGreaterThan(amll[0]!.startTime);
    expect(amll[1]!.endTime).toBeGreaterThan(amll[1]!.startTime);
  });

  it("逐字歌词：行尾取最后一个字的结束时间（不依赖兜底）", () => {
    const { lines } = parseLyrics("[2000,3000](0,500,0)你(500,500,0)好(1000,2000,0)世界");
    const [line] = toAmllLines(lines);

    expect(line!.startTime).toBe(2000);
    expect(line!.endTime).toBe(5000);
    expect(line!.words.map((w) => [w.word, w.startTime, w.endTime])).toEqual([
      ["你", 2000, 2500],
      ["好", 2500, 3000],
      ["世界", 3000, 5000],
    ]);
  });

  it("空输入返回空数组（LR-01 无歌词时不炸）", () => {
    expect(toAmllLines([])).toEqual([]);
  });
});
