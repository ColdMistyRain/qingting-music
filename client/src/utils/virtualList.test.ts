import { describe, expect, it } from "vitest";
import {
  computeVirtualWindow,
  fullWindow,
  pitchFromTops,
  VIRTUAL_OVERSCAN,
  type VirtualGeometry,
} from "./virtualList";

/** 一屏 600px、行距 64（控制台宽屏那档）、无行间 —— 简单好算的基准几何 */
function geometry(overrides: Partial<VirtualGeometry> = {}): VirtualGeometry {
  return { count: 500, pitch: 64, gap: 0, viewport: 600, listTop: 0, scrollTop: 0, ...overrides };
}

describe("fullWindow（整份渲染的退路）", () => {
  it("行数正常 → 全渲染、没有垫片", () => {
    expect(fullWindow(3)).toEqual({ start: 0, end: 3, padTop: 0, padBottom: 0 });
  });

  it("0 / 负数 / 脏数据 → 空窗口，不抛", () => {
    expect(fullWindow(0)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(fullWindow(-5)).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
    expect(fullWindow(Number.NaN).end).toBe(0);
  });
});

describe("computeVirtualWindow（一屏渲染哪几行 + 上下垫片）", () => {
  it("没有行 → 空窗口", () => {
    expect(computeVirtualWindow(geometry({ count: 0 }))).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it("几何还没量到（行距 0 / 视口 0 / 脏数据）→ 整份渲染：**宁可多渲染，不能少渲染**", () => {
    // 少渲染的行在“滚不动”的容器里就永远看不到了，所以这里必须是退路而不是空窗口
    expect(computeVirtualWindow(geometry({ pitch: 0 }))).toEqual({
      start: 0,
      end: 500,
      padTop: 0,
      padBottom: 0,
    });
    expect(computeVirtualWindow(geometry({ viewport: 0 })).end).toBe(500);
    expect(computeVirtualWindow(geometry({ pitch: Number.NaN, viewport: 600 })).end).toBe(500);
    expect(computeVirtualWindow(geometry({ pitch: 64, viewport: Number.NaN })).end).toBe(500);
  });

  it("滚在顶部：从第 0 行开始、不加上垫片，末尾留出下垫片", () => {
    const win = computeVirtualWindow(geometry());
    expect(win.start).toBe(0);
    expect(win.padTop).toBe(0);
    // 一屏 600 / 64 = 10 行，加缓冲
    expect(win.end).toBe(10 + VIRTUAL_OVERSCAN);
    // 500 行里没渲染的那些，按行距扣掉一份行间（gap = 0 时就是整份）
    expect(win.padBottom).toBe((500 - win.end) * 64);
  });

  it("滚在中途：起始下标按下取整，两块垫片都扣掉一份行间（flex gap）", () => {
    const win = computeVirtualWindow(
      geometry({ pitch: 76, gap: 4, scrollTop: 760, viewport: 600, count: 500 }),
    );
    // 760 / 76 = 第 10 行在视口顶
    expect(win.start).toBe(10 - VIRTUAL_OVERSCAN);
    expect(win.padTop).toBe(win.start * 76 - 4);
    expect(win.padBottom).toBe((500 - win.end) * 76 - 4);
  });

  it("垫片不能因为行间比垫片还大而变成负数（滚过一点点的时候）", () => {
    const win = computeVirtualWindow(geometry({ pitch: 76, gap: 12, scrollTop: 76 }));
    // start = 1 − overscan → 0，于是上垫片本来就该是 0
    expect(win.start).toBe(0);
    expect(win.padTop).toBe(0);
    const win2 = computeVirtualWindow(geometry({ pitch: 76, gap: 12, scrollTop: 76 * 8 }));
    expect(win2.start).toBe(8 - VIRTUAL_OVERSCAN);
    expect(win2.padTop).toBeGreaterThanOrEqual(0);
  });

  it("列表顶不在滚动区顶上时（列表上面还有别的内容）按 listTop 平移", () => {
    const win = computeVirtualWindow(
      geometry({ pitch: 64, scrollTop: 1000, listTop: 200, viewport: 600 }),
    );
    // 相对列表只滚了 800 → 第 12 行在视口顶
    expect(win.start).toBe(12 - VIRTUAL_OVERSCAN);
  });

  it("滚到底：末行必须在窗口里，下垫片归零", () => {
    const win = computeVirtualWindow(geometry({ scrollTop: 500 * 64 - 600 }));
    expect(win.end).toBe(500);
    expect(win.padBottom).toBe(0);
    expect(win.start).toBeLessThan(500);
  });

  it("滚动位置超出可滚范围（列表被筛短了）→ 自己夹回去，窗口落在末尾且不越界", () => {
    const win = computeVirtualWindow(geometry({ count: 120, pitch: 64, scrollTop: 99999 }));
    expect(win.end).toBe(120);
    expect(win.padBottom).toBe(0);
    // 夹回来之后窗口落在列表末尾：视口顶那一行（110）必须还在窗口里，末行也在
    expect(win.start).toBeLessThanOrEqual(110);
    expect(win.start).toBeGreaterThanOrEqual(100);
  });

  it("列表比一屏还短 → 整份渲染，没有垫片", () => {
    const win = computeVirtualWindow(geometry({ count: 3, pitch: 64, viewport: 600 }));
    expect(win).toEqual({ start: 0, end: 3, padTop: 0, padBottom: 0 });
  });

  it("缓冲可以关掉：窗口正好是可视区那几行", () => {
    const win = computeVirtualWindow(
      geometry({ count: 500, pitch: 64, viewport: 640, scrollTop: 640, overscan: 0 }),
    );
    expect(win.start).toBe(10);
    expect(win.end).toBe(20);
  });

  it("**不漏行**：扫过整条滚动轨迹，每一个行下标都至少被某个窗口覆盖", () => {
    const pitch = 76;
    const gap = 4;
    const count = 500;
    const viewport = 640;
    const maxScroll = count * pitch - gap - viewport;
    const seen = new Set<number>();
    let previousStart = -1;
    for (let scrollTop = 0; scrollTop <= maxScroll; scrollTop += 8) {
      const win = computeVirtualWindow({ count, pitch, gap, viewport, listTop: 0, scrollTop });
      // 窗口整体单调向右走（顺序不错乱）
      expect(win.start).toBeGreaterThanOrEqual(previousStart);
      previousStart = win.start;
      // 视口里那一行必须渲染
      const first = Math.floor(scrollTop / pitch);
      expect(win.start).toBeLessThanOrEqual(first);
      expect(win.end).toBeGreaterThan(first);
      for (let i = win.start; i < win.end; i++) seen.add(i);
    }
    expect(seen.size).toBe(count);
  });

  it("**位置对得上**：渲染出来的行，坐在它在“全量列表”里的位置上", () => {
    const pitch = 76;
    const gap = 12;
    const cases: VirtualGeometry[] = [
      { count: 500, pitch, gap, viewport: 600, listTop: 0, scrollTop: 0 },
      { count: 500, pitch, gap, viewport: 600, listTop: 0, scrollTop: 76 * 33 },
      { count: 500, pitch, gap, viewport: 600, listTop: 0, scrollTop: 500 * pitch - 600 },
      { count: 240, pitch, gap, viewport: 900, listTop: 130, scrollTop: 3000 },
    ];
    for (const item of cases) {
      const win = computeVirtualWindow(item);
      // 第 start 行的顶 = 上垫片 + 一份行间（垫片也是 flex 子元素，它后面跟着一个 gap）
      const firstTop = win.padTop + (win.start > 0 ? item.gap : 0);
      expect(firstTop).toBe(win.start * pitch);
      for (let i = win.start + 1; i < win.end; i++) {
        const top = firstTop + (i - win.start) * pitch;
        expect(top).toBe(i * pitch);
      }
    }
  });

  it("脏数据不抛：NaN 行数 / 负的行距与视口一律退到全渲染或空窗口", () => {
    expect(computeVirtualWindow(geometry({ count: Number.NaN }))).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
    expect(computeVirtualWindow(geometry({ pitch: -64 })).end).toBe(500);
    expect(computeVirtualWindow(geometry({ viewport: -600 })).end).toBe(500);
    // 行间量不出来（NaN）按 0 处理：垫片少扣一份 ≈ 差几个像素，比 NaN 强
    const dirtyGap = computeVirtualWindow(geometry({ gap: Number.NaN }));
    expect(dirtyGap.padBottom).toBe((500 - dirtyGap.end) * 64);
    expect(Number.isNaN(dirtyGap.padBottom)).toBe(false);
  });
});

describe("pitchFromTops（从已渲染行的 offsetTop 里量行距）", () => {
  it("正常：相邻两行的差就是行距", () => {
    expect(pitchFromTops([0, 76, 152, 228])).toBe(76);
    expect(pitchFromTops([12, 88])).toBe(76);
  });

  it("行不够（0 / 1 行）→ 0 = 没量到", () => {
    expect(pitchFromTops([])).toBe(0);
    expect(pitchFromTops([40])).toBe(0);
  });

  it("量到非正数或脏数据 → 0 = 没量到（不要拿它去算垫片）", () => {
    expect(pitchFromTops([100, 100])).toBe(0);
    expect(pitchFromTops([100, 20])).toBe(0);
    expect(pitchFromTops([Number.NaN, 76])).toBe(0);
    expect(pitchFromTops([0, Number.NaN])).toBe(0);
  });
});
