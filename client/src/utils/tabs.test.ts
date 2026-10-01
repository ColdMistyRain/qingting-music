import { describe, expect, it } from "vitest";
import { tabSlideDirection } from "./tabs";

const keys = ["appearance", "account", "online", "keys", "fx", "admin", "about"];

describe("tabSlideDirection：切 Tab 的内容滑入方向", () => {
  it("往后选：从右边进来（+1）", () => {
    expect(tabSlideDirection(keys, "fx", "appearance")).toBe(1);
    expect(tabSlideDirection(keys, "account", "appearance")).toBe(1);
  });

  it("往前选：从左边进来（-1）", () => {
    expect(tabSlideDirection(keys, "appearance", "fx")).toBe(-1);
    expect(tabSlideDirection(keys, "online", "about")).toBe(-1);
  });

  it("跨过中间好几项也一样只看先后", () => {
    expect(tabSlideDirection(keys, "about", "account")).toBe(1);
    expect(tabSlideDirection(keys, "account", "about")).toBe(-1);
  });

  it("同一个 key：不翻方向（视为往后，返回 +1）", () => {
    expect(tabSlideDirection(keys, "keys", "keys")).toBe(1);
  });

  it("from 不在列表里（首次渲染、Tab 被移除）：当成往后，不翻方向", () => {
    expect(tabSlideDirection(keys, "account", "")).toBe(1);
    expect(tabSlideDirection(keys, "account", "admin-removed")).toBe(1);
  });

  it("to 不在列表里：同样不翻方向", () => {
    expect(tabSlideDirection(keys, "nope", "appearance")).toBe(1);
  });

  it("列表里多出一个 Tab（管理员多出「管理」）时，按新列表里的位置算", () => {
    const adminKeys = [...keys];
    expect(tabSlideDirection(adminKeys, "about", "admin")).toBe(1);
    expect(tabSlideDirection(adminKeys, "admin", "about")).toBe(-1);
  });

  it("列表为空：不炸，返回 +1", () => {
    expect(tabSlideDirection([], "a", "b")).toBe(1);
  });
});
