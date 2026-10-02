import type { Directive } from "vue";
import { scrollOffsetFromThumb, thumbMetrics } from "@/utils/scrollbar";

/**
 * 自绘**浮层滚动条**（v6.18）：`<div class="page-frame__scroll" v-overlay-scroll>`。
 *
 * 为什么：原生滚动条**占位**，逼着我们到处补偿那一条宽度 —— 表头与行各留一份
 * `scrollbar-gutter: stable`、侧栏与控制台还要用负外边距把槽挪进内边距、
 * `--scrollbar-size` 得在启动时实测一次（引擎不同宽度还不同，Firefox 下就偏过）。
 * 换成浮在内容上的自绘条之后，这一整套补偿都不需要了，观感也归我们自己。
 *
 * 三条设计取舍：
 * ① **不改变 DOM 结构**：滚动容器的子元素一个不动（我们的页框契约、负边距铺到岛边、
 *    `:has()` 那一套都靠结构成立）。滚动条挂在**父元素**上（给它加 `data-overlay-scroll-host`
 *    只是为了 `position: relative`）—— 挂在滚动容器里是不行的：绝对定位的子元素
 *    属于**被滚动的内容**，条会跟着列表一起滚走。
 * ② **滚动本身仍是原生的**：只把原生滚动条藏掉（`scrollbar-width: none` + 伪元素），
 *    滚轮 / 触摸 / 键盘 / 滚动锚定一个都不接管；自绘条只是「显示 + 可以拖」。
 * ③ **触摸设备整条不画**（CSS `pointer: coarse` 里 `display: none`）：iOS / Android
 *    本来就是浮层滚动条，叠一条自己的只会变成两条。
 *
 * 几何全部来自 `utils/scrollbar.ts` 的纯函数（有单测），这里只管 DOM 与事件。
 */

/** 闲置多久自动淡出（滚动 / 拖拽中不淡） */
const HIDE_DELAY_MS = 900;
/** 滑块最小长度：列表再长也不能细成一根线 */
const MIN_THUMB = 28;
/** 轨道与滚动区边界的内缩（px），上下 / 右 */
const BAR_INSET_Y = 3;
const BAR_INSET_X = 2;

interface State {
  host: HTMLElement;
  /** 第一次真的能滚时才建（否则每个页框、每个容器都留一个用不上的条） */
  bar: HTMLElement | null;
  thumb: HTMLElement | null;
  /** 合帧：一次 rAF 里只量一次、写一次 */
  frame: number;
  /** 下一次更新时要不要重新量轨道位置（滚动时不用量，只有布局变了才量） */
  needsBox: boolean;
  hideTimer: number;
  hovering: boolean;
  dragging: boolean;
  dragStartY: number;
  dragStartOffset: number;
  /** 最近一次算出的滑块偏移（拖拽拿它当起点，不用去 DOM 上反解析样式） */
  thumbOffset: number;
  resizeObserver: ResizeObserver | null;
  mutationObserver: MutationObserver | null;
  onScroll: () => void;
}

const states = new WeakMap<HTMLElement, State>();

/** 把一次更新排进下一帧（滚动事件一秒能来上百个，别每次都量布局） */
function schedule(state: State, el: HTMLElement, needsBox = false): void {
  if (needsBox) state.needsBox = true;
  // ⚠️ 页面不可见时 rAF **不触发**（AGENTS 坑 10）：直接同步跑，否则位置会永远停在旧值
  if (document.visibilityState !== "visible") {
    if (state.frame) {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    }
    update(state, el);
    return;
  }
  if (state.frame) return;
  state.frame = requestAnimationFrame(() => {
    state.frame = 0;
    update(state, el);
  });
}

function scheduleHide(state: State): void {
  window.clearTimeout(state.hideTimer);
  if (state.dragging || state.hovering) return;
  state.hideTimer = window.setTimeout(() => {
    state.bar?.classList.remove("is-on");
  }, HIDE_DELAY_MS);
}

function show(state: State): void {
  window.clearTimeout(state.hideTimer);
  state.bar?.classList.add("is-on");
}

