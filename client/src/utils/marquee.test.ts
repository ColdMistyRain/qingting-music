import { describe, expect, it } from "vitest";
import {
  isTextOverflowing,
  marqueeDuration,
  measureTextWidth,
  MARQUEE_MAX_SECONDS,
  MARQUEE_MIN_SECONDS,
  type MeasureHost,
} from "./marquee";

describe("marqueeDuration", () => {
  it("时长 = 距离 / 速度（越长的标题滚得越久，速度恒定）", () => {
    expect(marqueeDuration(300, 30)).toBeCloseTo(10, 5);
    expect(marqueeDuration(600, 30)).toBeCloseTo(20, 5);
  });

  it("夹在 8~30 秒之间", () => {
    expect(marqueeDuration(1)).toBe(MARQUEE_MIN_SECONDS);
    expect(marqueeDuration(100_000)).toBe(MARQUEE_MAX_SECONDS);
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

describe("isTextOverflowing", () => {
  it("文字比容器宽就算溢出", () => {
    expect(isTextOverflowing(300, 200)).toBe(true);
    expect(isTextOverflowing(200, 300)).toBe(false);
  });

  it("小于 1px 的差当作没溢出（避开亚像素四舍五入的假溢出）", () => {
    expect(isTextOverflowing(200.5, 200)).toBe(false);
    expect(isTextOverflowing(202, 200)).toBe(true);
  });

  it("容器还没布局（宽度 0）或数值非法时一律不溢出", () => {
    expect(isTextOverflowing(300, 0)).toBe(false);
    expect(isTextOverflowing(Number.NaN, 200)).toBe(false);
    expect(isTextOverflowing(300, Number.NaN)).toBe(false);
  });
});

/** 最小可用的假宿主：记录挂载/卸载，并给出指定宽度 */
function fakeHost(width: number): MeasureHost & { appended: number; removed: number } {
  const state = { appended: 0, removed: 0 };
  return {
    get appended() {
      return state.appended;
    },
    get removed() {
      return state.removed;
    },
    createElement: () =>
      ({
        style: {} as CSSStyleDeclaration,
        textContent: "",
        setAttribute: () => undefined,
        getBoundingClientRect: () => ({ width } as DOMRect),
        offsetWidth: 0,
      }) as unknown as HTMLElement,
    append: () => {
      state.appended += 1;
    },
    remove: () => {
      state.removed += 1;
    },
  };
}

describe("measureTextWidth", () => {
  it("返回离屏探针量出的宽度，并保证探针用完即删", () => {
    const host = fakeHost(228.4);
    expect(measureTextWidth("Умри, если меня не любишь", "600 13px system-ui", host)).toBe(229);
    expect(host.appended).toBe(1);
    expect(host.removed).toBe(1);
  });

  it("空文本直接返回 0，不创建探针", () => {
    const host = fakeHost(200);
    expect(measureTextWidth("", "600 13px system-ui", host)).toBe(0);
    expect(host.appended).toBe(0);
  });

  it("量不出宽度（宽高为 0 / 异常）时返回 0 而不是 NaN", () => {
    expect(measureTextWidth("abc", "600 13px system-ui", fakeHost(0))).toBe(0);
    expect(measureTextWidth("abc", "600 13px system-ui", fakeHost(Number.NaN))).toBe(0);
  });
});
