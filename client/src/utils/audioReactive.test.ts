import { describe, expect, it } from "vitest";
import { bandRange, envelope, follow, lowBandEnergy, pulse } from "./audioReactive";

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

  it("取的是峰值，不是均值：低频段只有一格跳起来（鼓点）就按它算", () => {
    const [start] = bandRange(512, 48000, 2048, 40, 160)!;
    const data = new Uint8Array(512);
    data[start + 1] = 200;
    expect(lowBandEnergy(data, 48000, 2048)).toBeCloseTo(200 / 255, 3);
  });

  it("整段填一半 → 峰值就是那一半（不是按格求和）", () => {
    expect(lowBandEnergy(spectrum(128), 48000, 2048)).toBeCloseTo(128 / 255, 3);
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

describe("follow", () => {
  it("一阶低通：一步只走一部分，tau 越大走得越少", () => {
    const slow = follow(0, 1, 100, 2200);
    const fast = follow(0, 1, 100, 300);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeLessThan(0.1);
  });

  it("长时间保持 → 收敛到目标值（约 5 个时间常数）", () => {
    let value = 0;
    for (let i = 0; i < 700; i += 1) value = follow(value, 0.6, 16, 2200);
    expect(value).toBeCloseTo(0.6, 2);
  });

  it("dt 为 0 / 负数时不跳变；tau 非法也不炸", () => {
    expect(follow(0.3, 1, 0, 2200)).toBe(0.3);
    expect(follow(0.3, 1, -5, 2200)).toBe(0.3);
    expect(Number.isFinite(follow(0.3, 1, 16, 0))).toBe(true);
  });
});

describe("pulse", () => {
  it("正好在常态上 → 0；超出常态波动的一个跨度 → 满值", () => {
    expect(pulse(0.8, 0.8, 0.1)).toBe(0);
    expect(pulse(0.8 + 0.1 * 1.6, 0.8, 0.1)).toBeCloseTo(1, 3);
  });

  it("落在常态以下 → 0（不出现负值）", () => {
    expect(pulse(0.5, 0.8, 0.1)).toBe(0);
  });

  it("常态几乎不波动时用下限兜住（不把噪声放大成闪烁）", () => {
    // 波动 0.001 算出来的跨度只有 0.0016，会被下限 0.05 换掉
    expect(pulse(0.81, 0.8, 0.001)).toBeCloseTo(0.2, 3);
  });

  it("整体音量小也照样有起伏（减基线之后才与音量无关）", () => {
    // 幅度只有 0.03，但跨度下限 0.05 仍能给出六成
    expect(pulse(0.18, 0.15, 0.02)).toBeCloseTo(0.6, 3);
  });
});
