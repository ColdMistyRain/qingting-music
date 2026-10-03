import { describe, expect, it } from "vitest";
import { SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, spectrumBands } from "./audioSpectrum";

/** 造一份频率直方图：bin 值由注入的函数给（按 bin 下标或频率） */
function makeFreq(bins: number, value: (bin: number, hz: number) => number): Uint8Array<ArrayBuffer> {
  const hzPerBin = 24000 / bins; // sampleRate 48k → nyquist 24k
  const data = new Uint8Array(bins);
  for (let b = 0; b < bins; b++) data[b] = Math.max(0, Math.min(255, Math.round(value(b, b * hzPerBin))));
  return data;
}

describe("spectrumBands（VS-05 频段映射）", () => {
  it("输出 count 个 0~1 的值", () => {
    const freq = makeFreq(1024, () => 128);
    const bands = spectrumBands(freq, 48000, 28);
    expect(bands).toHaveLength(28);
    for (const v of bands) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("全 0 数据 → 全 0；满幅数据 → 接近 1", () => {
    const silent = spectrumBands(makeFreq(1024, () => 0), 48000, 8);
    expect(silent.every((v) => v === 0)).toBe(true);
    const loud = spectrumBands(makeFreq(1024, () => 255), 48000, 8);
    expect(loud.every((v) => v > 0.99)).toBe(true);
  });

  it("频段对数分布：首段覆盖 40Hz 附近，末段不超过 16kHz 上限", () => {
    // 只在 41~47Hz 放能量：第一段是 [40, 40*400^(1/24)≈51.4Hz]，应接住它
    const bins = 4096;
    const freq = makeFreq(bins, (_b, hz) => (hz >= 41 && hz < 48 ? 255 : 0));
    const bands = spectrumBands(freq, 48000, 24);
    expect(bands[0]).toBeGreaterThan(0);
    expect(bands.slice(1).every((v) => v === 0)).toBe(true);
    // 上限不越出 16kHz：16kHz 对应的 bin 之后的能量不被计入 —— 在 19kHz 处放能量应全为 0
    const high = makeFreq(bins, (_b, hz) => (hz >= 19000 ? 255 : 0));
    expect(spectrumBands(high, 48000, 24).every((v) => v === 0)).toBe(true);
    expect(SPECTRUM_MIN_HZ).toBe(40);
    expect(SPECTRUM_MAX_HZ).toBe(16000);
  });

  it("边界容错：count 0、空数据、freq 比 fftSize/2 短时不抛错", () => {
    expect(spectrumBands(new Uint8Array(0), 48000, 8)).toEqual([]);
    expect(spectrumBands(makeFreq(512, () => 100), 48000, 0)).toEqual([]);
    expect(spectrumBands(makeFreq(8, () => 200), 48000, 16)).toHaveLength(16);
  });
});
