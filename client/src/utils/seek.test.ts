import { describe, expect, it } from "vitest";
import { seekKeyTarget } from "@/utils/seek";

describe("seekKeyTarget", () => {
  it("→ / ↑ 是相对位移，不把值对齐到步长整数倍", () => {
    // 这条正是不能拄 slider.stepValue 的理由：7 + 5 必须给 12，若给 10 就是“只走了 3 秒”
    expect(seekKeyTarget(7, "ArrowRight", 300)).toBe(12);
    expect(seekKeyTarget(7, "ArrowUp", 300)).toBe(12);
  });

  it("← / ↓ 往回 5 秒", () => {
    expect(seekKeyTarget(40, "ArrowLeft", 300)).toBe(35);
    expect(seekKeyTarget(40, "ArrowDown", 300)).toBe(35);
  });

  it("往回超出 0 时夹到 0", () => {
    expect(seekKeyTarget(3, "ArrowLeft", 300)).toBe(0);
    expect(seekKeyTarget(0, "ArrowLeft", 300)).toBe(0);
  });

  it("往前超出总时长时夹到总时长", () => {
    expect(seekKeyTarget(298, "ArrowRight", 300)).toBe(300);
    expect(seekKeyTarget(300, "ArrowRight", 300)).toBe(300);
  });

  it("Home 到 0、End 到总时长", () => {
    expect(seekKeyTarget(120, "Home", 300)).toBe(0);
    expect(seekKeyTarget(120, "End", 300)).toBe(300);
  });

  it("时长还没读出来（0 / NaN / 负数）时一律回 0，不会给出负值", () => {
    expect(seekKeyTarget(10, "End", 0)).toBe(0);
    expect(seekKeyTarget(10, "ArrowRight", 0)).toBe(0);
    expect(seekKeyTarget(10, "ArrowLeft", 0)).toBe(0);
    expect(seekKeyTarget(10, "ArrowRight", Number.NaN)).toBe(0);
    expect(seekKeyTarget(10, "End", -5)).toBe(0);
  });

  it("不认识的键返回 null（调用方不 preventDefault）", () => {
    expect(seekKeyTarget(10, "Enter", 300)).toBeNull();
    expect(seekKeyTarget(10, " ", 300)).toBeNull();
    expect(seekKeyTarget(10, "PageUp", 300)).toBeNull();
  });

  it("当前值本身异常（NaN）时退为 0 起算，不把 NaN 传下去", () => {
    expect(seekKeyTarget(Number.NaN, "ArrowRight", 300)).toBe(5);
    expect(seekKeyTarget(Number.NaN, "End", 300)).toBe(300);
  });

  it("步长可覆盖（缺省是 PL-08 的 5 秒）", () => {
    expect(seekKeyTarget(10, "ArrowRight", 300, 15)).toBe(25);
  });
});
