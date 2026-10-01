import { describe, expect, it } from "vitest";
import { scrollbarSizeFrom } from "./scrollbar";

describe("scrollbarSizeFrom", () => {
  it("算得出滚动条宽度（外框 100 / 内容盒 90 → 10）", () => {
    expect(scrollbarSizeFrom(100, 90)).toBe(10);
  });

  it("不管引擎给多宽都照实算（外框 100 / 内容盒 88 → 12，Firefox thin 就不是 10）", () => {
    expect(scrollbarSizeFrom(100, 88)).toBe(12);
  });

  it("小数取整", () => {
    expect(scrollbarSizeFrom(100.5, 88.2)).toBe(12);
  });

  it("overlay 滚动条（量不到，差值为 0）→ 0，调用方保留 CSS 兜底值", () => {
    expect(scrollbarSizeFrom(100, 100)).toBe(0);
  });

  it("异常值（负差 / NaN / 大得离谱）→ 0，不写坏令牌", () => {
    expect(scrollbarSizeFrom(90, 100)).toBe(0);
    expect(scrollbarSizeFrom(Number.NaN, 90)).toBe(0);
    expect(scrollbarSizeFrom(1000, 900)).toBe(0);
  });
});
