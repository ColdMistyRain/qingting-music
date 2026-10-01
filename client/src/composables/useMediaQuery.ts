import { onUnmounted, ref, type Ref } from "vue";

/**
 * 手机断点（RT-01）：与 CSS 里那组 `@media (max-width: 767px)` **同一个值**。
 * 用在“同一处要显示不同内容”的地方（不只是换样式）——纯样式差异一律写在 CSS 里，
 * 别把断点判断搬进 JS（见 docs/dev/开发约定.md 的“手机断点只有一处”）。
 */
export const MOBILE_QUERY = "(max-width: 767px)";

/**
 * 响应式媒体查询（浏览器侧薄封装）。
 * `window` 或 `matchMedia` 不存在时恒返回 false（老引擎 / 非浏览器环境不炸）。
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false);
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return matches;

  const mql = window.matchMedia(query);
  matches.value = mql.matches;
  const onChange = (event: MediaQueryListEvent): void => {
    matches.value = event.matches;
  };
  mql.addEventListener("change", onChange);
  onUnmounted(() => mql.removeEventListener("change", onChange));
  return matches;
}
