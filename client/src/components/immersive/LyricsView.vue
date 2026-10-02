<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type VNodeRef } from "vue";
import IconArrowDown from "~icons/ph/arrow-down";
import {
  centerShift,
  clampManualShift,
  currentLineIndex,
  wordFillProgress,
  type LyricLine,
} from "@/utils/lyrics";
import { emphasisKeyframes, emphasisParams } from "@/utils/lyricEmphasis";
import { togglePointerCapture } from "@/utils/pointer";
import { POS_Y_SPRING_BASE, Spring, posYSpringParams } from "@/utils/spring";

/**
 * 歌词滚动引擎（LR-04/05/06）—— 三布局**共享**，布局组件只决定它放在哪（VS-09）。
 *
 * 职责分工（不要往这里塞版式）：
 * - LR-04 景深：当前句主题色 + 放大，前后句缩小、降不透明度、加模糊，上下边缘渐隐（CSS）；
 * - LR-05 逐字填充：有逐字时间轴按字高亮；只有行级数据时整句自左向右渐亮（降级路径）；
 * - LR-06 点击行 seek + 当前句自动居中；
 * - LR-07 手动滚动：滚轮 / 拖动暂停自动居中，无操作数秒后回位，并给一个“回到当前句”入口。
 */
const props = defineProps<{
  lines: LyricLine[];
  /** 当前播放时间（秒）。由父级用 rAF 采样注入：timeupdate 只有 ~4Hz，逐字填充会卡顿 */
  time: number;
}>();

const emit = defineEmits<{ seek: [seconds: number] }>();

const activeIndex = computed(() => currentLineIndex(props.lines, props.time));
const activeLine = computed(() => props.lines[activeIndex.value] ?? null);
/** 逐字填充进度（每个字 0~1） */
const activeWords = computed(() =>
  activeLine.value ? wordFillProgress(activeLine.value, props.time) : [],
);
/**
 * 与当前句的距离（行）：LR-04 的模糊强度按它递增（AMLL 的真实机制）。
 * 模板里写成 `--depth`，CSS 负责换算成 px——JS 只给“原始距离”，与取色管线同一原则。
 */
function depthOf(index: number): number {
  return Math.abs(index - activeIndex.value);
}

/* ---------- 逐帧重渲染收窄（v6.9） ----------
   `props.time` 每秒变 60 次，而模板里真正该跟着变的只有**当前那一行**的逐字进度。
   原先每帧都会：① 为每一行新建一个 `:ref` 箭头函数（Vue 每次都要 old(null)→new(el)
   地重设，即对全表 `Map.delete/set`）；② 每行重算一次 `depthOf(i)`；③ 整表重建 vnode。
   现在：ref 回调与 `--depth` 都预先算好（只在行数 / 当前句变化时重算），
   模板再靠 `v-memo` 把非当前行的子树原样复用。
   `depths` 必须进 memo 依赖：当前句一变，所有行的景深都跟着变（那是真需要重渲染的）。 */
const depths = computed(() => props.lines.map((_, index) => depthOf(index)));
const refSetters = computed<VNodeRef[]>(() =>
  props.lines.map((_, index) => (el) => setLineRef(el as Element | null, index)),
);
/**
 * `v-memo` 的第 4 个依赖：**只让当前行**在逐字进度变化时重渲染。
 *
 * 为什么必须有它（v6.19 实测踩到）：`v-memo` 的依赖里原本没有任何“每帧会变”的量，于是当前行整棵
 * 子树被原样复用 —— 逐字填充真的**一帧都不会更新**（实测：行级 `--p` 在同一句内冻在
 * 0.0078，换句才变）。别的行这个值恒为空串，不会被打扰。
 */
const fillKey = computed(() =>
  activeWords.value.length ? activeWords.value.map((v) => Math.round(v * 100)).join(",") : "",
);

/* ---------- 自动居中（LR-06）：把当前句挪到窗口垂直中线 ----------
   高量在 DOM 侧做（行高由字号 clamp 决定，写死在 CSS 里会漂），
   并观察**外层窗口**而不是被位移的内层列表——观察自己会被自己的 transform 触发
   （ScrollingText 踩过 ResizeObserver 死循环）。 */
