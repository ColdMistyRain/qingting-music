import { afterEach, describe, expect, it } from "vitest";
import { isTopLayer, popTopLayer, pushTopLayer, resetTopLayers } from "./topLayer";

describe("topLayer", () => {
  afterEach(() => resetTopLayers());

  it("没有登记过任何层时，谁都算不上最上层", () => {
    expect(isTopLayer(1)).toBe(false);
  });

  it("后开的层在最上面；关掉它之后，之前那层又回到最上面", () => {
    const immersive = pushTopLayer();
    const sheet = pushTopLayer();

    expect(isTopLayer(immersive)).toBe(false);
    expect(isTopLayer(sheet)).toBe(true);

    popTopLayer(sheet);
    expect(isTopLayer(sheet)).toBe(false);
    expect(isTopLayer(immersive)).toBe(true);
  });

  it("从中间关掉一层不影响它上面的层（对话框关掉后抽屉仍是上层）", () => {
    const immersive = pushTopLayer();
    const sheet = pushTopLayer();
    const dialog = pushTopLayer();

    popTopLayer(sheet);

    expect(isTopLayer(dialog)).toBe(true);
    expect(isTopLayer(immersive)).toBe(false);
  });

  it("重复关同一层是安全的，也不会把别的层带走", () => {
    const first = pushTopLayer();
    const second = pushTopLayer();

    popTopLayer(second);
    popTopLayer(second);

    expect(isTopLayer(first)).toBe(true);
  });
});
