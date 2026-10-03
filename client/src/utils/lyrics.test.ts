import { describe, expect, it } from "vitest";
import {
  centerShift,
  clampManualShift,
  currentLineIndex,
  findInterludes,
  findSublineLine,
  isCreditLine,
  parseLyrics,
  wordFillProgress,
  type LyricLine,
} from "./lyrics";

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
  it("解析逐字片段：字偏移是绝对歌内毫秒，归一成相对行首的秒", () => {
    const { lines, hasWordTiming } = parseLyrics(
      "[1000,2000](1000,500,0)你(1500,500,0)好(2000,1000,0)世界",
    );

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
    const { lines, hasWordTiming } = parseLyrics(
      "[00:01.00]普通行\n[2000,1000](2000,400,0)逐(2400,600,0)字",
    );

    expect(hasWordTiming).toBe(true);
    expect(lines.map((line) => line.text)).toEqual(["普通行", "逐字"]);
  });
});

describe("parseLyrics（增强型 LRC：行内词级标签，v4.87）", () => {
  it("按词级标签拆字，收尾标签决定最后一个字的时长", () => {
    const { lines, hasWordTiming } = parseLyrics("[00:12.00]<00:12.00>你<00:12.80>好<00:13.60>");

    expect(hasWordTiming).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.time).toBe(12);
    expect(lines[0]?.text).toBe("你好");
    expect(lines[0]?.words).toEqual([
      { start: 0, duration: 0.8, text: "你" },
      { start: 0.8, duration: 0.8, text: "好" },
    ]);
  });

  it("没有收尾标签：末字时长用下一句开始兜底", () => {
    const { lines } = parseLyrics("[00:10.00]<00:10.00>你<00:10.50>好\n[00:13.00]下一句");

    expect(lines[0]?.words?.[1]?.duration).toBeCloseTo(2.5, 6);
  });

  it("末句且没有下一句：至少给 0.2s，不会永远是 0", () => {
    const { lines } = parseLyrics("[00:10.00]<00:10.00>你<00:10.50>好");

    expect(lines[0]?.words?.[1]?.duration).toBeGreaterThanOrEqual(0.2);
  });

  it("一行多时间标签：词时间跟着平移", () => {
    const { lines } = parseLyrics("[00:10.00][00:20.00]<00:10.00>甲<00:10.40>乙<00:10.90>");

    expect(lines.map((item) => [item.time, item.words?.map((word) => word.start)])).toEqual([
      [10, [0, 0.4]],
      [20, [0, 0.4]],
    ]);
  });

  it("offset 对行与词一起生效（词相对行首，不受影响）", () => {
    const { lines } = parseLyrics("[offset:500]\n[00:10.00]<00:10.00>甲<00:10.40>乙<00:10.90>");

    expect(lines[0]?.time).toBe(10.5);
    expect(lines[0]?.words?.[1]).toEqual({ start: 0.4, duration: 0.5, text: "乙" });
  });

  it("yrc 也吃 offset（行时间随 offset 走；字归一成相对行首，不受影响）", () => {
    const { lines } = parseLyrics("[offset:500]\n[1000,2000](1000,500,0)你(1500,500,0)好");

    expect(lines[0]?.time).toBe(1.5);
    expect(lines[0]?.words?.[0]?.start).toBe(0);
  });

  it("只有时间标签、没有文字的增强行不产生空行（也不把标签当正文）", () => {
    expect(parseLyrics("[00:10.00]<00:10.00><00:10.40>").lines).toEqual([]);
  });
});