const viewportRef = ref<HTMLElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
/** 自动居中的**目标**位移（px） */
const shift = ref(0);
/** 弹簧当前位置（模板用它写 transform），由 rAF 逐帧推进 */
const renderedShift = ref(0);
const lineEls = new Map<number, HTMLElement>();
/** 减少动态效果：不做弹簧，直接落位（VS-07） */
const reduceMotion = ref(false);

function setLineRef(el: Element | null, index: number): void {
  if (el instanceof HTMLElement) lineEls.set(index, el);
  else lineEls.delete(index);
}

/* ---------- 弹簧（按公式自行实现，见 `utils/spring.ts`） ----------
   CSS 过渡是固定曲线，句与句之间只能“滑过去”；弹簧从**当前位置与当前速度**续算，
   中途改目标不会顿一下，句子间隔短时还会自然带一点过冲——这是它比过渡“活”的原因。 */
const spring = new Spring(0, POS_Y_SPRING_BASE);
let rafId = 0;
let lastTs = 0;

function stopSpring(): void {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  lastTs = 0;
}

function tickSpring(ts: number): void {
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
  lastTs = ts;
  spring.update(dt);
  renderedShift.value = spring.position;
  if (spring.moving) rafId = requestAnimationFrame(tickSpring);
  else stopSpring();
}

/** 页面不可见时 rAF 不推进（实测坑）：此时直接落位，免得回来时还停在旧位置 */
function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState !== "visible";
}

/** 当前句与上一句的时间差（秒）：弹簧据此取弹力；首句拿不到就返回 undefined */
function intervalOf(index: number): number | undefined {
  const prev = props.lines[index - 1];
  const current = props.lines[index];
  return prev && current ? Math.max(current.time - prev.time, 0) : undefined;
}

/** 让弹簧去追新目标（`seeking` 用慢速参数，跳转别甩） */
function driveTo(target: number, seeking = false): void {
  if (reduceMotion.value || pageHidden()) {
    stopSpring();
    spring.snap(target);
    renderedShift.value = target;
    return;
  }
  spring.setParams(posYSpringParams({ seeking, intervalSeconds: intervalOf(activeIndex.value) }));
  spring.setTarget(target);
  if (!rafId) rafId = requestAnimationFrame(tickSpring);
}

/** 手动位移立即生效（不经过弹簧），同时把弹簧同步到同一位置 */
function applyManual(value: number): void {
  manualShift.value = clampManualShift(value, maxShift.value);
  stopSpring();
  spring.snap(manualShift.value);
  renderedShift.value = manualShift.value;
}

function measure(seeking = false): void {
  const viewport = viewportRef.value;
  const list = listRef.value;
  const line = lineEls.get(activeIndex.value);
  if (!viewport || !line) {
    shift.value = 0;
    driveTo(0);
    return;
  }
  const viewH = viewport.clientHeight;
  /* 列表两端留白（v4.83 需求方圈图定稿）：
     - **上端不留**：第一句紧贴标题（此前为了把当前句推出渐隐带在顶端垫了 57px，
       结果标题与第一句之间凭空多出一条空当）；
     - **下端留半屏**：末句也要能挪到中线（AMLL 的做法是每句都对齐同一条锦线、
       首末句不特殊对待），末句走到中线正好需要视图下半屏的空间。 */
  const padBottom = Math.round(viewH / 2);
  if (list) {
    list.style.paddingTop = "0px";
    list.style.paddingBottom = `${padBottom}px`;
  }
  // 行的 offsetTop 是相对外层窗口的（.ly 是最近的定位祖先）：位移 = 行中线 − 窗口中线
  const desired = line.offsetTop + line.offsetHeight / 2 - viewH / 2;
  /* **上端必须夹住**：整首歌刚开头时把第一行推到中线，上面会空出一大片（需求方实拍
     “隔太远”）；下端不夹——末句要能到中线，靠上面那块下留白提供行程。 */
  const last = lineEls.get(props.lines.length - 1);
  /* 可上移的上限：让**末句中心**刚好挪到中线为止——列表下留白就是半屏，正好当它的行程。
     不能用“内容总高 − 窗口高”：末句到中线时，内容（含下留白）往往还比窗口矮，
     那样算出来的上限是 0，整个列表就永远不动（v4.86 实测踩到：自动居中与手动滚动一起废）。 */
  const lastCenter = last ? last.offsetTop + last.offsetHeight / 2 : 0;
  maxShift.value = Math.max(0, lastCenter - viewH / 2);
  const target = centerShift(desired, maxShift.value);
  shift.value = target;
  driveTo(target, seeking);
  // 手动浏览中如果窗口尺寸变了，把手动位移也夹进新范围
  manualShift.value = clampManualShift(manualShift.value, maxShift.value);
}