/** 第一次真的能滚时把条建出来（挂到宿主上，而不是滚动容器里——后者会跟着内容滚走） */
function ensureBar(state: State, el: HTMLElement): HTMLElement {
  if (state.bar) return state.bar;
  const bar = document.createElement("div");
  bar.className = "os-bar";
  // 纯装饰：滚动本身仍是原生的，键盘/读屏不需要它
  bar.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "os-thumb";
  bar.appendChild(thumb);
  state.host.appendChild(bar);
  state.bar = bar;
  state.thumb = thumb;

  bar.addEventListener("pointerdown", (event) => onBarPointerDown(state, el, event));
  thumb.addEventListener("pointerdown", (event) => onThumbPointerDown(state, event));
  thumb.addEventListener("pointermove", (event) => onThumbPointerMove(state, el, event));
  thumb.addEventListener("pointerup", () => onThumbPointerUp(state));
  thumb.addEventListener("pointercancel", () => onThumbPointerUp(state));
  // 捕获被系统收走（触控笔抬起、系统手势介入）也算松手
  thumb.addEventListener("lostpointercapture", () => onThumbPointerUp(state));
  bar.addEventListener("pointerenter", () => {
    state.hovering = true;
    show(state);
  });
  bar.addEventListener("pointerleave", () => {
    state.hovering = false;
    scheduleHide(state);
  });
  return bar;
}

/**
 * 把轨道摆到**滚动容器自己**的盒子上。
 *
 * 为什么不写在 CSS 里：我们的滚动区会靠负边距**溢出它的页框**（页框里只有内容那一段，
 * 而滚动区要铺到岛边），所以宿主的 `top/right/bottom` 与滚动区并不重合 ——
 * 写在 CSS 里轨道会落到内容中间，滑块的行程也会按错的长度算。
 * 量出来再写（两个 `getBoundingClientRect` 相减）最直接，也能容忍将来任何版式调整。
 */
function syncBarBox(state: State, el: HTMLElement): void {
  const bar = state.bar;
  if (!bar) return;
  const hostRect = state.host.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const style = bar.style;
  style.top = `${Math.round(rect.top - hostRect.top) + BAR_INSET_Y}px`;
  style.bottom = `${Math.round(hostRect.bottom - rect.bottom) + BAR_INSET_Y}px`;
  style.right = `${Math.round(hostRect.right - rect.right) + BAR_INSET_X}px`;
}

function update(state: State, el: HTMLElement): void {
  const { clientHeight, scrollHeight, scrollTop } = el;
  const metrics = thumbMetrics({
    clientSize: clientHeight,
    scrollSize: scrollHeight,
    scrollPos: scrollTop,
    minThumb: MIN_THUMB,
  });

  if (metrics.hidden) {
    // 内容装得下：藏起来即可（条本身留着，下次再滚动不用重建）
    state.bar?.classList.remove("is-on");
    return;
  }

  ensureBar(state, el);
  if (state.needsBox) {
    state.needsBox = false;
    syncBarBox(state, el);
  }

  state.thumbOffset = metrics.offset;
  if (state.thumb) {
    state.thumb.style.height = `${metrics.length}px`;
    state.thumb.style.transform = `translateY(${metrics.offset}px)`;
  }
}

/**
 * 把滑块放到目标偏移处：**只写 `scrollTop`，滑块位置一律由滚动事件反推**。
 * 两个来源（拖拽算出的位置与滚动位置）各写一次样式的话，一帧里就会互相拉据 ——
 * 而且拖到两端时“要求的滚动位置”与“实际能到的位置”也会不一致。
 */
function scrollToThumbOffset(el: HTMLElement, offset: number): void {
  el.scrollTop = scrollOffsetFromThumb(offset, {
    clientSize: el.clientHeight,
    scrollSize: el.scrollHeight,
    minThumb: MIN_THUMB,
  });
}

