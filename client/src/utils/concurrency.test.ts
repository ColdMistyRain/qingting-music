import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "@/utils/concurrency";

/** 让一个 Promise 在若干微任务之后才 settle，用于观察并发窗口 */
function later<T>(value: T, ticks = 1): Promise<T> {
  let promise = Promise.resolve(value);
  for (let i = 0; i < ticks; i += 1) promise = promise.then((v) => v);
  return promise;
}

describe("mapWithConcurrency", () => {
  it("结果与入参一一对应（完成顺序不影响下标）", async () => {
    const items = [30, 10, 20];
    const result = await mapWithConcurrency(items, 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms * 2;
    });

    expect(result).toEqual([60, 20, 40]);
  });

  it("同时进行的任务数不超过上限", async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, index) => index);

    await mapWithConcurrency(items, 4, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await later(null, 3);
      running -= 1;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // 确实是并行的，不是退化成串行
  });

  it("单件失败不连坐：那一项为 null，其它照常返回", async () => {
    const result = await mapWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) throw new Error("这件坏了");
      return value * 10;
    });

    expect(result).toEqual([10, null, 30]);
  });

  it("空数组直接返回，边界值（0 / 负数 / 超大上限）都不炸", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);

    const calls: number[] = [];
    const worker = async (value: number) => {
      calls.push(value);
      return value;
    };
    expect(await mapWithConcurrency([1, 2], 0, worker)).toEqual([1, 2]);
    expect(await mapWithConcurrency([3, 4], -5, worker)).toEqual([3, 4]);
    expect(await mapWithConcurrency([5, 6], 999, worker)).toEqual([5, 6]);
    expect(calls).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