/** 顶部渐隐带：默认 0（贴顶时不能淡，否则当前句被压暗）；锦线正常时才开，而且只给 8%
    （AMLL 自己已按距离把已唱句退得够远，宽渐隐带会让上半部分的过渡看着“硬”） */
const fadeTop = computed(() => (shift.value > 0 ? "8%" : "0%"));

/* 合并多次请求，但**不用 rAF**：rAF 在页面不可见（后台标签页、未聚焦窗口）时完全不触发，
   而读取 offsetTop/clientHeight 并不需要等绘制，nextTick 就够（DOM 已更新，读时同步算布局）。
   实测：用 rAF 时隐藏页里切歌/点击跳转都不会居中。 */
let pending = false;
/** 跳转（点歌词行 / 拖进度条）会让当前句一次跨好几行，据此换用慢速弹簧 */
let pendingSeeking = false;
function scheduleMeasure(seeking = false): void {
  pendingSeeking = pendingSeeking || seeking;
  if (pending) return;
  pending = true;
  void nextTick(() => {
    pending = false;
    const useSlow = pendingSeeking;
    pendingSeeking = false;
    measure(useSlow);
  });
}

watch(activeIndex, (now, before) => scheduleMeasure(Math.abs(now - before) > 1));
// 换歌/换歌词：手动浏览的位置对新歌没有意义，直接回到自动居中
watch(
  () => props.lines,
  () => {
    if (manual.value) resume();
    else scheduleMeasure();
  },
);

/* ---------- 手动滚动（LR-07） ----------
   列表不是原生滚动容器（它是用 transform 位移的），所以滚轮与拖动都是自己接管：
   累加到 manualShift 上，一旦动过就不再跟随当前句，直到用户自己回位或数秒无操作。 */
/** 无操作多久后自动回到当前句（需求：“数秒无操作后恢复”） */
const RESUME_DELAY_MS = 6000;
/** 拖动超过这个距离就算“滑动”，不再触发点击跳转（否则滑一下就把歌跳走了） */
const DRAG_THRESHOLD_PX = 6;
/** 键盘滚动的步长（视窗高的比例）：↑/↓ 走一行左右，PgUp/PgDn 走一屏左右 */
const KEY_STEP_RATIO = 0.12;
const KEY_PAGE_RATIO = 0.8;

const manual = ref(false);
const manualShift = ref(0);
const dragging = ref(false);
/** 可滚动的最大位移：由 measure() 更新，滚轮/拖动的夹取都用它 */
const maxShift = ref(0);
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let dragStartY = 0;
let dragStartShift = 0;
let dragged = false;
/**
 * 按下的那一行（-1 = 没按在行上；`pointerup` 时用它收尾一次点击）。
 *
 * ⚠️ 必须在 `pointerdown` 里就把行号记下来：`setPointerCapture` 会把后续指针事件（含
 * `pointerup`）**重定向到列表**，浏览器据此把随后的 `click` 派发给“按下与起两个目标的
 * 最近公共祖先”—— 也就是列表本身，**行按钮上的 `@click` 永远不会触发**。
 * （v6.19 需求方报的“点击歌词不跳转”，实测事件落点：`pointerdown: lyline` /
 * `pointerup: ly-list` / `click: ly-list`。）所以“点一下跳过去”改由 `pointerup` 自己收尾，
 * `@click` 只留给键盘（Enter / Space）与读屏。
 */
let pressedIndex = -1;
/** 刚刚从 `pointerup` 收尾过一次点击（给 `@click` 去重；同一行 400ms 内只跳一次） */
let lastSeek: { index: number; at: number } = { index: -1, at: 0 };

/** 手动浏览时用 manualShift，否则用弹簧渲染出来的位置 */
const displayShift = computed(() => (manual.value ? manualShift.value : renderedShift.value));

/** 进入手动浏览：从**当前显示的位置**接着走（不跳），并重置回位倒计时 */
function beginManual(): void {
  if (!manual.value) {
    manual.value = true;
    manualShift.value = renderedShift.value;
  }
  scheduleResume();
}

/** 重新计时（不改变手动状态） */
function scheduleResume(): void {
  if (resumeTimer !== null) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(resume, RESUME_DELAY_MS);
}

