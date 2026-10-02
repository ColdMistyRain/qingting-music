import { describe, expect, it } from "vitest";
import {
  EQ_BANDS,
  EQ_CUSTOM_NAME,
  EQ_FLAT_NAME,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_MASTER_MAX,
  EQ_MASTER_MIN,
  bandLabel,
  clampGain,
  clampMaster,
  defaultEqSettings,
  flatGains,
  formatGain,
  matchPresetName,
  normalizeGains,
  presetByName,
  sanitizeBandGains,
  sanitizeEqSettings,
  type EqBandGains,
} from "./equalizer";

describe("频段与取值（PL-13：10 段 ±12dB）", () => {
  it("10 段中心频率就是 31Hz~16kHz 那一组", () => {
    expect([...EQ_BANDS]).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
    expect(flatGains()).toHaveLength(EQ_BANDS.length);
  });

  it("增益取整并夹到 ±12；整体增益夹到 ±10", () => {
    expect(clampGain(3.4)).toBe(3);
    expect(clampGain(99)).toBe(EQ_GAIN_MAX);
    expect(clampGain(-99)).toBe(EQ_GAIN_MIN);
    expect(clampGain(Number.NaN)).toBe(0);
    expect(clampMaster(50)).toBe(EQ_MASTER_MAX);
    expect(clampMaster(-50)).toBe(EQ_MASTER_MIN);
  });

  it("曲线清洗：长度不对 / 不是数组 / 含脏值都不许把页面带崩", () => {
    expect(sanitizeBandGains("nope")).toEqual(flatGains());
    expect(sanitizeBandGains([1, 2, 3])).toEqual(flatGains());
    expect(sanitizeBandGains([1, 2, 3, 4, 5, 6, 7, 8, 9, 99])).toEqual([
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      EQ_GAIN_MAX,
    ]);
    expect(sanitizeBandGains([...Array(10)].map(() => "x"))).toEqual(flatGains());
    expect(normalizeGains([0.4, 1.6, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([
      0, 2, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("标签与读数：1000Hz 起用 k，正数带 +", () => {
    expect(EQ_BANDS.map(bandLabel)).toEqual([
      "31",
      "62",
      "125",
      "250",
      "500",
      "1k",
      "2k",
      "4k",
      "8k",
      "16k",
    ]);
    expect(formatGain(3)).toBe("+3");
    expect(formatGain(0)).toBe("0");
    expect(formatGain(-4.2)).toBe("-4");
  });
});

describe("预设与自定义（PL-13）", () => {
  it("内置预设齐全，每条曲线长度都对", () => {
    expect(presetByName("流行")?.gains).toHaveLength(EQ_BANDS.length);
    expect(presetByName("不存在")).toBeUndefined();
    for (const preset of ["平直", "流行", "摇滚", "爵士", "古典"]) {
      expect(presetByName(preset)).toBeDefined();
    }
  });

  it("匹配预设：逐段相等才命中，改一段就落到「自定义」", () => {
    const rock = presetByName("摇滚")!.gains;
    expect(matchPresetName(rock)).toBe("摇滚");
    expect(matchPresetName(flatGains())).toBe(EQ_FLAT_NAME);

    const tweaked = [...rock];
    tweaked[3] += 2;
    expect(matchPresetName(tweaked)).toBe(EQ_CUSTOM_NAME);
  });

  it("自定义预设也参与匹配（保存过的曲线再选回来仍算那个预设）", () => {
    const curve: EqBandGains = [1, 1, 1, 0, 0, 0, 0, 0, 1, 1];
    expect(matchPresetName(curve, { 我的: curve })).toBe("我的");
    expect(matchPresetName(curve)).toBe(EQ_CUSTOM_NAME);
  });

  it("读坏的本地存储：退回默认值，好的一部分保留", () => {
    expect(sanitizeEqSettings(null)).toEqual(defaultEqSettings());
    expect(sanitizeEqSettings("nope").on).toBe(false);
    expect(sanitizeEqSettings({ on: true, gains: "x" }).gains).toEqual(flatGains());

    const loaded = sanitizeEqSettings({
      on: true,
      gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      master: 99,
      custom: {
        "  我的曲线  ": [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        自定义: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      },
    });
    expect(loaded.on).toBe(true);
    expect(loaded.master).toBe(EQ_MASTER_MAX);
    expect(Object.keys(loaded.custom)).toEqual(["我的曲线"]);
    // 曲线与保存过的自定义预设一致时，预设名应当命中它（而不是笼统的“自定义”）
    expect(
      sanitizeEqSettings({
        gains: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
        custom: { 低音: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
      }).preset,
    ).toBe("低音");
  });

  it("默认是关闭的（关闭时音频直通，A/B 对比的基线）", () => {
    const defaults = defaultEqSettings();
    expect(defaults.on).toBe(false);
    expect(defaults.gains).toEqual(flatGains());
    expect(defaults.master).toBe(0);
    expect(defaults.custom).toEqual({});
  });
});
