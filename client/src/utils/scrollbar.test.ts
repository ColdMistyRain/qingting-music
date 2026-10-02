import { describe, expect, it } from "vitest";
import { canScrollY, scrollOffsetFromThumb, thumbMetrics } from "./scrollbar";

describe("canScrollY（这个容器现在真的能不能滚）", () => {
  it("允许滚 + 内容更高 → 能滚", () => {
    expect(canScrollY({ overflowY: "auto", clientSize: 300, scrollSize: 3000 })).toBe(true);
    expect(canScrollY({ overflowY: "scroll", clientSize: 300, scrollSize: 600 })).toBe(true);
    // `overflow: scroll` 只是“允许滚”，内容装得下时仍然不画条（只多 1px 也算装得下）
    expect(canScrollY({ overflowY: "scroll", clientSize: 300, scrollSize: 301 })).toBe(false);
  });

  it("溢出但**不允许滚**的容器不算能滚——v6.19 那条“永远挂在右上”的条就是它造的", () => {
    expect(canScrollY({ overflowY: "hidden", clientSize: 574, scrollSize: 726 })).toBe(false);
    expect(canScrollY({ overflowY: "clip", clientSize: 574, scrollSize: 726 })).toBe(false);
    expect(canScrollY({ overflowY: "visible", clientSize: 100, scrollSize: 900 })).toBe(false);
  });

  it("允许滚但内容装得下 → 不算能滚", () => {
    expect(canScrollY({ overflowY: "auto", clientSize: 500, scrollSize: 500 })).toBe(false);
    expect(canScrollY({ overflowY: "auto", clientSize: 500, scrollSize: 480 })).toBe(false);
  });

  it("容差：仅差 1px 不算（布局取整会让两端恰好的容器差出 1px），差 2px 才算", () => {
    expect(canScrollY({ overflowY: "auto", clientSize: 500, scrollSize: 501 })).toBe(false);
    expect(canScrollY({ overflowY: "auto", clientSize: 500, scrollSize: 502 })).toBe(true);
    // 容差可覆盖（拖拽/动画期间想放宽时用）
    expect(canScrollY({ overflowY: "auto", clientSize: 500, scrollSize: 504, tolerance: 5 })).toBe(
      false,
    );
  });

  it("脏数据不抛：NaN / 负数 / 未量到尺寸一律算“不能滚”", () => {
    expect(canScrollY({ overflowY: "auto", clientSize: Number.NaN, scrollSize: 800 })).toBe(true);
    expect(canScrollY({ overflowY: "auto", clientSize: 0, scrollSize: 0 })).toBe(false);
    expect(canScrollY({ overflowY: "auto", clientSize: -10, scrollSize: -20 })).toBe(false);
    expect(canScrollY({ overflowY: "", clientSize: 100, scrollSize: 900 })).toBe(false);
  });
});

describe("thumbMetrics（自绘浮层滚动条的几何）", () => {
  it("长度按“视口 / 内容”比例，滚到顶时贴在轨道起点", () => {
    // 视口 200、内容 400 → 长度 100（还在下限之上）；scrollTop 0 → offset 0
    expect(thumbMetrics({ clientSize: 200, scrollSize: 400, scrollPos: 0 })).toEqual({
      length: 100,
      offset: 0,
      hidden: false,
    });
  });

  it("滚到底：滑块贴住轨道末端（偏移 = 视口 − 滑块长）", () => {
    expect(thumbMetrics({ clientSize: 200, scrollSize: 400, scrollPos: 200 }).offset).toBe(100);
  });

  it("中途按比例落在中间，且不会走出轨道（超范围的 scrollPos 夹取）", () => {
    expect(thumbMetrics({ clientSize: 200, scrollSize: 400, scrollPos: 100 }).offset).toBe(50);
    expect(thumbMetrics({ clientSize: 200, scrollSize: 400, scrollPos: 999 }).offset).toBe(100);
    expect(thumbMetrics({ clientSize: 200, scrollSize: 400, scrollPos: -50 }).offset).toBe(0);
  });

  it("内容很长时滑块有下限（28px）——比例算出来只有 25px 也要抬到 28", () => {
    // 视口 100、内容 400 → 比例长 25 → 抬到 28，偏移区间因此变成 72（不是 75）
    expect(thumbMetrics({ clientSize: 100, scrollSize: 400, scrollPos: 0 }).length).toBe(28);
    expect(thumbMetrics({ clientSize: 100, scrollSize: 400, scrollPos: 300 }).offset).toBe(72);
  });

  it("内容很长时滑块有下限（28px），且位置区间跟着缩小——不会冲出轨道", () => {
    const metrics = thumbMetrics({ clientSize: 400, scrollSize: 20000, scrollPos: 19600 });
    expect(metrics.length).toBe(28);
    expect(metrics.offset).toBe(400 - 28);
  });

  it("下限比视口还大时按视口夹取（保证 offset 区间不为负）", () => {
    const metrics = thumbMetrics({ clientSize: 20, scrollSize: 100, scrollPos: 0, minThumb: 40 });
    expect(metrics.length).toBe(20);
    expect(metrics.offset).toBe(0);
  });

  it("装得下就不显示（内容 ≤ 视口 / 量不到尺寸）", () => {
    expect(thumbMetrics({ clientSize: 100, scrollSize: 100, scrollPos: 0 }).hidden).toBe(true);
    expect(thumbMetrics({ clientSize: 100, scrollSize: 40, scrollPos: 0 }).hidden).toBe(true);
    expect(thumbMetrics({ clientSize: 0, scrollSize: 400, scrollPos: 0 }).hidden).toBe(true);
  });

  it("脏值（NaN / undefined）当 0，不产出负长度", () => {
    const metrics = thumbMetrics({
      clientSize: Number.NaN,
      scrollSize: 400,
      scrollPos: Number.NaN,
    });
    expect(metrics.hidden).toBe(true);
    expect(metrics.length).toBe(0);
  });
});

describe("scrollOffsetFromThumb（拖滑块反算 scrollTop，与上面互逆）", () => {
  it("拖到轨道两端 → 滚到内容两端", () => {
    const base = { clientSize: 200, scrollSize: 400 };
    expect(scrollOffsetFromThumb(0, base)).toBe(0);
    expect(scrollOffsetFromThumb(100, base)).toBe(200);
  });

  it("中途按比例；超范围的偏移夹取", () => {
    const base = { clientSize: 200, scrollSize: 400 };
    expect(scrollOffsetFromThumb(50, base)).toBe(100);
    expect(scrollOffsetFromThumb(999, base)).toBe(200);
    expect(scrollOffsetFromThumb(-10, base)).toBe(0);
  });

  it("滑块有下限时，拖到底仍然滚到底（否则会“拖到底却没到头”）", () => {
    const base = { clientSize: 400, scrollSize: 20000 };
    expect(scrollOffsetFromThumb(400 - 28, base)).toBe(19600);
  });

  it("不需要滚动时恒为 0", () => {
    expect(scrollOffsetFromThumb(50, { clientSize: 100, scrollSize: 100 })).toBe(0);
    expect(scrollOffsetFromThumb(50, { clientSize: 0, scrollSize: 400 })).toBe(0);
  });

  it("与 thumbMetrics 互逆：位置对得上（同一组数字来回算一遍）", () => {
    const input = { clientSize: 320, scrollSize: 5000 };
    for (const scrollPos of [0, 1, 1234, 3000, 4680]) {
      const { offset } = thumbMetrics({ ...input, scrollPos });
      expect(scrollOffsetFromThumb(offset, input)).toBeCloseTo(scrollPos, 5);
    }
  });
});
