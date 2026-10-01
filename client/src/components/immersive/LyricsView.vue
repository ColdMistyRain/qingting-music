<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import IconArrowDown from "~icons/ph/arrow-down";
import {
  centerShift,
  clampManualShift,
  currentLineIndex,
  lineProgress,
  wordFillProgress,
  type LyricLine,
} from "@/utils/lyrics";

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
/** 行级进度（0~1）：仅行级数据时的整句渐亮 */
const activeRatio = computed(() => lineProgress(props.lines, activeIndex.value, props.time));

/* ---------- 自动居中（LR-06）：把当前句挪到窗口垂直中线 ----------
   高量在 DOM 侧做（行高由字号 clamp 决定，写死在 CSS 里会漂），
   并观察**外层窗口**而不是被位移的内层列表——观察自己会被自己的 transform 触发
   （ScrollingText 踩过 ResizeObserver 死循环）。 */
const viewportRef = ref<HTMLElement | null>(null);
const shift = ref(0);
const lineEls = new Map<number, HTMLElement>();

function setLineRef(el: Element | null, index: number): void {
  if (el instanceof HTMLElement) lineEls.set(index, el);
  else lineEls.delete(index);
}

function measure(): void {
  const viewport = viewportRef.value;
  const line = lineEls.get(activeIndex.value);
  if (!viewport || !line) {
    shift.value = 0;
    return;
  }
  // 行的 offsetTop 是相对外层窗口的（.ly 是最近的定位祖先）：位移 = 行中线 - 窗口中线
  const desired = line.offsetTop + line.offsetHeight / 2 - viewport.clientHeight / 2;
  // **必须夹住**：整首歌刚开头时把第一行推到中线，上面会空出一大片（需求方实拍指出
  // “隔太远”）；末尾同理会把列表推过头、下面留白。夹取规则在纯函数里（有单测）。
  const last = lineEls.get(props.lines.length - 1);
  const listHeight = last ? last.offsetTop + last.offsetHeight : 0;
  maxShift.value = Math.max(0, listHeight - viewport.clientHeight);
  shift.value = centerShift(desired, listHeight, viewport.clientHeight);
  // 手动浏览中如果窗口尺寸变了，把手动位移也夹进新范围
  manualShift.value = clampManualShift(manualShift.value, maxShift.value);
}

/* 合并多次请求，但**不用 rAF**：rAF 在页面不可见（后台标签页、未聚焦窗口）时完全不触发，
   而读取 offsetTop/clientHeight 并不需要等绘制，nextTick 就够（DOM 已更新，读时同步算布局）。
   实测：用 rAF 时隐藏页里切歌/点击跳转都不会居中。 */
let pending = false;
function scheduleMeasure(): void {
  if (pending) return;
  pending = true;
  void nextTick(() => {
    pending = false;
    measure();
  });
}

watch(activeIndex, scheduleMeasure);
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

const manual = ref(false);
const manualShift = ref(0);
const dragging = ref(false);
/** 可滚动的最大位移：由 measure() 更新，滚轮/拖动的夹取都用它 */
const maxShift = ref(0);
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
let dragStartY = 0;
let dragStartShift = 0;
let dragged = false;

/** 手动浏览时用 manualShift，否则用自动居中算出来的 shift */
const displayShift = computed(() => (manual.value ? manualShift.value : shift.value));

/** 进入手动浏览：从**当前显示的位置**接着走（不跳），并重置回位倒计时 */
function beginManual(): void {
  if (!manual.value) {
    manual.value = true;
    manualShift.value = shift.value;
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
  manualShift.value = clampManualShift(manualShift.value + event.deltaY, maxShift.value);
}

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  dragging.value = true;
  dragged = false;
  dragStartY = event.clientY;
  dragStartShift = displayShift.value;
  // 捕获指针：拖到窗口外再松手也收得到 pointerup（否则会一直停在“拖动中”）
  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  const dy = event.clientY - dragStartY;
  if (!dragged && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
  dragged = true;
  beginManual();
  // 手往下拉 = 想看后面的歌词，所以列表要向上走（位移取反）
  manualShift.value = clampManualShift(dragStartShift - dy, maxShift.value);
}

function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
}

/** LR-06 点击跳转；但如果是滑动收尾就不当点击（滑一下歌就跳走了很难受） */
function onLineClick(line: LyricLine): void {
  if (dragged) {
    dragged = false;
    return;
  }
  emit("seek", line.time);
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  scheduleMeasure();
  if (typeof ResizeObserver !== "undefined" && viewportRef.value) {
    observer = new ResizeObserver(scheduleMeasure);
    observer.observe(viewportRef.value);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
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
    <div ref="viewportRef" class="ly-view">
      <p v-if="lines.length === 0" class="ly-empty">暂无歌词</p>

      <div
        v-else
        class="ly-list"
        :class="{ 'is-manual': manual, 'is-dragging': dragging }"
        :style="{ transform: `translateY(${-displayShift}px)` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <button
          v-for="(line, i) in lines"
          :key="`${line.time}-${i}`"
          :ref="(el) => setLineRef(el as Element | null, i)"
          type="button"
          class="lyline"
          :class="{ current: i === activeIndex, past: i < activeIndex }"
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
          <!-- 仅行级数据：整句自左向右渐亮（LR-05 降级路径） -->
          <span
            v-else
            class="txt"
            :class="{ fill: i === activeIndex }"
            :style="i === activeIndex ? { '--p': activeRatio } : undefined"
            >{{ line.text }}</span
          >
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
  overflow: hidden;
  /* LR-04：上下边缘渐隐，让歌词"从雾里进出"而不是被硬切 */
  mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
}

.ly-list {
  /* 位移曲线：iOS 同款减速，句与句之间是"滑过去"而不是跳过去 */
  transition: transform 0.7s cubic-bezier(0.32, 0.72, 0, 1);
}

/* LR-07：手动滚动时不能再等 0.7s——滚轮要跟手，拖动更要完全免过渡 */
.ly-list.is-manual {
  transition-duration: 0.16s;
}

.ly-list.is-dragging {
  transition: none;
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
  /* LR-04 景深：非当前句模糊 + 缩小 + 降不透明度，三层叠加才有"离焦"感 */
  filter: blur(1.7px);
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
  filter: blur(1px);
  opacity: 0.58;
}

.lyline:hover {
  opacity: 0.75;
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

/* 行级降级（LR-05）：自左向右渐亮。用 background-clip 才能做"半个字"的连续填充。
   未唱部分用 --text-2 而不是 --text-3：当前句必须比相邻句更亮（LR-04），
   用 text-3 会出现"当前句反而最暗"（自评时发现）。 */
.lyline .txt.fill {
  background: linear-gradient(to right, var(--accent) calc(var(--p, 1) * 100%), var(--text-2) 0);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

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
</style>