/**
 * 指针停在“回到当前句”上时暂停回位。
 * 不加这条的实测表现是很难受：倒计时到点时按钮会在你鼠标伸过去的路上直接消失（连点都点不到）。
 */
function holdResume(): void {
  if (resumeTimer !== null) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}

/** 回到当前句（按钮与倒计时都走这里） */
function resume(): void {
  if (resumeTimer !== null) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
  manual.value = false;
  manualShift.value = 0;
  // 手动期间当前句可能已经换了好几行，回位要按**现在**的当前句重新算
  scheduleMeasure();
}

function onWheel(event: WheelEvent): void {
  // 触控板捏合缩放（ctrl+wheel）不接管，否则会把页面缩放呑掉
  if (event.ctrlKey) return;
  if (maxShift.value <= 0) return;
  event.preventDefault();
  beginManual();
  applyManual(manualShift.value + event.deltaY);
}
/**
 * 键盘滚动（LR-07，v4.87）。只在本区获得焦点时才接管，并 **stopPropagation**：
 * 全局的 ↑/↓ 是调音量（PL-08），焦点在歌词上时用户想要的是“翻歌词”——
 * 不拦住向上冒泡的话，一下会既滚歌词又调音量。
 */
function onKeydown(event: KeyboardEvent): void {
  const viewH = viewportRef.value?.clientHeight ?? 0;
  const step = Math.max(24, viewH * KEY_STEP_RATIO);
  const page = Math.max(step, viewH * KEY_PAGE_RATIO);
  let target: number | null = null;

  if (event.key === "ArrowUp") target = displayShift.value - step;
  else if (event.key === "ArrowDown") target = displayShift.value + step;
  else if (event.key === "PageUp") target = displayShift.value - page;
  else if (event.key === "PageDown") target = displayShift.value + page;
  else if (event.key === "Home") target = 0;
  else if (event.key === "End") target = maxShift.value;
  if (target === null) return;

  event.preventDefault();
  event.stopPropagation();
  beginManual();
  applyManual(target);
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging.value = true;
  dragged = false;
  pressedIndex = lineIndexOf(event.target);
  dragStartY = event.clientY;
  dragStartShift = displayShift.value;
  // 捕获/释放都会动到指针，而它们**可能抛**（指针已经不在了 / 被系统收走）：
  // 不能让它把后半段逻辑带走（`onPointerUp` 里释放排在“跳转”前面，一抛就白点一下）
  // —— 共用入口 `utils/pointer.ts` 里包了 try/catch，四处拖动都走它。
  togglePointerCapture(event.currentTarget as HTMLElement, event.pointerId, true);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const dy = event.clientY - dragStartY;
  if (!dragged && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
  dragged = true;
  beginManual();
  // 手往下拉 = 想看后面的歌词，所以列表要向上走（位移取反）
  applyManual(dragStartShift - dy);
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  togglePointerCapture(event.currentTarget as HTMLElement, event.pointerId, false);
  const index = pressedIndex;
  const wasDrag = dragged;
  pressedIndex = -1;
  dragged = false;
  // 没滑动 = 一次点击：**在这里收尾**（见 pressedIndex 的注释），不等那个永远等不到的 click
  if (!wasDrag && index >= 0) seekToLine(index);
}

/**
 * 浏览器把这次触摸收走（判成了滚动/手势）时只结束拖动，**不当成点击**。
 *
 * 这条很重要（v6.22）：真机上手指一动，浏览器就可能发 `pointercancel`（而我们的
 * `pointermove` 一次都没收到），此时 `dragged` 还是 false —— 如果沿用 `onPointerUp`，
 * “想滑歌词”就变成“跳到手指下那一句”，比滑不动更难受。
 */
function onPointerCancel(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  pressedIndex = -1;
  dragged = false;
  togglePointerCapture(event.currentTarget as HTMLElement, event.pointerId, false);
}

/** 事件目标落在哪一行（行下标；不在行上就 -1） */
function lineIndexOf(target: EventTarget | null): number {
  if (!(target instanceof Element)) return -1;
  const raw = (target.closest(".lyline") as HTMLElement | null)?.dataset.index;
  const index = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(index) ? index : -1;
}

/** 跳到某一行的起点（LR-06） */
function seekToLine(index: number): void {
  const line = props.lines[index];
  if (!line) return;
  lastSeek = { index, at: performance.now() };
  emit("seek", line.time);
  // 手动浏览中点某一行 = “就听这里”，于是退出手动、回到自动居中（LR-07）
  if (manual.value) resume();
}

/** LR-06 点击跳转；指针那条已在 `pointerup` 收尾，这条路留给键盘（Enter / Space）与读屏 */
function onLineClick(line: LyricLine): void {
  const index = props.lines.indexOf(line);
  // 有的浏览器仍然会把 click 派给按钮（此时指针那条已经跳过一次了）：同一行 400ms 内只跳一次
  if (index === lastSeek.index && performance.now() - lastSeek.at < 400) return;
  if (index >= 0) seekToLine(index);
}

/* ---------- 逐字"瞬时辉光爆发"（LR-05 强调，v4.86） ----------
   某个字刚唱完时跑一次一次性的关键帧动画（参数与关键帧在 `utils/lyricEmphasis.ts`）：
   常驻的 `.done` 辉光负责"唱过的字一直亮着"，爆发负责"刚亮起来"那一下。 */
let lastWordProgress: number[] = [];
let lastBurstTime = 0;

function burstCompletedWords(): void {
  const words = activeWords.value;
  const previous = lastWordProgress;
  lastWordProgress = [...words];
  const jumped = Math.abs(props.time - lastBurstTime) > 0.5;
  lastBurstTime = props.time;
  if (reduceMotion.value || jumped || words.length === 0) return;

  // 先算谁刚唱完，再去查 DOM——这个回调每秒要跑几十次，不要每次去戳布局
  const completed = words
    .map((progress, index) => (progress >= 1 && (previous[index] ?? 0) < 1 ? index : -1))
    .filter((index) => index >= 0);
  if (completed.length === 0) return;

  const chars = listRef.value?.querySelectorAll<HTMLElement>(".lyline.current .ch");
  const line = props.lines[activeIndex.value];
  if (!chars?.length) return;

  for (const index of completed) {
    const el = chars[index];
    if (!el || typeof el.animate !== "function") continue;
    const params = emphasisParams({
      durationSeconds: line?.words?.[index]?.duration ?? 0,
      charCount: words.length,
      isLastWord: index === words.length - 1,
    });
    el.animate(emphasisKeyframes({ charIndex: index, charCount: words.length, params }), {
      duration: params.durationMs,
      // 峰形已在关键帧里（`emphasisProfile`），这里用线性，别再叠一条缓动
      easing: "linear",
      fill: "none",
    });
  }
}

watch(activeWords, burstCompletedWords, { flush: "post" });
// 换句：进度的“上一帧”对新句没有意义（否则新句第一个字会被当成“刚唱完”而白闪一下）
watch(activeIndex, () => {
  lastWordProgress = [];
});

let observer: ResizeObserver | null = null;
onMounted(() => {
  reduceMotion.value = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  scheduleMeasure();
  if (typeof ResizeObserver !== "undefined" && viewportRef.value) {
    // 不能直接把 scheduleMeasure 交给 ResizeObserver：它的第一个参数是 entries，
    // 会被当成 “seeking=true”（于是每次窗口尺寸变化都走慢速弹簧）
    observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(viewportRef.value);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  stopSpring();
  if (resumeTimer !== null) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
});
</script>

<template>
  <!-- 两层结构：`.ly` 只负责定位（布局给高度）并承载回位按钮，
       `.ly-view` 才是“视窗”（负责上下渐隐遮罩与裁剪）——
       遮罩必须只罩歌词，否则底部的回位按钮会被一起淡掉（实测踩过）。 -->
  <div class="ly" @wheel="onWheel">
    <div
      ref="viewportRef"
      class="ly-view"
      tabindex="0"
      role="group"
      aria-label="歌词（可用方向键 / PageUp / PageDown 翻动，点行跳转）"
      :style="{ '--ly-fade-top': fadeTop }"
      @keydown="onKeydown"
    >
      <p v-if="lines.length === 0" class="ly-empty">暂无歌词</p>

      <div
        v-else
        ref="listRef"
        class="ly-list"
        :style="{ transform: `translateY(${-displayShift}px)` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
      >
        <button
          v-for="(line, i) in lines"
          :key="`${line.time}-${i}`"
          v-memo="[i === activeIndex, i < activeIndex, depths[i], i === activeIndex ? fillKey : '']"
          :ref="refSetters[i]"
          type="button"
          class="lyline"
          :data-index="i"
          :class="{ current: i === activeIndex, past: i < activeIndex }"
          :style="{ '--depth': depths[i] }"
          :title="`跳转到 ${line.text}`"
          @click="onLineClick(line)"
        >
          <!-- 逐字（LR-05）：字级高亮，做完的字带一点主题色辉光 -->
          <template v-if="i === activeIndex && line.words?.length">
            <span
              v-for="(word, wi) in line.words"
              :key="wi"
              class="ch"
              :class="{ done: (activeWords[wi] ?? 0) >= 1 }"
              >{{ word.text }}</span
            >
          </template>
          <!-- 只有行级时间（普通 LRC）：**不做伪逐字**，整行高亮交给 `.lyline.current`（LR-04）。
               LRC 里没有字级时间，“自左向右渐亮”只能编一个速度出来（需求方 v6.19：
               “我们目前的歌词都是普通的 lrc 格式…参照设计应该降级到逐行高亮”）。 -->
          <span v-else class="txt">{{ line.text }}</span>
        </button>
      </div>
    </div>

    <!-- LR-07：手动浏览时给一个明确的回位入口（自动回位要等 6 秒，用户不该被迫等） -->
    <Transition name="ly-resume">
      <button
        v-if="manual"
        class="ly-resume"
        type="button"
        @pointerenter="holdResume"
        @pointerleave="scheduleResume"
        @focus="holdResume"
        @blur="scheduleResume"
        @click="resume"
      >
        <IconArrowDown class="icon" />
        回到当前句
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.ly {
  /* 外壳：只负责定位（高度出布局给）并承载回位按钮 */
  position: relative;
  min-width: 0;
}

/* 视窗：负责上下渐隐与裁剪。**遮罩只在这里**——放到外层就会把回位按钮一起淡掉 */
.ly-view {
  position: relative;
  height: 100%;
  /* 自己处理拖动，所以必须声明 `touch-action`（v6.22 修“手机上滑不动歌词”）：
     歌词列表不是原生滚动容器（位移由弹簧写 transform），不写这条时真机上的纵向拖拽
     会被浏览器判成“它自己要滚动页面”而接管 —— 后果是**我们一个 `pointermove` 都收不到**
     （直接收到 `pointercancel`），列表就怎么拽都不动；桌面用鼠标没这回事，所以只在手机上显。
     仓内同一先例：播放条的 `.pb-left`（滑动切歌手势区）写着 `touch-action: pan-y`。
     这里两轴都归我们：横向在歌词区本来就没有手势（页面级滑切歌把手势区排除在外）。 */
  touch-action: none;
  /* 裁剪框**左右各外扩一截**（负外边距 + 等量内边距，内容位置分毫不动）：
     行有景深模糊（blur 1.1~3.3px），模糊出来的灰边本来是软的；裁剪边界正好压在文字左端时
     那圈软边会被齐着切掉。实测这点差别只有 ~2px（A/B 探针截图对比过），肉眼几乎看不出，
     属于预防性处理：**带模糊/发光的内容配 overflow 裁剪时，裁剪框要比内容宽出一圈**。
     （需求方说的“歌词左边没有过渡”不是它——见 v4.88 的定案。） */
  --ly-bleed-x: 24px;
  margin-inline: calc(-1 * var(--ly-bleed-x));
  padding-inline: var(--ly-bleed-x);
  overflow: hidden;
  /* 上下渐隐带（LR-04：让歌词"从雾里进出"而不是被硬切）。**上缘那一条按需开关**
     （`--ly-fade-top` 由 JS 写）：列表没被推起时，顶上本来就没有正在离场的行，
     开着它只会把贴顶的当前句也压暗（v4.82/4.83 两轮实测）；而铺开了也只给 8%
     ——已唱句本身已被按距离退远，宽渐隐带反而让上半部分显得“硬”（v4.85）。 */
  --ly-fade: 14%;
  --ly-fade-top: 0%;
  mask-image: linear-gradient(
    to bottom,
    transparent,
    #000 var(--ly-fade-top),
    #000 calc(100% - var(--ly-fade)),
    transparent
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent,
    #000 var(--ly-fade-top),
    #000 calc(100% - var(--ly-fade)),
    transparent
  );
}

/* 歌词区可聚焦（LR-07 键盘滚动）：默认轮廓去掉，键盘操作时才给一圈主题色焦点环 */
.ly-view {
  outline: none;
}

.ly-view:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
  outline-offset: 6px;
  border-radius: 14px;
}

/* 列表位移不用 CSS 过渡，改由**弹簧**逐帧推（JS 写 transform）。
   过渡是固定曲线，只能“滑过去”；弹簧从当前位置与速度续算，句子间隔短时自然带一点
   过冲，跳转时换慢速参数也不会甩——这些过渡都做不到（v4.85 移植、v4.86 改为自研实现）。 */
.ly-list {
  will-change: transform;
  /* 列内横向留白：与标题共用 --im-text-pad-x，保证整条文字列只有一条左边界（v4.88）。
     注意 measure() 会写内联的 padding-top/bottom（自动居中的行程），不冲突。 */
  padding-inline: var(--im-text-pad-x);
}

/* ---------- LR-07：手动浏览时的“回到当前句” ----------
   浮在歌词之上的一小块，所以走浮层材质（chrome），不是岛内卡片。 */
.ly-resume {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 99px;
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--panel-shadow);
  color: var(--text-2);
  font-size: 12.5px;
  transition: color 0.15s;
}

