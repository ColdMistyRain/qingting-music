import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import {
  computeVirtualWindow,
  fullWindow,
  pitchFromTops,
  ROW_PITCH_FALLBACK,
  VIRTUAL_MIN_ROWS,
  VIRTUAL_OVERSCAN,
  VIRTUAL_THRESHOLD,
  type VirtualWindow,
} from "@/utils/virtualList";

/**
 * 长列表虚拟滚动（LB-08）：把 DOM 里的行收窄到“看得见的那十几行”，
 * 上下用垫片把没渲染的行占住地方 —— 滚动条长度、滚动位置与全量渲染逐像素一致。
 *
 * 几何全在 `utils/virtualList`（纯函数 + 单测），这里只做 DOM 与事件：
 * 找滚动祖先、量行距与列表顶、在滚动/尺寸变化时重算。
 * 与 `useActiveIndicator` 同一套分工：宿主知道自己的行叫什么，选择器由调用方给。
 */
export interface UseVirtualListOptions {
  /** 列表容器：虚拟滚动的坐标基准，也是垫片要插进去的地方 */
  list: Ref<HTMLElement | null>;
  /** 行选择器（例如 `".row"`；垫片与分隔线都不该被选中） */
  rowSelector: string;
  /** 行数 */
  count: () => number;
  /** 超过这么多行才虚拟化（默认 VIRTUAL_THRESHOLD） */
  threshold?: number;
  /** 上下各多渲染几行（默认 VIRTUAL_OVERSCAN） */
  overscan?: number;
}

export function useVirtualList(options: UseVirtualListOptions) {
  const threshold = options.threshold ?? VIRTUAL_THRESHOLD;
  const overscan = options.overscan ?? VIRTUAL_OVERSCAN;
  /** 行距：首帧按估值铺，量到真值就换 */
  const pitch = ref(ROW_PITCH_FALLBACK);
  const win = ref<VirtualWindow>(initialWindow());
  let scroller: HTMLElement | null = null;
  let frame = 0;
  let observer: ResizeObserver | undefined;

  /**
   * 挂载前的那一帧：还没量到任何几何，所以只渲染够量出行距的几行，
   * 其余用估值垫住（不然首帧会把 500 行全塞进 DOM，正好是这一版要解决的问题）。
   */
  function initialWindow(): VirtualWindow {
    const count = Math.max(0, options.count());
    if (count <= threshold) return fullWindow(count);
    const end = Math.min(count, VIRTUAL_MIN_ROWS);
    return { start: 0, end, padTop: 0, padBottom: (count - end) * ROW_PITCH_FALLBACK };
  }

  /**
   * 往上找“真的能滚”的祖先：`overflow-y: auto | scroll` **且** 内容确实溢出。
   *
   * 只看 overflow 会把 `overflow: hidden` 的岛也算进来（与坑 28 同一类），而它滚不动 ——
   * 少渲染的行就永远看不到了。找不到就整份渲染（退路），绝不赌。
   * 列表自己也算候选：控制台的曲目行就住在滚动区里（列表容器就是滚动区）。
   */
  function findScroller(from: HTMLElement): HTMLElement | null {
    let el: HTMLElement | null = from;
    while (el) {
      const overflowY = getComputedStyle(el).overflowY;
      if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  /** 解析滚动容器，并把滚动监听挪过去（容器可能晚一步才出现，也可能被换掉） */
  function syncScroller(): HTMLElement | null {
    if (scroller?.isConnected) return scroller;
    const list = options.list.value;
    if (!list) return null;
    const next = findScroller(list);
    if (next !== scroller) {
      scroller?.removeEventListener("scroll", schedule);
      scroller = next;
      scroller?.addEventListener("scroll", schedule, { passive: true });
    }
    return scroller;
  }

  function measure(): void {
    const count = Math.max(0, options.count());
    const list = options.list.value;
    if (!list || count <= threshold) {
      win.value = fullWindow(count);
      return;
    }
    const target = syncScroller();
    if (!target) {
      // 找不到能滚的祖先（列表整份铺在页面上）：整份渲染 —— 少渲染的行没人能滚到它
      win.value = fullWindow(count);
      return;
    }

    const rows = Array.from(list.querySelectorAll<HTMLElement>(options.rowSelector));
    const measured = pitchFromTops(rows.map((row) => row.offsetTop));
    let pitchChanged = false;
    if (measured > 0 && Math.abs(measured - pitch.value) > 0.5) {
      pitch.value = measured;
      pitchChanged = true;
    }

    // 垫片也是 flex 子元素，两侧照样吃 row-gap —— 行间要从计算样式里读（宽屏 4 / 窄屏 12 / 控制台宽屏 0）
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0;
    // 列表顶在“滚动内容”里的位移：滚动区上面/里面还有别的东西时（本地列表的提示行）得减掉，
    // clientTop 是滚动区自己的边框宽度（scrollTop 从内边距边缘起算）。
    // 取整：rect 的差值带亚像素噪声（DPR 不是整数时会随滚动位置飘），
    // 让它进 `floor(scrolled / pitch)` 会让窗口在某几个位置莫名多/少一行。
    const listTop =
      target === list
        ? 0
        : Math.round(
            target.scrollTop +
              list.getBoundingClientRect().top -
              target.getBoundingClientRect().top -
              target.clientTop,
          );

    win.value = computeVirtualWindow({
      count,
      pitch: pitch.value,
      gap,
      viewport: target.clientHeight,
      listTop,
      scrollTop: target.scrollTop,
      overscan,
    });

    // 行距刚被纠正（首帧用的是估值）：窗口与垫片都得按新行距重算一遍
    if (pitchChanged) schedule();
  }

  function schedule(): void {
    if (frame) return;
    // 坑 10：页面不可见时 rAF 不触发 —— 直接同步算，否则首帧与后续更新都不来
    if (typeof requestAnimationFrame !== "function" || document.visibilityState !== "visible") {
      measure();
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  }

  onMounted(async () => {
    await nextTick();
    measure();
    const list = options.list.value;
    if (!list) return;
    // 视口变高变矮、列表被筛短、侧栏折叠都会改变几何；滚动本身单独听
    observer = new ResizeObserver(() => schedule());
    observer.observe(list);
    if (scroller) observer.observe(scroller);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("resize", schedule);
  });

  onBeforeUnmount(() => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    scroller?.removeEventListener("scroll", schedule);
    scroller = null;
    observer?.disconnect();
    observer = undefined;
    document.removeEventListener("visibilitychange", schedule);
    window.removeEventListener("resize", schedule);
  });

  watch(options.list, () => schedule());
  watch(
    () => options.count(),
    () => schedule(),
  );

  return {
    /** 要渲染的区间 [start, end) */
    start: computed(() => win.value.start),
    end: computed(() => win.value.end),
    padTop: computed(() => win.value.padTop),
    padBottom: computed(() => win.value.padBottom),
    /** 这一份列表现在有没有走虚拟滚动（阈值以下整份渲染） */
    virtualized: computed(() => options.count() > threshold),
    /** 宿主动了版式之后可以自己叫一次重量 */
    measure,
  };
}
