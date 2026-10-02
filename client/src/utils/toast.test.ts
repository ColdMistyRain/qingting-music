import { describe, expect, it } from "vitest";
import { TOAST_LIMIT, removeToast, upsertToast, type ToastItem } from "./toast";

function item(id: number, title: string, tone: ToastItem["tone"] = "info"): ToastItem {
  return { id, title, tone, duration: 5000 };
}

describe("追加（upsertToast）", () => {
  it("空队列里追加一条", () => {
    expect(upsertToast([], item(1, "加载失败"))).toEqual([item(1, "加载失败")]);
  });

  it("同一条（文案 + 色号都一样）不堆叠，换成新的那条重新计时", () => {
    const before = [item(1, "加载失败", "danger"), item(2, "已导入歌词")];
    const after = upsertToast(before, item(3, "加载失败", "danger"));
    expect(after).toHaveLength(2);
    expect(after.map((t) => t.id)).toEqual([2, 3]);
  });

  it("文案相同但色号不同算两条（红的一条不能被中性的顶掉）", () => {
    const after = upsertToast([item(1, "出错了", "danger")], item(2, "出错了", "info"));
    expect(after.map((t) => t.id)).toEqual([1, 2]);
  });

  it(`超出上限从最早的丢，只留最近 ${TOAST_LIMIT} 条`, () => {
    let list: ToastItem[] = [];
    for (let id = 1; id <= TOAST_LIMIT + 2; id += 1)
      list = upsertToast(list, item(id, `第 ${id} 条`));
    expect(list).toHaveLength(TOAST_LIMIT);
    expect(list.map((t) => t.id)).toEqual([3, 4, 5]);
  });

  it("上限可以调（也覆盖 limit = 1 的边界）", () => {
    const one = upsertToast([item(1, "旧")], item(2, "新"), 1);
    expect(one.map((t) => t.id)).toEqual([2]);
  });
});

describe("移除（removeToast）", () => {
  it("按 id 移除那一条，其余保持顺序", () => {
    const after = removeToast([item(1, "a"), item(2, "b"), item(3, "c")], 2);
    expect(after.map((t) => t.id)).toEqual([1, 3]);
  });

  it("id 不存在时原样返回**同一个数组**（调用方据此跳过渲染）", () => {
    const list = [item(1, "a")];
    expect(removeToast(list, 99)).toBe(list);
  });

  it("移除最后一条得到空队列", () => {
    expect(removeToast([item(1, "a")], 1)).toEqual([]);
  });
});
