<script setup lang="ts">
/**
 * 歌词播放（LR-04/05/06/07）—— 三布局共享，v4.84 起渲染与动效**整套交给 AMLL**
 * （`@applemusic-like-lyrics/core` + Vue 绑定，AGPL-3.0）。
 *
 * 为什么不自己写了（v4.84 需求方定案）：本项目不商用、后续开源，AGPL 的传染性不构成障碍；
 * 换来的是物理弹簧、逐字渐变遮罩、按距离模糊、滚轮/拖动与自动回位这一整套已经调好的
 * 效果，观感与 Apple Music 一致（自研版只是"按机制模仿"，v4.82 已核过源码）。
 *
 * 这里只保留四件事，其余都交给它：
 * 1. **歌词数据**：仍用 `utils/lyrics.ts` 解析 LRC/yrc（offset、多标签、逐字判定与那批
 *    单测都不动），再经 `utils/amllLyrics.ts` 转成 AMLL 的毫秒格式；
 * 2. **视窗外壳与渐隐**：`.ly`（定位 + 回位按钮）/ `.ly-view`（上下渐隐 + 裁剪）——
 *    遮罩只罩歌词，不能罩到悬浮控件（v4.79 教训）；
 * 3. **主题映射**：AMLL 用自己的 CSS 变量取色，这里把我们的令牌映射过去，别出现第二套视觉语言；
 * 4. **LR-07 的显式回位入口**：AMLL 自带滚轮/拖动与"滚轮停手 + 切下一句后自动回位"，我们只补按钮。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { LyricPlayer } from "@applemusic-like-lyrics/vue";
import "@applemusic-like-lyrics/core/style.css";
import IconArrowDown from "~icons/ph/arrow-down";
import { toAmllLines } from "@/utils/amllLyrics";
import { currentLineIndex, type LyricLine } from "@/utils/lyrics";

const props = defineProps<{
  lines: LyricLine[];
  /** 当前播放时间（秒）。由父级用 rAF 采样注入：timeupdate 只有 ~4Hz，逐字填充会卡顿 */
  time: number;
}>();

const emit = defineEmits<{ seek: [seconds: number] }>();

/** 标准锚线：AMLL 把**当前句的中线**对齐到视窗高度的这个比例；首末句一视同仁（它不做两端夹取） */
const BASE_ALIGN = 0.5;
/** 估算行高（px）：只用于开头几句的"贴顶"估算——AMLL 自己也用 `containerHeight / 5` 估算未测量的行 */
const EST_LINE_HEIGHT = 46;

const activeIndex = computed(() => currentLineIndex(props.lines, props.time));
const amllLines = computed(() => toAmllLines(props.lines));
/** 秒 → 毫秒整数（AMLL 明确要求整数，小数会让内部帧判定抖） */
const currentMs = computed(() => Math.max(0, Math.round(props.time * 1000)));

const viewRef = ref<HTMLElement | null>(null);
const viewH = ref(0);
let observer: ResizeObserver | null = null;

/**
 * 锚线 —— **唯一一处有意不照搬 AMLL 的地方**（理由见 PRD v4.84）：
 * AMLL 的模型是"每句都对齐同一条锚线"，它不做两端夹取；歌开头上面没有已唱句可填，
 * 于是标题与第一句之间会留一大片空白（在它的版式里那片空白长着封面与标题）。
 * 我们的标题块在歌词区**上方**，那片空白是纯浪费（需求方 v4.83 圈图指出）。
 * 所以：开头几句把锚线压到"该句贴顶"的位置（等价于 v4.83 的顶部夹取），
 * 攒够已唱句后自然回到 `BASE_ALIGN`。首句、末句仍然一视同仁地走同一套公式，
 * 所以末句照样能走到中线（需求方圈图指出的第二处）。
 */
const alignPosition = computed(() => {
  if (!viewH.value) return BASE_ALIGN;
  const clamped = (activeIndex.value * EST_LINE_HEIGHT + EST_LINE_HEIGHT / 2) / viewH.value;
  return Math.min(BASE_ALIGN, Math.max(0, clamped));
});
/** 顶部渐隐只在列表真的被推起后才开：否则贴顶的开头几句会被遮罩压暗（v4.82 实测） */
const fadeTop = computed(() => (alignPosition.value < BASE_ALIGN ? "0%" : "var(--ly-fade)"));

/** 减少动态效果（VS-07）：关掉弹簧与缩放；模糊保留（它不产生位移运动） */
const reduceMotion = ref(false);

const playerRef = ref<InstanceType<typeof LyricPlayer> | null>(null);

/** LR-06 点击跳转：AMLL 给的是行索引，时间取我们自己的那份数据（两边顺序一致） */
function onLineClick(event: MouseEvent & { lineIndex: number }): void {
  const line = props.lines[event.lineIndex];
  if (line) emit("seek", line.time);
}