.ly-resume:hover {
  color: var(--text-1);
}

.ly-resume .icon {
  width: 14px;
  height: 14px;
}

.ly-resume-enter-active,
.ly-resume-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}

.ly-resume-enter-from,
.ly-resume-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}

.ly-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-3);
  font-size: 13.5px;
}

.lyline {
  display: block;
  width: 100%;
  padding: 7px 0;
  text-align: left;
  font-size: clamp(17px, 2.4vh, 28px);
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-3);
  /* LR-04 景深：模糊**按离当前句的距离递增**（不是所有非当前句一个固定值）——
     这是 AMLL 的真实机制（`resolveBlurLevel` = 1 + 距离，上限 5px，窄视口 ×0.8），
     远景才真的有纵深。距离由模板写成 `--depth`，夹到 3 档免得远处糊成一团。
     另外两层景深跟着走：缩小（0.965，AMLL 的 SCALE_ASPECT=97）与降不透明度。 */
  filter: blur(calc(min(var(--depth, 1), 3) * 1.1px));
  opacity: 0.5;
  transform: scale(0.965);
  transform-origin: left center;
  transition:
    opacity 0.45s,
    transform 0.45s,
    filter 0.45s,
    color 0.3s;
}

.lyline.past {
  opacity: 0.58;
}