describe("findInterludes（v6.44 间奏点）", () => {
  it("相邻行起点间隔 ≥ 阈值视为间奏，afterIndex 指向前一行", () => {
    const { lines } = parseLyrics("[00:02.00]前\n[00:24.00]后");
    const interludes = findInterludes(lines);
    expect(interludes).toEqual([{ afterIndex: 0, startTime: 2, endTime: 24 }]);
  });

  it("按阈值筛选：短间隔不算，长间隔算", () => {
    const { lines } = parseLyrics("[00:00.00]一\n[00:03.00]二\n[00:20.00]三");
    expect(findInterludes(lines, 8)).toEqual([{ afterIndex: 1, startTime: 3, endTime: 20 }]);
    expect(findInterludes(lines, 25)).toEqual([]);
  });

  it("空歌词 / 单行：无间奏", () => {
    expect(findInterludes([])).toEqual([]);
    const { lines } = parseLyrics("[00:01.00]只有一行");
    expect(findInterludes(lines)).toEqual([]);
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

describe("wordFillProgress（LR-05 逐字填充）", () => {
  // 本句起点 1.0s，字一律是“相对本句开头”的（解析器的约定）——
  // 所以下面一律喂**绝对时间**（组件就是这么喂的）；早期这组用例喂的是相对时间，
  // 正好把“绝对时间去比相对起点”这个 bug 掩盖了（v6.19 实测抓到）。
  const { lines } = parseLyrics("[1000,2000](1000,500,0)你(1500,500,0)好(2000,1000,0)世界");
  const line = lines[0]!;

  it("按字自己的时间算进度，唱完为 1", () => {
    expect(wordFillProgress(line, 1.25)).toEqual([0.5, 0, 0]);
    expect(wordFillProgress(line, 1.5)).toEqual([1, 0, 0]);
    expect(wordFillProgress(line, 2.5)).toEqual([1, 1, 0.5]);
    expect(wordFillProgress(line, 100)).toEqual([1, 1, 1]);
  });

  it("行首之前全是 0（还没轮到这句）", () => {
    expect(wordFillProgress(line, 0.5)).toEqual([0, 0, 0]);
  });

  it("增强型 LRC（行内词级标签）：绝对时间也算成句内进度", () => {
    const { lines: enhanced } = parseLyrics("[00:10.00]<00:10.00>你<00:11.00>好<00:12.00>世");
    const target = enhanced[0]!;
    expect(wordFillProgress(target, 10)).toEqual([0, 0, 0]);
    expect(wordFillProgress(target, 10.5)).toEqual([0.5, 0, 0]);
    expect(wordFillProgress(target, 11.5)).toEqual([1, 0.5, 0]);
  });

  it("没有逐字数据返回空数组（交给行级降级路径）", () => {
    const plain = parseLyrics("[00:01.00]只有行级").lines[0]!;
    expect(wordFillProgress(plain, 5)).toEqual([]);
  });

  it("字时长为 0 时不除零：到点即满", () => {
    const zero = parseLyrics("[0,1000](0,0,0)甲(0,500,0)乙").lines[0]!;
    expect(wordFillProgress(zero, 0.3)).toEqual([1, 0.6]);
  });
});

describe("centerShift（自动居中：上端夹住、往上到末句到中线为止）", () => {
  it("开头几句：还想往上挪就贴着顶部不动（不把第一行推到中线）", () => {
    expect(centerShift(-120, 1600)).toBe(0);
  });

  it("中间：原样返回", () => {
    expect(centerShift(500, 1600)).toBe(500);
  });

  it("末尾：不超过上移上限（末句刚好到中线，再往上会露出下留白）", () => {
    expect(centerShift(5000, 1600)).toBe(1600);
  });

  it("歌词太短、根本不需要上移时，位移恒为 0", () => {
    expect(centerShift(300, 0)).toBe(0);
  });

  it("非法输入不抛错", () => {
    expect(centerShift(Number.NaN, 1600)).toBe(0);
    expect(centerShift(100, Number.NaN)).toBe(0);
  });
});

describe("clampManualShift（手动滚动夹取）", () => {
  it("上下两端都夹住", () => {
    expect(clampManualShift(-50, 800)).toBe(0);
    expect(clampManualShift(9999, 800)).toBe(800);
    expect(clampManualShift(300, 800)).toBe(300);
  });

  it("没什么可滚的时候只能停在 0", () => {
    expect(clampManualShift(120, 0)).toBe(0);
  });

  it("非法输入不抛错", () => {
    expect(clampManualShift(Number.NaN, 800)).toBe(0);
    expect(clampManualShift(100, Number.NaN)).toBe(0);
  });
});

describe("findSublineLine（翻译/音译就近对齐）", () => {
  const tr = (time: number, text: string): LyricLine => ({ time, text });

  it("Free Loop 实测数据：yrc 与 tlyric 差 340~1050ms 也能对上（v6.53 需求方报的失配）", () => {
    // 网易 id 17271094 的真实时间轴：正文 yrc 行起点 vs 翻译 tlyric 行起点
    const translations = [
      tr(0.23, "我已习惯在外面呼唤你的名字"),
      tr(5.66, "今晚不去见你，不想自己又陷入疯狂"),
      tr(12.03, "但不知道为什么，这一天过得无精打采"),
      tr(18.37, ""),
      tr(24.52, "我也曾辉煌一时，如今却默默无闻"),
    ];
    expect(findSublineLine(translations, 0.57)?.text).toBe("我已习惯在外面呼唤你的名字");
    expect(findSublineLine(translations, 6.36)?.text).toBe("今晚不去见你，不想自己又陷入疯狂");
    expect(findSublineLine(translations, 13.08)?.text).toBe("但不知道为什么，这一天过得无精打采");
    // "Hey yeah"（18.9s）：最近的是 18.37s 的空占位行 —— 空行跳过后，真行都超出容差，不给
    expect(findSublineLine(translations, 18.9)).toBeNull();
    expect(findSublineLine(translations, 24.52)?.text).toBe("我也曾辉煌一时，如今却默默无闻");
  });

  it("精确相等照常命中（同轴的老歌不受影响）", () => {
    const lines = [tr(10, "一"), tr(20, "二")];
    expect(findSublineLine(lines, 10)?.text).toBe("一");
  });

  it("超出容差宁可不给（宁缺毋错）", () => {
    const lines = [tr(10, "一")];
    expect(findSublineLine(lines, 12.2)).toBeNull();
    expect(findSublineLine(lines, 12.2, 3)?.text).toBe("一");
  });

  it("空文本行不参与就近比较", () => {
    const lines = [tr(10, ""), tr(11.4, "真行")];
    expect(findSublineLine(lines, 10.2)?.text).toBe("真行");
  });

  it("空数据与全空行都不给", () => {
    expect(findSublineLine(undefined, 10)).toBeNull();
    expect(findSublineLine([], 10)).toBeNull();
    expect(findSublineLine([tr(10, "  ")], 10)).toBeNull();
  });
});

describe("isCreditLine（署名行判别）", () => {
  it("中英常见署名前缀都认", () => {
    expect(isCreditLine("作词: Daniel Powter")).toBe(true);
    expect(isCreditLine("作曲 : Choo Young Soo")).toBe(true);
    expect(isCreditLine("编曲：某人")).toBe(true);
    expect(isCreditLine("词：方文山")).toBe(true);
    expect(isCreditLine("Lyrics by someone")).toBe(true);
    expect(isCreditLine("Written by someone")).toBe(true);
    expect(isCreditLine("Produced by someone")).toBe(true);
  });

  it("唱词不以署名开头，不误伤（“曲”后无分隔符不算）", () => {
    expect(isCreditLine("曲终人散")).toBe(false);
    expect(isCreditLine("I've been fabulous through to find my tattered name")).toBe(false);
  });
});
