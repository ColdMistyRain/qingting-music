<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { currentLineIndex, lineProgress, wordFillProgress, type LyricLine } from "@/utils/lyrics";

/**
 * 歌词滚动引擎（LR-04/05/06）—— 三布局**共享**，布局组件只决定它放在哪（VS-09）。
 *
 * 职责分工（不要往这里塞版式）：
 * - LR-04 景深：当前句主题色 + 放大，前后句缩小、降不透明度、加模糊，上下边缘渐隐（CSS）；
 * - LR-05 逐字填充：有逐字时间轴按字高亮；只有行级数据时整句自左向右渐亮（降级路径）；
 * - LR-06 点击行 seek + 当前句自动居中。
 * LR-07（手动滚动暂停自动居中 + 回到当前句按钮）是 P2，尚未做，见留白清单。
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
const activeWords = computed(() => (activeLine.value ? wordFillProgress(activeLine.value, props.time) : []));
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
  // 行的 offsetTop 是相对内层列表的：位移 = 行中线 - 窗口中线
  shift.value = line.offsetTop + line.offsetHeight / 2 - viewport.clientHeight / 2;
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
watch(() => props.lines, scheduleMeasure);

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
});
</script>

<template>
  <div ref="viewportRef" class="ly">
    <p v-if="lines.length === 0" class="ly-empty">暂无歌词</p>

    <div v-else class="ly-list" :style="{ transform: `translateY(${-shift}px)` }">
      <button
        v-for="(line, i) in lines"
        :key="`${line.time}-${i}`"
        :ref="(el) => setLineRef(el as Element | null, i)"
        type="button"
        class="lyline"
        :class="{ current: i === activeIndex, past: i < activeIndex }"
        :title="`跳转到 ${line.text}`"
        @click="emit('seek', line.time)"
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
</template>

<style scoped>
.ly {
  position: relative;
  overflow: hidden;
  min-width: 0;
  /* LR-04：上下边缘渐隐，让歌词"从雾里进出"而不是被硬切 */
  mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
}

.ly-list {
  /* 位移曲线：iOS 同款减速，句与句之间是"滑过去"而不是跳过去 */
  transition: transform 0.7s cubic-bezier(0.32, 0.72, 0, 1);
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
