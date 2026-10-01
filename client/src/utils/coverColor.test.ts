import { describe, expect, it } from "vitest";
import { extractCoverColors, hslToRgb, hueGap, rgbToHsl, toHex } from "./coverColor";

/** VS-02 / PRD 11.2：封面取色（纯函数部分）——正常与异常路径都要有用例 */

type RGBA = [number, number, number, number];

/** 把若干 RGBA 拼成 canvas 那样的像素数组 */
function pixels(colors: RGBA[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return data;
}

/** n 个同色像素 */
function fill(count: number, color: RGBA): RGBA[] {
  return Array.from({ length: count }, () => color);
}

function hexHue(hex: string): number {
  return rgbToHsl(...(hexToRgb(hex) as [number, number, number]))[0];
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const RED: RGBA = [255, 0, 0, 255];
const GREEN: RGBA = [0, 255, 0, 255];
const BLUE = hslToRgb(220, 0.9, 0.5);
const BLUE_RGBA: RGBA = [BLUE[0], BLUE[1], BLUE[2], 255];
/** 浅黄纸底：大面积但寡淡（低饱和 + 高亮度） */
const CREAM = hslToRgb(45, 0.2, 0.9);
const CREAM_RGBA: RGBA = [CREAM[0], CREAM[1], CREAM[2], 255];

describe("extractCoverColors（封面取两个色源）", () => {
  it("纯色封面：主色就是它", () => {
    const result = extractCoverColors(pixels(fill(16, RED)));

    expect(result?.primary).toBe("#ff0000");
  });

  it("返回的是规范 hex（小写、#rrggbb）", () => {
    const result = extractCoverColors(pixels(fill(16, BLUE_RGBA)));

    expect(result?.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(result?.secondary).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("半透明像素不参与投票（PNG 封面的透明边不吃掉主色）", () => {
    const data = pixels([...fill(50, [255, 0, 0, 100]), ...fill(50, GREEN)]);

    expect(extractCoverColors(data)?.primary).toBe("#00ff00");
  });

  it("少数鲜艳色胜过大面积寡淡色（不是简单数像素）", () => {
    const data = pixels([...fill(60, CREAM_RGBA), ...fill(30, RED)]);

    expect(extractCoverColors(data)?.primary).toBe("#ff0000");
  });

  it("同一色族的多个色取加权平均（主色落在它们之间，不偏向某一边）", () => {
    const a = hslToRgb(185, 0.8, 0.45);
    const b = hslToRgb(205, 0.8, 0.45);
    const data = pixels([
      ...fill(10, [a[0], a[1], a[2], 255]),
      ...fill(10, [b[0], b[1], b[2], 255]),
    ]);
    const hue = hexHue(extractCoverColors(data)!.primary);

    expect(hue).toBeGreaterThan(186);
    expect(hue).toBeLessThan(204);
  });

  it("有异族且占比够时，次色源取那个异族色", () => {
    const data = pixels([...fill(90, BLUE_RGBA), ...fill(20, RED)]);
    const result = extractCoverColors(data)!;

    expect(hexHue(result.primary)).toBeCloseTo(220, 0);
    expect(result.secondary).toBe("#ff0000");
  });

  it("异族占比不足（杂色点）时，次色源退回主色同色相的浅一档（不旋转色相）", () => {
    const data = pixels([...fill(90, BLUE_RGBA), ...fill(5, RED)]);
    const result = extractCoverColors(data)!;
    const [ph, , pl] = rgbToHsl(...(hexToRgb(result.primary) as [number, number, number]));
    const [sh, , sl] = rgbToHsl(...(hexToRgb(result.secondary) as [number, number, number]));

    expect(hueGap(ph, sh)).toBeLessThan(3); // 同色相：不会转出橄榄绿那种脏色
    expect(sl).toBeGreaterThan(pl + 0.08); // 只是浅一档
  });

  it("纯灰阶封面返回 null（不拿灰色去凑一个色源）", () => {
    const data = pixels([
      ...fill(30, [128, 128, 128, 255]),
      ...fill(30, [200, 200, 200, 255]),
      ...fill(30, [40, 40, 40, 255]),
    ]);

    expect(extractCoverColors(data)).toBeNull();
  });

  it("全黑 / 全白封面返回 null（亮度过滤后一个像素都不剩）", () => {
    expect(extractCoverColors(pixels(fill(20, [0, 0, 0, 255])))).toBeNull();
    expect(extractCoverColors(pixels(fill(20, [255, 255, 255, 255])))).toBeNull();
  });

  it("全透明封面返回 null", () => {
    expect(extractCoverColors(pixels(fill(20, [255, 0, 0, 0])))).toBeNull();
  });

  it("数据非法（空 / 长度不是 4 的倍数 / undefined）返回 null 而不是抛错", () => {
    expect(extractCoverColors(new Uint8ClampedArray(0))).toBeNull();
    expect(extractCoverColors(new Uint8ClampedArray(7))).toBeNull();
    expect(extractCoverColors(undefined as unknown as Uint8ClampedArray)).toBeNull();
  });
});

describe("颜色换算（取色的底层工具）", () => {
  it("HSL → RGB → HSL 往返基本无损", () => {
    for (const [h, s, l] of [
      [0, 1, 0.5],
      [140, 0.6, 0.4],
      [265, 0.35, 0.7],
      [340, 0.9, 0.3],
    ] as const) {
      const rgb = hslToRgb(h, s, l);
      const [h2, s2, l2] = rgbToHsl(...rgb);

      expect(hueGap(h, h2)).toBeLessThan(2);
      expect(s2).toBeCloseTo(s, 1);
      expect(l2).toBeCloseTo(l, 1);
    }
  });

  it("色相超出 360 会绕回（次色源靠 +45° 派生）", () => {
    expect(hslToRgb(405, 0.8, 0.5)).toEqual(hslToRgb(45, 0.8, 0.5));
  });

  it("toHex 对浮点分量取整并夹取，不会拼出坏 hex", () => {
    expect(toHex(255.4, 0, 127.6)).toBe("#ff0080");
    expect(toHex(-5, 300, 12.5)).toBe("#00ff0d");
  });
});
