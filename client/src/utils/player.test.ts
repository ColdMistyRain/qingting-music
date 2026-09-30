import { describe, expect, it } from "vitest";
import {
  nextMode,
  pickRandomIndex,
  PLAY_MODE_ORDER,
  resolveNextIndex,
  resolvePrevIndex,
  shouldRestartTrack,
  type PlayMode,
} from "./player";

/** 固定随机源，让随机模式的结果可断言 */
const fixed = (value: number) => () => value;

describe("nextMode", () => {
  it("按 顺序 → 列表循环 → 单曲循环 → 随机 → 顺序 循环（PL-05）", () => {
    expect(nextMode("seq")).toBe("list");
    expect(nextMode("list")).toBe("one");
    expect(nextMode("one")).toBe("random");
    expect(nextMode("random")).toBe("seq");
  });

  it("四种模式各自切换一圈后回到自身", () => {
    for (const start of PLAY_MODE_ORDER) {
      let mode: PlayMode = start;
      for (let i = 0; i < PLAY_MODE_ORDER.length; i += 1) mode = nextMode(mode);
      expect(mode).toBe(start);
    }
  });
});

describe("shouldRestartTrack", () => {
  it("超过 3 秒回本曲开头，未超过则切上一曲（PL-02）", () => {
    expect(shouldRestartTrack(3.1)).toBe(true);
    expect(shouldRestartTrack(3)).toBe(false);
    expect(shouldRestartTrack(0)).toBe(false);
  });

  it("阈值可配，非法时间不触发", () => {
    expect(shouldRestartTrack(5, 10)).toBe(false);
    expect(shouldRestartTrack(Number.NaN)).toBe(false);
  });
});

describe("resolveNextIndex", () => {
  it("空队列返回 -1（没有可播的曲目）", () => {
    expect(resolveNextIndex(0, -1, "list")).toBe(-1);
  });

  it("尚未开始播放时从第一首开始", () => {
    expect(resolveNextIndex(3, -1, "seq")).toBe(0);
  });

  it("顺序播放：到末尾返回 -1（停止），中间正常 +1", () => {
    expect(resolveNextIndex(3, 0, "seq")).toBe(1);
    expect(resolveNextIndex(3, 2, "seq")).toBe(-1);
  });

  it("列表循环：到末尾回到第一首", () => {
    expect(resolveNextIndex(3, 2, "list")).toBe(0);
    expect(resolveNextIndex(1, 0, "list")).toBe(0);
  });

  it("单曲循环：手动下一首仍在本曲（重播只发生在自然播完时）", () => {
    expect(resolveNextIndex(3, 1, "one")).toBe(1);
  });

  it("随机播放：绝不会重复当前曲，且结果不越界", () => {
    for (const value of [0, 0.25, 0.5, 0.99]) {
      for (const index of [0, 1, 2]) {
        const result = resolveNextIndex(3, index, "random", fixed(value));
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThan(3);
        expect(result).not.toBe(index);
      }
    }
  });

  it("随机播放：队列只有一首时只能停在 0", () => {
    expect(resolveNextIndex(1, 0, "random")).toBe(0);
  });

  it("索引越界时容错为第一首", () => {
    expect(resolveNextIndex(3, 99, "list")).toBe(0);
  });
});

describe("resolvePrevIndex", () => {
  it("顺序播放：第一首往上是停留，不越界", () => {
    expect(resolvePrevIndex(3, 0, "seq")).toBe(0);
  });

  it("列表循环：第一首往上回绕到最后一首", () => {
    expect(resolvePrevIndex(3, 0, "list")).toBe(2);
    expect(resolvePrevIndex(3, 2, "list")).toBe(1);
  });

  it("单曲循环：正常 -1 走列表顺序", () => {
    expect(resolvePrevIndex(3, 2, "one")).toBe(1);
  });

  it("随机播放：不会重复当前曲", () => {
    const result = resolvePrevIndex(3, 1, "random", fixed(0));
    expect(result).not.toBe(1);
  });

  it("空队列返回 -1", () => {
    expect(resolvePrevIndex(0, -1, "list")).toBe(-1);
  });
});

describe("pickRandomIndex", () => {
  it("覆盖全部候选且跳过被排除的索引", () => {
    const results = new Set<number>();
    for (let i = 0; i < 100; i += 1) {
      const index = pickRandomIndex(4, 2, () => i / 100);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
      expect(index).not.toBe(2);
      results.add(index);
    }
    expect([...results].sort()).toEqual([0, 1, 3]);
  });

  it("空队列返回 -1", () => {
    expect(pickRandomIndex(0, -1)).toBe(-1);
  });
});
