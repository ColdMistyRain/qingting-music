<script setup lang="ts">
import { computed, ref } from "vue";

/**
 * 竖向滑杆（自绘，音量与均衡器共用这一个）。
 *
 * 为什么不用原生 `<input type="range">` 加 `rotate(-90deg)`：
 * **点击映射是对的、但拖动不跟手** —— 引擎用未旋转的几何算拖动位移，
 * 实测从底拖到顶值只动了 1%（AGENTS 坑 7，v4.64 实测）。
 * 所以竖向滑杆一律自绘：按下即定位、拖动跟手，键盘也自己接
 * （原生 range 那套键盘能力随旋转一起放弃了，这里补回来：↑↓←→ / Home / End，
 * 按住 Shift 走大步）。
 *
 * 尺寸由 CSS 变量给：`--vsl-width`（默认 18px）、`--vsl-height`（默认 84px）——
 * 音量的悬浮面板窄而矮，均衡器那十根要高得多，两边都不必改组件。
 */
const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    step?: number;
    /** 从中线向两侧填充：±dB 的均衡器要这个，0~1 的音量从底往上就行 */
    centered?: boolean;
    label: string;
    /** 给屏读的读数（如 "60%" / "+3 分贝"）；不传就用原始数值 */
    valueText?: string;
    /** 按住 Shift 的大步长，默认是小步长的 10 倍 */
    bigStep?: number;
  }>(),
  { step: 1, centered: false, valueText: "", bigStep: undefined },
);

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);

const ratio = computed(() => {
  const span = props.max - props.min;
  if (span === 0) return 0;
  return Math.min(1, Math.max(0, (props.modelValue - props.min) / span));
});

/** 填充条的几何：centered 时从中线往两侧长（正增益向上、负增益向下） */
const fillStyle = computed(() => {
  const percent = ratio.value * 100;
  if (!props.centered) return { bottom: "0%", height: `${percent}%` };
  return { bottom: `${Math.min(50, percent)}%`, height: `${Math.abs(percent - 50)}%` };
});

/** 步长对齐（0.05 这种浮点步长会有 0.30000000000000004 的尾巴，收一下） */
function quantize(raw: number): number {
  const stepped = Math.round(raw / props.step) * props.step;
  const clamped = Math.min(props.max, Math.max(props.min, stepped));
  return Math.round(clamped * 1000) / 1000;
}

function valueFromPointer(event: PointerEvent): number {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect || rect.height <= 0) return props.modelValue;
  const next = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
  return quantize(props.min + next * (props.max - props.min));
}

function onDown(event: PointerEvent): void {
  trackRef.value?.setPointerCapture(event.pointerId);
  dragging.value = true;
  emit("update:modelValue", valueFromPointer(event));
}

function onMove(event: PointerEvent): void {
  if (!dragging.value) return;
  emit("update:modelValue", valueFromPointer(event));
}

function onUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  trackRef.value?.releasePointerCapture(event.pointerId);
}

function onKeydown(event: KeyboardEvent): void {
  const big = props.bigStep ?? props.step * 10;
  const delta = event.shiftKey ? big : props.step;
  let next: number | null = null;
  if (event.key === "ArrowUp" || event.key === "ArrowRight") next = props.modelValue + delta;
  else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = props.modelValue - delta;
  else if (event.key === "Home") next = props.min;
  else if (event.key === "End") next = props.max;
  if (next === null) return;
  event.preventDefault();
  emit("update:modelValue", quantize(next));
}
</script>

<template>
  <div
    ref="trackRef"
    class="vsl"
    :class="{ dragging }"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :aria-valuetext="valueText || String(modelValue)"
    aria-orientation="vertical"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @keydown="onKeydown"
  >
    <div class="vsl__fill" :style="fillStyle" />
    <div class="vsl__thumb" :style="{ bottom: `${ratio * 100}%` }" />
  </div>
</template>

<style scoped>
.vsl {
  position: relative;
  /* 命中区比可见轨道宽：细条不好抓（面板本来就窄，这里再给点余量） */
  width: var(--vsl-width, 24px);
  height: var(--vsl-height, 84px);
  cursor: pointer;
  touch-action: none;
}

/* 底轨：自绘最容易漏的一块 —— 原来那是原生 range 的轨道，不画就没有了（v4.65 的教训）。
   ::before 在绘制顺序上等价于第一个子元素，所以不用 z-index，填充与滑块自然压在它上面。 */
.vsl::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: var(--vsl-track, 5px);
  margin-left: calc(var(--vsl-track, 5px) / -2);
  border-radius: 99px;
  background: var(--fill-track);
}

.vsl__fill {
  position: absolute;
  left: 50%;
  width: var(--vsl-track, 5px);
  margin-left: calc(var(--vsl-track, 5px) / -2);
  border-radius: 99px;
  background: var(--accent);
}

/* 滑块：**视觉配方在 global.css 的共用规则里**
   （`.progress .knob, .vol-pop__thumb, .vsl__thumb`，尺寸/颜色/柔光与进度条手柄同一份）；
   这里只管竖向定位 —— bottom 是“值的位置”，所以要把滑块自身往上提半格。 */
.vsl__thumb {
  position: absolute;
  left: 50%;
  margin-left: -4.5px;
  transform: translateY(50%);
}

.vsl:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 99px;
}
</style>
