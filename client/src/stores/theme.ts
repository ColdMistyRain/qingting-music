import { defineStore } from "pinia";
import { ref } from "vue";

export type ThemeMode = "dark" | "light";
/**
 * 材质模式（v4.55，需求方比对用）：
 * - islands = 半透明玻璃浮岛（现状，外观基线）
 * - flat    = 中性底色 + 实心面板，玻璃只留给浮层（Apple Music 网页版的材质逻辑）
 * 只重定义令牌与少数外壳类的底色；组件不得自己判断模式（见 开发约定「材质双模式」）。
 */
export type MaterialMode = "islands" | "flat";

const STORAGE_KEY = "qt-theme";
const MATERIAL_KEY = "qt-material";

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

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>("dark");
  const material = ref<MaterialMode>("islands");

  function apply(next: ThemeMode, persist: boolean): void {
    mode.value = next;
    document.documentElement.dataset.theme = next;
    if (persist) localStorage.setItem(STORAGE_KEY, next);
  }

  function applyMaterial(next: MaterialMode, persist: boolean): void {
    material.value = next;
    document.documentElement.dataset.material = next;
    if (persist) localStorage.setItem(MATERIAL_KEY, next);
  }

  /** 挂载前调用：把已记忆/系统偏好的主题与材质落到 <html data-*> */
  function init(): void {
    apply(resolveInitial(), false);
    applyMaterial(resolveInitialMaterial(), false);
  }

  function setTheme(next: ThemeMode): void {
    apply(next, true);
  }

  function setMaterial(next: MaterialMode): void {
    applyMaterial(next, true);
  }

  return { mode, material, init, setTheme, setMaterial };
});
