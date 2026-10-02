import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "@/utils/debounce";

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("连续调用只执行最后一次，且用的是最后一次的参数", () => {
    const calls: string[] = [];
    const d = debounce((value: string) => calls.push(value), 150);

    d.call("光");
    d.call("光辉");
    d.call("光辉岁月");
    expect(calls).toEqual([]); // 还没到点，一次都不该执行

    vi.advanceTimersByTime(150);
    expect(calls).toEqual(["光辉岁月"]);
  });

  it("间隔超过时长时各执行各的", () => {
    const calls: string[] = [];
    const d = debounce((value: string) => calls.push(value), 100);

    d.call("a");
    vi.advanceTimersByTime(120);
    d.call("b");
    vi.advanceTimersByTime(120);

    expect(calls).toEqual(["a", "b"]);
  });

  it("cancel 清掉待执行的那次，之后仍能继续用", () => {
    const calls: string[] = [];
    const d = debounce((value: string) => calls.push(value), 100);

    d.call("丢掉");
    d.cancel();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([]);

    d.call("保留");
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["保留"]);
  });

  it("时长非正数时退化成同步执行（不排定时器）", () => {
    const calls: string[] = [];
    const d = debounce((value: string) => calls.push(value), 0);

    d.call("立刻");
    expect(calls).toEqual(["立刻"]);
  });
});
