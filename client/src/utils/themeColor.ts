import type { ThemeMode } from "@/stores/theme";

/**
 * 浏览器/系统界面要用的主题色（RT-07）：
 * - `<meta name="theme-color">`：手机浏览器地址栏、以及**添加到主屏幕后全屏运行时的状态栏**；
 * - 取值就是页面底色（`--bg-base`）：状态栏与页面连成一片，不会有突兀的一条。
 *
 * 为什么要 JS 更新：本项目的主题是**手动切换**的（`<html data-theme>`，VS-08），
 * 不是跟随 `prefers-color-scheme`，所以没法用两条带 media 的 meta 静默分流。
 */
const THEME_COLORS: Record<ThemeMode, string> = {
  dark: "#0a0c12",
  light: "#f1f2f5",
};

export function themeColorFor(mode: ThemeMode): string {
  return THEME_COLORS[mode];
}

/** 把主题色写进 `<head>`；没有这个 meta 时补一个（不依赖 index.html 里先写死哪一档） */
export function syncThemeColor(mode: ThemeMode): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = themeColorFor(mode);
}