/* 悬浮的句取消模糊：LR-06 是点击跳转，先看得清才点得下去（AMLL 同做法：
   `:hover .lyricLine { filter: unset !important }`） */
.lyline:hover {
  opacity: 0.75;
  filter: none;
}

.lyline.current {
  color: var(--accent);
  font-size: clamp(21px, 3.4vh, 38px);
  filter: blur(0);
  opacity: 1;
  transform: scale(1);
  cursor: default;
}

/* 逐字（LR-05）：未唱到的字压暗，唱到的字亮起 + 辉光（Apple Music 的标志性效果） */
.lyline .ch {
  opacity: 0.34;
  transition: opacity 0.18s;
}

.lyline .ch.done {
  opacity: 1;
  text-shadow:
    0 0 18px var(--accent-soft),
    0 0 6px var(--accent-soft);
}

/* 行级歌词不做“自左向右渐亮”（v6.19 拆掉）：LRC 没有字级时间，那层填充只能编一个
   速度出来（“参照设计应该降级到逐行高亮”）；整行高亮本身由 `.lyline.current` 给。 */

@media (prefers-reduced-motion: reduce) {
  .ly-list,
  .lyline,
  .lyline .ch {
    transition: none;
  }
  .lyline {
    filter: none;
    transform: none;
  }
}

/* 矮屏（v6.15，需求方对着 iPhone SE 375×667 的截图：“歌词会卡到进度条下面……
   歌词字体再小点”）：矮屏上能放的行数本来就少，字号收一档 ——
   上下文句与当前句都小一档，一屏里看得见的话更多，当前句也不再顶到窗口边缘。
   只按**高度**判（375 宽的屏一屏比一屏高，宽窄不是这里的病因；横屏手机也会落进来）。 */
@media (max-height: 700px) {
  .lyline {
    font-size: clamp(15px, 2.1vh, 24px);
  }

  .lyline.current {
    font-size: clamp(19px, 2.9vh, 30px);
  }
}
</style>
