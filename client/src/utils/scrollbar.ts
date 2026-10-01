/**
 * 滚动条宽度（VS-* 布局口径）。
 *
 * 为什么不能写死：`--scrollbar-size` 的旧值是 **10px** —— 那是 Chromium `::-webkit-scrollbar`
 * 的宽度。Firefox 不认这个伪元素，只认 `scrollbar-width: thin`，而 thin 的实际宽度由引擎与
 * 平台给（Windows 上不是 10px）。而侧栏、页框（`.page-frame`）、控制台都用
 * `scrollbar-gutter: stable` + `margin-right: calc(var(--scrollbar-size) * -1)` 把滚动条槽
 * **挪进内边距** —— 令牌一旦与实际宽度不等，内容盒宽度就差几个像素：Firefox 下折叠侧栏的
 * 导航项与高亮被挤歪（需求方拿 Chromium / Firefox 并排截图指出：“侧边栏这里会有 bug”）。
 *
 * 与 `--dpr` 同一个原则：JS 只写一个**原始值**，怎么用留在 CSS。
 */

/** 从「外框宽 − 内容盒宽」得出滚动条宽度；量不到 / 值明显不合理时返回 0。
 *  **0 也是有效结果**（“本引擎不占滚动条位”），调用方要照写进令牌 —— 不能当“没量到”跳过，
 *  否则 CSS 兑底值会给一个根本不需要补偿的引擎多减一道（v5.31 修）。 */
export function scrollbarSizeFrom(offsetWidth: number, clientWidth: number): number {
  const size = offsetWidth - clientWidth;
  if (!Number.isFinite(size) || size < 0 || size > 40) return 0;
  return Math.round(size);
}

/**
 * 实测一次并写进 `--scrollbar-size`（返回量到的值）。
 * 探针放视口外、`overflow: scroll` 保证一定有滚动条可量；量完立即移除。
 * ⚠️ **0 也要写**：0 = “本引擎不占滚动条位”，侧栏/页框的
 * `margin-right: calc(var(--scrollbar-size, 0px) * -1)` 就该归零 —— 不写就会退回 CSS 兑底值。
 */
export function syncScrollbarSize(host: HTMLElement = document.documentElement): number {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;width:100px;height:100px;overflow:scroll;scrollbar-gutter:stable";
  host.appendChild(probe);
  const size = scrollbarSizeFrom(probe.offsetWidth, probe.clientWidth);
  probe.remove();
  host.style.setProperty("--scrollbar-size", `${size}px`);
  return size;
}