function onThumbPointerDown(state: State, event: PointerEvent): void {
  const thumb = state.thumb;
  if (!thumb) return;
  event.preventDefault();
  event.stopPropagation();
  state.dragging = true;
  state.dragStartY = event.clientY;
  state.dragStartOffset = state.thumbOffset;
  thumb.classList.add("is-dragging");
  // 指针已经不在了（极快的点按、触摸被系统接管）时这一步会抛，别让它把整段拖拽逻辑带走
  try {
    thumb.setPointerCapture(event.pointerId);
  } catch {
    // 拿不到捕获也能拖：只是指针移出滑块后可能丢事件
  }
  /**
   * 松手这件事**不能只靠滑块自己听**：捕获可能被浏览器丢掉（触控笔、系统手势、
   * 滑块被重渲染卸载），那时 `dragging` 永远挂着 —— 条再也不淡出、滑块还会跟着指针走。
   * 所以再挂一份窗口级兜底（OverlayScrollbars 的 `pointerup pointercancel lostpointercapture`
   * 三件套就是为这个，他们甚至专门修过触控笔提前丢捕获的 case）。
   * 两份监听同时到也无妨：`onThumbPointerUp` 自己判 `dragging`，是幂等的。
   */
  const endDrag = () => onThumbPointerUp(state);
  window.addEventListener("pointerup", endDrag, { once: true });
  window.addEventListener("pointercancel", endDrag, { once: true });
  show(state);
}

function onThumbPointerMove(state: State, el: HTMLElement, event: PointerEvent): void {
  if (!state.dragging) return;
  scrollToThumbOffset(el, state.dragStartOffset + (event.clientY - state.dragStartY));
}

function onThumbPointerUp(state: State): void {
  if (!state.dragging) return;
  state.dragging = false;
  state.thumb?.classList.remove("is-dragging");
  scheduleHide(state);
}

/** 点轨道空白处：直接跳到那个位置（原生“点一下翻一页”在浮层细条上不好按） */
function onBarPointerDown(state: State, el: HTMLElement, event: PointerEvent): void {
  const bar = state.bar;
  const thumb = state.thumb;
  if (!bar || !thumb || event.target !== bar) return;
  event.preventDefault();
  const rect = bar.getBoundingClientRect();
  const thumbLength = thumb.getBoundingClientRect().height;
  scrollToThumbOffset(el, event.clientY - rect.top - thumbLength / 2);
  show(state);
  scheduleHide(state);
}

export const vOverlayScroll: Directive<HTMLElement> = {
  mounted(el) {
    mountOverlayScroll(el);
  },

  unmounted(el) {
    unmountOverlayScroll(el);
  },
};

/**
 * 需要浮层滚动条的容器**按类名认**（v6.18）：这些类名本来就是我们页框/外壳的契约
 * （见 `开发约定` 的页框骨架），一处列清楚，别跑到七个个页面里各加一条指令。
 * 新增滚动容器时：把它的类名加到这里，或在模板上直接用 `v-overlay-scroll`。
 * （加上自动安装之后，**不需要**在模板里写指令。）
 */
const AUTO_TARGETS = [
  ".page-frame__scroll", // 页框里唯一的滚动区（音乐库 / 本地 / 收藏 / 最近 / 歌单 / 控制台两页）
  ".page-frame__fill", // 空态 / 加载中 / 读失败：窗口极矮时也能滚
  ".content", // 岛本身：设置页 / 概览这类没有页框的页面由它滚（有页框时它是 overflow: hidden，不会建条）
  ".sb-scroll", // 侧栏导航
  ".cs-nav", // 控制台左导航
  ".cs-main", // 控制台内容区（没有页框的页面由它滚）
  ".pl-picker__list", // 歌单“添加曲目”选择器
  ".q-list", // 播放队列浮层
  ".sm-card", // 曲目信息弹窗（它自己就是滚动容器）
];

/** 已经挂上的容器（卸载时只能靠它反查，WeakMap 不可遍历） */
const attached = new Set<HTMLElement>();

/**
 * 这个元素当下是不是真的在滚（计算样式里是 `overflow: auto|scroll`）。
 *
 * 判据刻意用**计算样式**而不是 `scrollHeight > clientHeight`：不可滚的容器
 * （例如 `overflow: hidden` 的岛）内容照样可能比盒子高，那样会把页框里那个
 * 真正的滚动区误判成“嵌在别人的滚动区里”而不给它挂条（v6.18 实测踩过）。
 */
function isScrollArea(el: Element): boolean {
  const { overflowY } = getComputedStyle(el);
  return overflowY === "auto" || overflowY === "scroll";
}

