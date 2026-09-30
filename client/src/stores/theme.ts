import { defineStore } from "pinia";
import { ref } from "vue";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "qt-theme";

/** 默认跟随系统，手动切换后记忆选择（VS-08） */
function resolveInitial(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>("dark");

  function apply(next: ThemeMode, persist: boolean): void {
    mode.value = next;
    document.documentElement.dataset.theme = next;
    if (persist) localStorage.setItem(STORAGE_KEY, next);
  }

  /** 挂载前调用：把已记忆/系统偏好的主题落到 <html data-theme> */
  function init(): void {
    apply(resolveInitial(), false);
  }

  function setTheme(next: ThemeMode): void {
    apply(next, true);
  }

  return { mode, init, setTheme };
});
