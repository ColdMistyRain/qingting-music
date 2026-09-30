import { describe, expect, it } from "vitest";
import { marqueeDuration, MARQUEE_MAX_SECONDS, MARQUEE_MIN_SECONDS } from "./marquee";

describe("marqueeDuration", () => {
  it("溢出越多时长越长（按恒定速度换算）", () => {
    const short = marqueeDuration(56);
    const long = marqueeDuration(280);
    expect(short).toBeGreaterThan(MARQUEE_MIN_SECONDS);
    expect(long).toBeGreaterThan(short);
  });

  it("夹在 6~20 秒之间", () => {
    expect(marqueeDuration(1)).toBe(MARQUEE_MIN_SECONDS);
    expect(marqueeDuration(10_000)).toBe(MARQUEE_MAX_SECONDS);
  });

  it("不需要滚动（0 / 负数 / 非法值）时返回下限值", () => {
    expect(marqueeDuration(0)).toBe(MARQUEE_MIN_SECONDS);
    expect(marqueeDuration(-20)).toBe(MARQUEE_MIN_SECONDS);
    expect(marqueeDuration(Number.NaN)).toBe(MARQUEE_MIN_SECONDS);
  });

  it("速度非法时退回上限，不会算出 Infinity", () => {
    expect(marqueeDuration(200, 0)).toBe(MARQUEE_MAX_SECONDS);
    expect(Number.isFinite(marqueeDuration(200, -1))).toBe(true);
  });
});
