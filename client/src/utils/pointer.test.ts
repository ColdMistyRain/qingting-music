import { describe, expect, it } from "vitest";
import { isTouchTap } from "./pointer";

describe("isTouchTap", () => {
  it("触摸点出来的才算", () => {
    expect(isTouchTap("touch")).toBe(true);
  });

  it("鼠标/触控笔都不算（桌面手势仍是双击，不改成单击播放）", () => {
    expect(isTouchTap("mouse")).toBe(false);
    expect(isTouchTap("pen")).toBe(false);
  });

  it("拿不到类型时不算（老引擎的 click 是 MouseEvent，没有 pointerType）", () => {
    expect(isTouchTap(undefined)).toBe(false);
    expect(isTouchTap("")).toBe(false);
  });
});
