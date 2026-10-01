import { describe, expect, it } from "vitest";
import { emphasisKeyframes, emphasisParams, emphasisProfile } from "./lyricEmphasis";

describe("emphasisProfile（辉光强度曲线）", () => {
  it("两端为 0、中段为 1（对称爆发）", () => {
    expect(emphasisProfile(0)).toBe(0);
    expect(emphasisProfile(1)).toBe(0);
    expect(emphasisProfile(0.5)).toBeCloseTo(1, 6);
  });

  it("非法输入（负数 / 越界 / NaN）一律返回 0，不抛错", () => {
    expect(emphasisProfile(-0.2)).toBe(0);
    expect(emphasisProfile(1.5)).toBe(0);
    expect(emphasisProfile(Number.NaN)).toBe(0);
  });
});

describe("emphasisParams（参数）", () => {
  it("时长很短的短句也至少跑 MIN_DURATION_MS，不会一闪而过", () => {
    const params = emphasisParams({ durationSeconds: 0.05, charCount: 4 });
    expect(params.durationMs).toBeGreaterThanOrEqual(700);
  });

  it("长音更长更明显，但有上限（不拖到下一句）", () => {
    const short = emphasisParams({ durationSeconds: 0.4, charCount: 4 });
    const long = emphasisParams({ durationSeconds: 8, charCount: 4 });

    expect(long.durationMs).toBeGreaterThan(short.durationMs);
    expect(long.durationMs).toBeLessThanOrEqual(1800);
    expect(long.glow).toBeGreaterThan(short.glow);
  });

  it("末字加强一档（收尾那一下最容易被看见）", () => {
    const normal = emphasisParams({ durationSeconds: 1, charCount: 4 });
    const last = emphasisParams({ durationSeconds: 1, charCount: 4, isLastWord: true });

    expect(last.durationMs).toBeGreaterThanOrEqual(normal.durationMs);
    expect(last.glow).toBeGreaterThan(normal.glow);
    // 幅度有上限，不会糊成一团
    expect(last.amount).toBeLessThanOrEqual(1.2);
    expect(last.glow).toBeLessThanOrEqual(0.3);
  });

  it("错峰随字数摊分：字数越多，单字错峰越小", () => {
    const few = emphasisParams({ durationSeconds: 1, charCount: 2 });
    const many = emphasisParams({ durationSeconds: 1, charCount: 12 });

    expect(many.staggerMs).toBeLessThan(few.staggerMs);
    expect(few.staggerMs).toBeGreaterThan(0);
  });

  it("非法时长（负数）不产生负的动画参数", () => {
    const params = emphasisParams({ durationSeconds: -3, charCount: 0 });
    expect(params.durationMs).toBeGreaterThan(0);
    expect(params.staggerMs).toBeGreaterThan(0);
    expect(params.amount).toBeGreaterThan(0);
  });
});

describe("emphasisKeyframes（关键帧）", () => {
  const params = emphasisParams({ durationSeconds: 1, charCount: 3 });

  it("首尾回到原位、中段有位移与缩放（跑完不留残留样式）", () => {
    const frames = emphasisKeyframes({ charIndex: 1, charCount: 3, params });
    expect(frames).toHaveLength(32);

    const first = frames[0]!;
    const mid = frames[15]!;
    const last = frames.at(-1)!;

    expect(first.offset).toBeCloseTo(1 / 32, 6);
    expect(mid.transform).toMatch(/scale\(1\.0[1-9]/);
    expect(mid.textShadow).toContain("var(--accent-soft)");
    // 末尾那一帧已几乎回到原位（profile(1) = 0 前的最后一帧）
    expect(last.transform).toMatch(/scale\(1\.0[0-2]/);
  });

  it("两侧的字向中间推挤，居中的字位移最小", () => {
    const left = emphasisKeyframes({ charIndex: 0, charCount: 5, params })[15]!;
    const center = emphasisKeyframes({ charIndex: 2, charCount: 5, params })[15]!;

    const translateX = (frame: Keyframe) =>
      Number.parseFloat(/translate\((-?[\d.]+)em/.exec(String(frame.transform))?.[1] ?? "0");
    expect(Math.abs(translateX(left))).toBeGreaterThan(Math.abs(translateX(center)));
  });

  it("offset 单调递增到 1，可直接交给 element.animate", () => {
    const frames = emphasisKeyframes({ charIndex: 0, charCount: 2, params });
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.offset).toBeGreaterThan(frames[i - 1]!.offset as number);
    }
  });
});