/* ---------- LR-07：显式回位入口 ----------
   自动回位由 AMLL 负责（滚轮停手 + 切到下一句时它自己 `resetScroll()`）；这里只补按钮。
   **指针停在按钮上时要暂停倒计时**——v4.79 实测教训：否则倒计时到点会在手伸过去的
   路上把按钮收走，连点都点不到。 */
const manual = ref(false);
const RESUME_LINGER_MS = 8000;
let resumeTimer: ReturnType<typeof setTimeout> | null = null;

function clearResumeTimer(): void {
  if (resumeTimer !== null) {
    clearTimeout(resumeTimer);
    resumeTimer = null;
  }
}
/** 用户动过歌词区（滚轮 / 按下拖动）→ 出现回位入口 */
function markManual(): void {
  manual.value = true;
  clearResumeTimer();
  resumeTimer = setTimeout(() => (manual.value = false), RESUME_LINGER_MS);
}
function holdResume(): void {
  clearResumeTimer();
}
function scheduleResume(): void {
  if (!manual.value) return;
  clearResumeTimer();
  resumeTimer = setTimeout(() => (manual.value = false), 2000);
}
function resume(): void {
  manual.value = false;
  clearResumeTimer();
  /* 它把实例挂在 expose 的 `lyricPlayer` 上，但 props 里**也有一个同名 prop**（那是渲染器），
     于是 `InstanceType<typeof LyricPlayer>` 上这个名字被 prop 类型占住了 → 这里显式收窄一次。 */
  const handle = playerRef.value as unknown as {
    lyricPlayer?: { resetScroll?: () => void };
  } | null;
  handle?.lyricPlayer?.resetScroll?.();
}
/** 当前句变了 → AMLL 已经自动回到当前句（或本来就在跟随），入口可以收起来 */
watch(activeIndex, () => {
  manual.value = false;
  clearResumeTimer();
});

onMounted(() => {
  reduceMotion.value = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  if (!viewRef.value) return;
  viewH.value = viewRef.value.clientHeight;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(() => {
      if (viewRef.value) viewH.value = viewRef.value.clientHeight;
    });
    observer.observe(viewRef.value);
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  clearResumeTimer();
});
</script>

<template>
  <!-- 两层结构：`.ly` 只负责定位（布局给高度）并承载回位按钮，
       `.ly-view` 才是“视窗”（负责上下渐隐遮罩与裁剪）——
       遮罩必须只罩歌词，否则底部的回位按钮会被一起淡掉（实测踩过）。 -->
  <div class="ly" @wheel.passive="markManual" @pointerdown.passive="markManual">
    <div ref="viewRef" class="ly-view" :style="{ '--ly-fade-top': fadeTop }">
      <p v-if="lines.length === 0" class="ly-empty">暂无歌词</p>

      <!-- 渲染与全部动效由 AMLL 负责（AGPL-3.0，取舍见 PRD 3.7 注 / v4.84） -->
      <LyricPlayer
        v-else
        ref="playerRef"
        class="ly-amll"
        :lyric-lines="amllLines"
        :current-time="currentMs"
        :align-position="alignPosition"
        :enable-spring="!reduceMotion"
        :enable-scale="!reduceMotion"
        :word-fade-width="0.5"
        @line-click="onLineClick"
      />
    </div>

    <!-- LR-07：手动浏览时给一个明确的回位入口（自动回位要等下一句，用户不该被迫等） -->
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
  /* 上下渐隐带高度（LR-04：让歌词"从雾里进出"而不是被硬切）。
     顶端那条**按需开关**（`--ly-fade-top` 由 JS 按锚线是否被压下写值）：锚线正常时
     当前句在视窗中线上，顶端渐隐只作用于正在离场的行；只有开头几句贴顶时关掉它，
     免得把当前句一起压暗（v4.82 → v4.83 两轮实测）。 */
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

/* ---------- AMLL 主题映射 ----------
   它用自己那套 CSS 变量取色，这里把我们的令牌映射过去，避免出现第二套视觉语言。
   **包裹层必须给出确定高度**：AMLL 的根是个包裹层（我们的 class 落在它上面），真正的
   播放器在里层且 `height: 100%`——包裹层高度是 auto 时百分比对着 auto 解析成 0，
   整块高度归零，它会把所有行都当成"不在可视区"直接剔除（实测踩过：DOM 里只剩间奏点
   和底栏）。 */
.ly-amll {
  height: 100%;
  --amll-lp-color: var(--text-1);
  --amll-lp-font-size: clamp(17px, 2.6vh, 30px);
  --amll-lp-hover-bg-color: var(--plane-2);
}

/* 播放器内部元素由子组件渲染，scoped 属性不跟过去 → 用 :deep。
   `mix-blend-mode` 必须改回常规混合：AMLL 默认 `plus-lighter`（叠加），那是为**深色**底
   设计的——我们的沉浸页在浅色封面下整页是浅底，叠加会把歌词冲淡到看不见（VS-08 双主题
   是硬约束）。逐字高亮由它内部的渐变遮罩完成，不依赖混合模式，所以这样改不丢效果。 */
.ly-amll :deep(.amll-lyric-player) {
  mix-blend-mode: normal;
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
</style>
