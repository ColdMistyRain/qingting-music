<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  isTextOverflowing,
  marqueeDuration,
  measureTextWidth,
  type MeasureHost,
} from "@/utils/marquee";

/**
 * 单行长文本（歌名 / 歌手 · 专辑等）：溢出时无缝循环滚动。
 *
 * 三种状态，结构尽量干净：
 *  ① 放得下 → 普通单行文本；
 *  ② 放不下但没在滚（未播放/未悬浮）→ 单行 + 省略号，静止状态最好读；
 *  ③ 放不下且在滚 → 两份相同文本 + translateX(-50%)，首尾相接无缝循环。
 *
 * 溢出判定用离屏探针量宽（见 utils/marquee.ts），所以模板里不需要“测量用元素”，
 * 渲染分支与测量彻底解耦——v4.22 因为多挂一个隐藏 span 让 vue-tsc 生成了坏代码。
 */
const props = defineProps<{
  /** 要显示的文本 */
  text: string;
  /** 是否允许滚动（播放条里是“播放中或鼠标悬浮”）；不满足时退回静态单行 */
  active: boolean;
}>();

/** 两份副本之间的间隔（em）：与 .st__text 的 padding-right 必须一致 */
const MARQUEE_GAP_EM = 2.5;

const boxRef = ref<HTMLElement | null>(null);
const boxWidth = ref(0);
const textWidth = ref(0);
/** 间隔的像素值 = 字号 × MARQUEE_GAP_EM（随字号自适应） */
const gapPx = ref(0);

const scrolling = computed(
  () => props.active && isTextOverflowing(textWidth.value, boxWidth.value),
);

/** 位移距离 = 一份副本（文字 + 间隔），按恒定速度换算成一圈秒数 */
const trackStyle = computed(() =>
  scrolling.value
    ? { "--marquee-duration": `${marqueeDuration(textWidth.value + gapPx.value)}s` }
    : undefined,
);

const measureHost: MeasureHost = {
  createElement: (tag) => document.createElement(tag),
  append: (element) => document.body.append(element),
  remove: (element) => element.remove(),
};

function measure(): void {
  const box = boxRef.value;
  if (!box) return;

  boxWidth.value = box.clientWidth;

  const style = getComputedStyle(box);
  const fontSize = Number.parseFloat(style.fontSize);
  gapPx.value = Number.isFinite(fontSize) ? fontSize * MARQUEE_GAP_EM : 0;

  textWidth.value = measureTextWidth(props.text, style.font, measureHost);
}

let boxObserver: ResizeObserver | null = null;

onMounted(() => {
  measure();
  // 首帧字形宽度可能还没稳定（布局/字体就绪前）→ 下一帧再量一次
  requestAnimationFrame(measure);
  void document.fonts?.ready.then(measure);

  // 容器宽度会随侧栏折叠、窗口缩放变化（这些都不是 window resize），用 RO 最可靠
  if (typeof ResizeObserver !== "undefined" && boxRef.value) {
    boxObserver = new ResizeObserver(measure);
    boxObserver.observe(boxRef.value);
  }
});

onUnmounted(() => boxObserver?.disconnect());

// 换歌 / 文本变化后重量（等 DOM 更新完）
watch(() => props.text, measure, { flush: "post" });
</script>

<template>
  <div ref="boxRef" class="st" :class="{ 'st--scrolling': scrolling }" :style="trackStyle">
    <span v-if="!scrolling" class="st__static">{{ text }}</span>
    <span v-else class="st__track">
      <span class="st__text">{{ text }}</span>
      <span class="st__text" aria-hidden="true">{{ text }}</span>
    </span>
  </div>
</template>

<style scoped>
.st {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

/* ① / ② 静止态：单行 + 省略号，读起来最干净 */
.st__static {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* ③ 滚动态：两份相同文本横向排开，位移 -50% 刚好走过一份 */
.st__track {
  display: inline-flex;
  white-space: nowrap;
  will-change: transform;
  animation: st-marquee var(--marquee-duration, 12s) linear infinite;
}

.st__text {
  /* 必须是 inline-block：纯 inline 元素量不到自己的盒子宽度 */
  display: inline-block;
  /* 间隔用副本自身的 padding，不能用 flex gap：
     gap 会让 translateX(-50%) 少走半个间隔，接缝处会跳 */
  padding-right: 2.5em;
}

@keyframes st-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .st__track {
    animation: none !important;
  }
}
</style>