function mountOverlayScroll(el: HTMLElement): void {
  if (states.has(el)) return;
  const host = el.parentElement;
  if (!host) return;
  // 宿主本身住在**另一个真正的滚动区**里（例如页框里的空态块就住在滚动区里）：
  // 那条会跟着外层滚走、漂到别处 —— 这种嵌套容器不挂，让它用原生条
  // （它平时也多半装得下、不滚）。注意判据是“外层真的在滚”，不能只看有没有属性：
  // 岛（`.content`）在页框页面上也带属性，但它是 `overflow: hidden`。
  const outer = host.closest("[data-overlay-scroll]");
  if (outer && isScrollArea(outer)) return;

  el.setAttribute("data-overlay-scroll", "");
  host.setAttribute("data-overlay-scroll-host", "");

  const state: State = {
    host,
    bar: null,
    thumb: null,
    frame: 0,
    needsBox: true,
    hideTimer: 0,
    hovering: false,
    dragging: false,
    dragStartY: 0,
    dragStartOffset: 0,
    thumbOffset: 0,
    resizeObserver: null,
    mutationObserver: null,
    onScroll: () => {
      update(state, el);
      show(state);
      scheduleHide(state);
    },
  };
  states.set(el, state);
  attached.add(el);

  el.addEventListener("scroll", state.onScroll, { passive: true });

  // ① 视口尺寸变了（窗口缩放、侧栏折叠、抽屉开合）② 内容变了（列表加载 / 筛选 / 删歌）
  if (typeof ResizeObserver !== "undefined") {
    state.resizeObserver = new ResizeObserver(() => schedule(state, el, true));
    state.resizeObserver.observe(el);
  }
  if (typeof MutationObserver !== "undefined") {
    // 只盯子元素增删（不问属性与文本）：列表重渲染就是这个形状，悬浮、播放态都不白跑
    state.mutationObserver = new MutationObserver(() => schedule(state, el, true));
    state.mutationObserver.observe(el, { childList: true, subtree: true });
  }

  // 首次直接算（不走 rAF）：首帧就该在正确的位置上，而不是等用户滚一下才归位
  update(state, el);
}

function unmountOverlayScroll(el: HTMLElement): void {
  const state = states.get(el);
  if (!state) return;
  el.removeEventListener("scroll", state.onScroll);
  state.resizeObserver?.disconnect();
  state.mutationObserver?.disconnect();
  window.clearTimeout(state.hideTimer);
  if (state.frame) cancelAnimationFrame(state.frame);
  state.bar?.remove();
  el.removeAttribute("data-overlay-scroll");
  // 宿主属性只在没有别的实例还挂在同一个父元素上时才撤（一个宿主可能装两个滚动区）
  const stillUsed = [...attached].some((node) => node !== el && node.parentElement === state.host);
  if (!stillUsed) state.host.removeAttribute("data-overlay-scroll-host");
  states.delete(el);
  attached.delete(el);
}

/**
 * 自动安装（v6.18）：盯 `document.body` 的子元素增删，把 `AUTO_TARGETS` 里出现的容器挂上，
 * 已经脱离文档的容器卸掉。
 *
 * 为什么走自动而不是在模板里逐一写指令：滚动容器有十几个，而且**弹层里的那些**
 * （队列浮层、曲目信息弹窗）是 Teleport 出去后才出现的 —— 逐个写既啰嗦又容易漏。
 * 这一处清单是**唯一的挂载入口**，新增滚动容器只需把类名加进列表（或在模板上用指令）。
 */
export function installOverlayScrollAuto(): void {
  const selector = AUTO_TARGETS.join(",");

  const attachWithin = (root: Element): void => {
    if (root.matches(selector)) mountOverlayScroll(root as HTMLElement);
    for (const el of root.querySelectorAll(selector)) mountOverlayScroll(el as HTMLElement);
  };

  attachWithin(document.body);

  let pruneFrame = 0;
  const prune = (): void => {
    for (const el of attached) {
      if (!el.isConnected) unmountOverlayScroll(el);
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) attachWithin(node);
      }
    }
    // 卸载清理不必跟着每一次增删跑，合到下一帧即可
    if (!pruneFrame) {
      pruneFrame = requestAnimationFrame(() => {
        pruneFrame = 0;
        prune();
      });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
