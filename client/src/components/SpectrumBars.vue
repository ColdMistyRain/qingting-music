<script setup lang="ts">
import { onMounted, ref } from "vue";
import { spectrumBands } from "@/utils/audioSpectrum";
import { useSpectrum, type SpectrumFrame } from "@/composables/useSpectrum";

/**
 * 频谱条（VS-05）：播放条迷你指示与沉浸页大图共用的一个纯展示件。
 * 形态全部由宿主的 CSS 控制（宽高、条色 = currentColor），组件只负责
 * "每帧把 count 根条缩放到对应频段的能量"。
 *
 * 状态（composables/useSpectrum 的语义）：
 * - live：跟频谱动
 * - idle（暂停/图未建）：落到地板高度，可见但不跳
 * - dead（在播但拿不到数据，CORS 兜底）：整体淡出 —— 需求原文"自动隐藏"
 * - 减动效：不订阅循环，条子保持地板高度（静态的一排小刻度，不是坏掉）
 */
const props = withDefaults(defineProps<{ count?: number }>(), { count: 4 });

const root = ref<HTMLElement | null>(null);
const els = ref<(HTMLSpanElement | null)[]>([]);
/** 地板高度：静止时也是一排小刻度，而不是空无一物 */
const FLOOR = 0.08;
/** 低于这个变化量就跳过写样式（28 根条 × 60fps 的无谓失效省下来） */
const EPSILON = 0.008;
let last: number[] = [];

function onFrame({ data, state, sampleRate }: SpectrumFrame): void {
  const element = root.value;
  if (!element) return;
  if (element.dataset.state !== state) element.dataset.state = state;
  const values = data ? spectrumBands(data, sampleRate, props.count) : null;
  for (let i = 0; i < props.count; i++) {
    const bar = els.value[i];
    if (!bar) continue;
    const target = values ? Math.max(values[i] ?? 0, FLOOR) : FLOOR;
    if (Math.abs(target - (last[i] ?? -1)) < EPSILON) continue;
    last[i] = target;
    bar.style.transform = `scaleY(${target.toFixed(3)})`;
  }
}

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  useSpectrum(onFrame);
});
</script>

<template>
  <span ref="root" class="spectrum" aria-hidden="true" data-state="idle">
    <span
      v-for="i in count"
      :key="i"
      :ref="(el) => { els[i - 1] = el as HTMLSpanElement }"
      class="bar"
    />
  </span>
</template>

<style>
/* 非 scoped：条子是宿主宽度语义的一部分（迷你指示 / 大图各自由宿主定宽高），样式按类名隔离 */
.spectrum {
  display: inline-flex;
  align-items: stretch;
  justify-content: space-between;
  height: 100%;
  color: var(--accent);
  transition: opacity 0.4s;
}

.spectrum .bar {
  width: 3px;
  border-radius: 1.5px;
  background: currentColor;
  transform: scaleY(0.08);
  transform-origin: bottom;
}

.spectrum[data-state="dead"] {
  opacity: 0;
}
</style>
