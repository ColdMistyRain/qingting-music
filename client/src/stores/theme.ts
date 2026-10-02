import { defineStore } from "pinia";
import { ref } from "vue";
import { syncThemeColor } from "@/utils/themeColor";

export type ThemeMode = "dark" | "light";
/**
 * 材质模式（v4.55，需求方比对用）：
 * - islands = 半透明玻璃浮岛（现状，外观基线）
 * - flat    = 中性底色 + 实心面板，玻璃只留给浮层（Apple Music 网页版的材质逻辑）
 * 只重定义令牌与少数外壳类的底色；组件不得自己判断模式（见 开发约定「材质双模式」）。
 */
export type MaterialMode = "islands" | "flat";

/** 沉浸页布局（VS-09，三形态齐了）：经典双栏 / 沉浸歌词 / 海报背景（彩胶） */
export type ImLayout = "duo" | "center" | "poster";

const STORAGE_KEY = "qt-theme";
const MATERIAL_KEY = "qt-material";
const LAYOUT_KEY = "qt-im-layout";

/** 默认跟随系统，手动切换后记忆选择（VS-08） */
function resolveInitial(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * 材质默认值（v4.59 需求方定稿）：默认「实心面板」（更接近 Apple Music 的材质逻辑）；
 * 「玻璃浮岛」仍保留，设置 › 外观 一键切回并记忆。
 */
function resolveInitialMaterial(): MaterialMode {
  return localStorage.getItem(MATERIAL_KEY) === "islands" ? "islands" : "flat";
}

/** 歌词页布局默认经典双栏（VS-09 的原型默认）。
    逐个白名单校验而不是只判一个特例：localStorage 里可能留着旧版本删除的布局名，
    那种脏值会让页面拿着 undefined 去 `<component :is>`（渲染空白且不报错）。 */
function resolveInitialLayout(): ImLayout {
  const saved = localStorage.getItem(LAYOUT_KEY);
  return saved === "center" || saved === "poster" ? saved : "duo";
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>("dark");
  const material = ref<MaterialMode>("islands");
  const layout = ref<ImLayout>("duo");

  function apply(next: ThemeMode, persist: boolean): void {
    mode.value = next;
    document.documentElement.dataset.theme = next;
    // 手机上的地址栏、以及添加到主屏幕后全屏运行时的状态栏颜色（RT-07）
    syncThemeColor(next);
    if (persist) localStorage.setItem(STORAGE_KEY, next);
  }

  function applyMaterial(next: MaterialMode, persist: boolean): void {
    material.value = next;
    document.documentElement.dataset.material = next;
    if (persist) localStorage.setItem(MATERIAL_KEY, next);
  }

  /** 布局不挂到 <html> 上：它是沉浸页内部的组件切换（VS-09 的组件化要求），不靠 CSS 类 */
  function applyLayout(next: ImLayout, persist: boolean): void {
    layout.value = next;
    if (persist) localStorage.setItem(LAYOUT_KEY, next);
  }

  /** 挂载前调用：把已记忆/系统偏好的主题与材质落到 <html data-*> */
  function init(): void {
    apply(resolveInitial(), false);
    applyMaterial(resolveInitialMaterial(), false);
    applyLayout(resolveInitialLayout(), false);
  }

  function setTheme(next: ThemeMode): void {
    apply(next, true);
  }

  function setMaterial(next: MaterialMode): void {
    applyMaterial(next, true);
  }

  function setLayout(next: ImLayout): void {
    applyLayout(next, true);
  }

  return { mode, material, layout, init, setTheme, setMaterial, setLayout };
});
