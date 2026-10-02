import { describe, expect, it } from "vitest";
import {
  ONSET_FLOOR,
  ONSET_MIN_HISTORY,
  ONSET_RATIO,
  ONSET_WINDOW,
  baseBlobs,
  bandRange,
  envelope,
  isOnset,
  lowBandEnergy,
} from "./audioReactive";

/** 造一段频谱：`filled(value)` 表示低频那几格填多少，其余为 0 */
function spectrum(value: number, length = 512): Uint8Array {
  const data = new Uint8Array(length);
  for (let i = 0; i < 12; i += 1) data[i] = value;
  return data;
}

describe("bandRange", () => {
  it("按 采样率 / fftSize 换算（48k / 2048 → 每格 23.4Hz，40~160Hz 落在 1~7 格）", () => {
    expect(bandRange(1024, 48000, 2048, 40, 160)).toEqual([1, 7]);
  });

  it("采样率低时区间照常收窄（44.1k / 2048）", () => {
    const range = bandRange(1024, 44100, 2048, 40, 160);
    expect(range).not.toBeNull();
    expect(range![0]).toBeGreaterThanOrEqual(1);
    expect(range![1]).toBeLessThan(9);
  });

  it("非法输入给 null（空数组 / 零采样率 / 空区间）", () => {
    expect(bandRange(0, 48000, 2048, 40, 160)).toBeNull();
    expect(bandRange(1024, 0, 2048, 40, 160)).toBeNull();
    expect(bandRange(1024, 48000, 0, 40, 160)).toBeNull();
    expect(bandRange(1024, 48000, 2048, 160, 40)).toBeNull();
  });

  it("区间越界时夹到可用范围内", () => {
    // 96000 / 128：每格 750Hz，40~160Hz 全落在最前面两格
    expect(bandRange(64, 96000, 128, 40, 160)).toEqual([0, 1]);
    // 只有 4 格：上界夹到最后一格
    expect(bandRange(4, 48000, 2048, 40, 160)).toEqual([1, 3]);
  });
});

describe("lowBandEnergy", () => {
  it("全静音 → 0；满格 → 1", () => {
    expect(lowBandEnergy(spectrum(0), 48000, 2048)).toBe(0);
    expect(lowBandEnergy(spectrum(255), 48000, 2048)).toBe(1);
  });

  it("取的是均值：低频段只填一半格 → 约 0.5（不是按格求和）", () => {
    const [start, end] = bandRange(512, 48000, 2048, 40, 160)!;
    const data = new Uint8Array(512);
    const filled = Math.floor((end - start + 1) / 2);
    for (let i = start; i < start + filled; i += 1) data[i] = 255;
    expect(lowBandEnergy(data, 48000, 2048)).toBeCloseTo(filled / (end - start + 1), 3);
  });

  it("高频再响也不影响低频能量（人声 / 镲片不带动光晕）", () => {
    const data = new Uint8Array(512);
    for (let i = 100; i < 300; i += 1) data[i] = 255;
    expect(lowBandEnergy(data, 48000, 2048)).toBe(0);
  });

  it("空数据 → 0（分析器还没出数时不炸）", () => {
    expect(lowBandEnergy(new Uint8Array(0), 48000, 2048)).toBe(0);
  });
});

describe("envelope", () => {
  it("起得快：一帧 16ms 就能走掉约三成（目标是 1）", () => {
    const next = envelope(0, 1, 16);
    expect(next).toBeGreaterThan(0.25);
    expect(next).toBeLessThan(0.45);
  });

  it("落得慢：同样 16ms 掉得远比起的时候少", () => {
    const rising = envelope(0, 1, 16);
    const falling = 1 - envelope(1, 0, 16);
    expect(falling).toBeLessThan(rising);
  });

  it("长时间保持 → 收敛到目标值", () => {
    let value = 0;
    for (let i = 0; i < 200; i += 1) value = envelope(value, 0.8, 16);
    expect(value).toBeCloseTo(0.8, 3);
  });

  it("dt 为 0 或负数时不跳变", () => {
    expect(envelope(0.4, 1, 0)).toBe(0.4);
    expect(envelope(0.4, 1, -10)).toBe(0.4);
  });
});

describe("isOnset", () => {
  const flat = (n: number, value = 0.3) => Array.from({ length: n }, () => value);

  it("基准不足（开头几帧）不算击打", () => {
    expect(isOnset([], 0.9)).toBe(false);
    expect(isOnset(flat(ONSET_MIN_HISTORY - 1), 0.9)).toBe(false);
  });

  it("明显超出滑动平均 → 算一次击打", () => {
    expect(isOnset(flat(ONSET_WINDOW), 0.3 * ONSET_RATIO + 0.01)).toBe(true);
  });

  it("只是略高于平均 → 不算（避免颤音连续触发）", () => {
    expect(isOnset(flat(ONSET_WINDOW), 0.3 * (ONSET_RATIO - 0.02))).toBe(false);
  });

  it("低于地板值 → 不算（静音段落不闪）", () => {
    expect(isOnset(flat(ONSET_WINDOW, 0.01), ONSET_FLOOR - 0.01)).toBe(false);
  });

  it("历史为空值 / 全零时，静音不误判、有信号才判定", () => {
    expect(isOnset(flat(ONSET_WINDOW, 0), 0.5)).toBe(true);
    expect(isOnset(flat(ONSET_WINDOW, 0), 0.05)).toBe(false);
  });
});

describe("baseBlobs", () => {
  it("角度均分、速度两两不同、大小都在合理区间", () => {
    const blobs = baseBlobs(6);
    expect(blobs).toHaveLength(6);
    expect(new Set(blobs.map((b) => b.speed)).size).toBe(6);
    blobs.forEach((blob, index) => {
      expect(blob.angle).toBeCloseTo((index / 6) * Math.PI * 2, 6);
      expect(Math.abs(blob.speed)).toBeGreaterThan(0.05);
      expect(blob.size).toBeGreaterThanOrEqual(0.5);
      expect(blob.size).toBeLessThan(0.9);
    });
  });

  it("数量为 0 / 负数时至少给一个（避免画布空转）", () => {
    expect(baseBlobs(0)).toHaveLength(1);
    expect(baseBlobs(-3)).toHaveLength(1);
  });
});
