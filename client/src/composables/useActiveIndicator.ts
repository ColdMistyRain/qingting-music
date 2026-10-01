import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * 量「当前选中项」在容器里的位置与尺寸，供一条**共享指示条**滑过去（v5.9）。
 *
 * 为什么抽出来：Tab 的下划线（`SettingsView`）与分段控件的底板（`SegmentedControl`）干的是同一件事 ——
 * 「选中态换颜色」只能原地淡入淡出，想让它**滑过去**就必须是一条独立的元素 + 量出来的坐标。
 * 两处各写一份必然会漂（v4.95 的教训：同一类控件两份实现，改一处就只改了一半）。
 *
 * @param activeSelector 选中项的选择器，例如 `'[role="tab"][data-state="active"]'`
 * @returns `setRoot` 给模板绑 `:ref="setRoot"`（容器要 `position: relative`，它同时是 offsetParent，
 *          量出来的坐标才是相对容器的；用函数 ref 而不是字符串 ref，是因为后者在 vue-tsc 眼里
 *          不算“读过这个变量”，会被 `noUnusedLocals` 判成未使用）；
 *          `rect` 是选中项的位置尺寸（写成哪几个 CSS 变量由调用方定，“怎么用”留在 CSS）；
 *          `ready` 在首帧量完之后才为 true（用它开过渡，否则开页时指示条会从 0 滑到第一格，是个假动画）；
 *          `sync` 供切换 / 列表变化时手动重量。
 */
export function useActiveIndicator(activeSelector: string) {
  const rootRef = ref<HTMLElement | null>(null);
  const rect = ref({ x: 0, y: 0, w: 0, h: 0 });
  const ready = ref(false);
  let observer: ResizeObserver | undefined;

  function setRoot(el: unknown): void {
    rootRef.value = (el as HTMLElement | null) ?? null;
  }

  function sync(): void {
    const el = rootRef.value?.querySelector<HTMLElement>(activeSelector);
    if (!el) return;
    rect.value = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  }

  onMounted(async () => {
    await nextTick();
    sync();
    requestAnimationFrame(() => {
      ready.value = true;
    });
    // 窗口缩放、侧栏折叠、字体替换都会改变选项宽度，跟着重量一次
    observer = new ResizeObserver(() => sync());
    if (rootRef.value) observer.observe(rootRef.value);
  });

  onBeforeUnmount(() => observer?.disconnect());

  return { setRoot, rect, ready, sync };
}
