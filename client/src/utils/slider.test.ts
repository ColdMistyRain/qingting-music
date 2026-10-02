import { describe, expect, it } from "vitest";
import { fillGeometry, quantizeValue, sliderRatio, stepValue, valueFromRatio } from "./slider";

/** 均衡器那两档范围：每段 ±12dB、整体增益 ±10dB（PL-13） */
const band = { min: -12, max: 12, step: 1 };
const master = { min: -10, max: 10, step: 1 };
const volume = { min: 0, max: 1, step: 0.05 };

describe("位置比例（值 → 0~1）", () => {
  it("两端与中线就是 0 / 1 / 0.5", () => {
    expect(sliderRatio(-10, master)).toBe(0);
    expect(sliderRatio(0, master)).toBe(0.5);
    expect(sliderRatio(10, master)).toBe(1);
  });

  it("超出范围夹取（拖动时指针会跑出轨道，值不能跟着越界）", () => {
    expect(sliderRatio(-99, master)).toBe(0);
    expect(sliderRatio(99, master)).toBe(1);
  });

  it("min === max 时按 0 处理，不产生 NaN / Infinity", () => {
    expect(sliderRatio(5, { min: 5, max: 5 })).toBe(0);
  });
});

describe("步长对齐与夹取", () => {
  it("按步长取整并夹到范围内", () => {
    expect(quantizeValue(2.4, band)).toBe(2);
    expect(quantizeValue(2.6, band)).toBe(3);
    expect(quantizeValue(99, band)).toBe(12);
    expect(quantizeValue(-99, band)).toBe(-12);
  });

  it("浮点步长不留尾巴（音量条的 0.05）", () => {
    expect(quantizeValue(0.30000000000000004, volume)).toBe(0.3);
    expect(quantizeValue(0.37, volume)).toBe(0.35);
    expect(quantizeValue(1.2, volume)).toBe(1);
  });

  it("步长为 0 或负数时只夹取，不做无意义的除零", () => {
    expect(quantizeValue(2.4, { min: 0, max: 10, step: 0 })).toBe(2.4);
    expect(quantizeValue(2.4, { min: 0, max: 10, step: -1 })).toBe(2.4);
  });

  it("不传步长时按 1 处理", () => {
    expect(quantizeValue(2.6, { min: 0, max: 10 })).toBe(3);
  });
});

describe("位置比例 → 值", () => {
  it("中线在双极范围里就是 0", () => {
    expect(valueFromRatio(0.5, band)).toBe(0);
    expect(valueFromRatio(0, master)).toBe(-10);
    expect(valueFromRatio(1, master)).toBe(10);
  });

  it("比例超出 0~1 也夹取（指针捕获后拖到轨道外）", () => {
    expect(valueFromRatio(-0.5, master)).toBe(-10);
    expect(valueFromRatio(1.5, master)).toBe(10);
  });

  it("落点仍按步长对齐", () => {
    expect(valueFromRatio(0.333, volume)).toBe(0.35);
    expect(valueFromRatio(0.75, band)).toBe(6);
  });
});

describe("填充条几何", () => {
  it("单极（音量）：从 min 端往 max 端长", () => {
    expect(fillGeometry(0, false)).toEqual({ start: 0, size: 0 });
    expect(fillGeometry(0.5, false)).toEqual({ start: 0, size: 0.5 });
    expect(fillGeometry(1, false)).toEqual({ start: 0, size: 1 });
  });

  it("双极（±dB）：从中线往两侧长 —— 0 处不填充", () => {
    expect(fillGeometry(0.5, true)).toEqual({ start: 0.5, size: 0 });
    expect(fillGeometry(0.75, true)).toEqual({ start: 0.5, size: 0.25 });
    expect(fillGeometry(0.25, true)).toEqual({ start: 0.25, size: 0.25 });
  });

  it("双极的两个端点各填满一半", () => {
    expect(fillGeometry(0, true)).toEqual({ start: 0, size: 0.5 });
    expect(fillGeometry(1, true)).toEqual({ start: 0.5, size: 0.5 });
  });
});

describe("键盘步进", () => {
  it("↑→ 加、↓← 减，一次一个步长", () => {
    expect(stepValue(0, "ArrowUp", band)).toBe(1);
    expect(stepValue(0, "ArrowRight", band)).toBe(1);
    expect(stepValue(0, "ArrowDown", band)).toBe(-1);
    expect(stepValue(0, "ArrowLeft", band)).toBe(-1);
  });

  it("Home / End 到两端", () => {
    expect(stepValue(3, "Home", band)).toBe(-12);
    expect(stepValue(3, "End", band)).toBe(12);
  });

  it("按住 Shift 走大步（缺省是步长的 10 倍，也可以显式给）", () => {
    expect(stepValue(0, "ArrowUp", { ...band, shift: true })).toBe(10);
    expect(stepValue(0, "ArrowUp", { ...band, shift: true, bigStep: 5 })).toBe(5);
    expect(stepValue(0, "ArrowUp", { ...band, bigStep: 5 })).toBe(1);
  });

  it("到端处不再越界", () => {
    expect(stepValue(12, "ArrowUp", band)).toBe(12);
    expect(stepValue(-12, "ArrowDown", band)).toBe(-12);
  });

  it("没接的键返回 null（调用方据此决定不 preventDefault，页面滚动照旧）", () => {
    expect(stepValue(0, "Tab", band)).toBeNull();
    expect(stepValue(0, "PageUp", band)).toBeNull();
    expect(stepValue(0, "a", band)).toBeNull();
  });
});
