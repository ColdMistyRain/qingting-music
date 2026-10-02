import { describe, expect, it, vi } from "vitest";
import { isTouchTap, togglePointerCapture } from "./pointer";

const stub = () => ({
  setPointerCapture: vi.fn(),
  releasePointerCapture: vi.fn(),
});

describe("togglePointerCapture（指针捕获/释放的兜底入口）", () => {
  it("收起与释放分别调对应的一个方法，并原样传 pointerId", () => {
    const el = stub();
    togglePointerCapture(el, 7, true);
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
    expect(el.releasePointerCapture).not.toHaveBeenCalled();

    togglePointerCapture(el, 7, false);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it("两边抛错都不往外抛（释放那次往往排在“做正事”前面，一抛就把正事吞了）", () => {
    const el = {
      setPointerCapture: () => {
        throw new Error("Invalid pointer id");
      },
      releasePointerCapture: () => {
        throw new Error("Invalid pointer id");
      },
    };
    expect(() => togglePointerCapture(el, 1, true)).not.toThrow();
    expect(() => togglePointerCapture(el, 1, false)).not.toThrow();
  });

  it("目标为空 / 引擎没有这个方法时也不抛（拿不到捕获也能拖）", () => {
    expect(() => togglePointerCapture(null, 1, true)).not.toThrow();
    expect(() => togglePointerCapture({}, 1, false)).not.toThrow();
  });
});

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
