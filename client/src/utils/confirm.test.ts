import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmAction } from "./confirm";

const originalConfirm: typeof confirm | undefined = globalThis.confirm;

function stubConfirm(value: boolean): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => value);
  globalThis.confirm = spy as unknown as typeof confirm;
  return spy;
}

describe("confirmAction", () => {
  afterEach(() => {
    globalThis.confirm = originalConfirm as typeof confirm;
    vi.restoreAllMocks();
  });

  it("用户点确定时返回 true，并把提示原样交给宿主对话框", async () => {
    const spy = stubConfirm(true);

    await expect(confirmAction("确定清空这 12 首？")).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith("确定清空这 12 首？");
  });

  it("用户取消时返回 false", async () => {
    stubConfirm(false);

    await expect(confirmAction("确定删除选中的 2 首？")).resolves.toBe(false);
  });

  it("环境里没有对话框（Node / SSR）时按取消处理，绝不默认删", async () => {
    // @ts-expect-error 故意删掉，模拟没有 confirm 的环境
    delete globalThis.confirm;

    await expect(confirmAction("确定清空这 12 首？")).resolves.toBe(false);
  });
});
