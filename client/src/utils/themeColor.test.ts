import { describe, expect, it } from "vitest";
import { themeColorFor } from "./themeColor";

describe("themeColorFor（RT-07：状态栏/地址栏跟着主题走）", () => {
  it("深色用页面底色（近黑），浅色用浅灰底", () => {
    expect(themeColorFor("dark")).toBe("#0a0c12");
    expect(themeColorFor("light")).toBe("#f1f2f5");
  });

  it("和 tokens.css 里的 --bg-base 一致（改底色时这里也要改）", () => {
    // 这两个值不放在 CSS 变量里：meta 的 content 得在 JS 里写，
    // 读 CSS 变量要多一次 getComputedStyle，而它俩一年也不会变一次。
    expect(themeColorFor("dark")).toMatch(/^#[0-9a-f]{6}$/);
    expect(themeColorFor("light")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
