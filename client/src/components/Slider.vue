<script setup lang="ts">
import { computed, ref } from "vue";
import { fillGeometry, sliderRatio, stepValue, valueFromRatio } from "@/utils/slider";

/**
 * 滑杆（自绘，竖横两种朝向共用这一个）。
 *
 * 为什么两个朝向都不用原生 `<input type="range">`：
 * ① **竖杆**加 `rotate(-90deg)` 之后点击映射对、拖动不跟手 —— 引擎用未旋转的几何算
 *    拖动位移，实测从底拖到顶值只动了 1%（AGENTS 坑 7，v4.64 实测）；
 * ② 原生填充是**从 min 端起算**的，双极控件（±dB 这种）照它画会被读成 0~100% 的进度条，
 *    「从中线往两侧长」原生压根没有（坑 23，v5.69 实测：整体增益的填充停在 50% 不动）。
 *
 * 几何与步进在 `utils/slider.ts`（纯函数、有单测），这里只管指针与键盘事件，
 * 以及把算出来的比例摆到 CSS 上；键盘也自己接（↑↓←→ / Home / End，按住 Shift 走大步）。
 *
 * 尺寸（CSS 变量）：`--sld-thickness` 命中区厚度（竖杆=宽、横杆=高）、
 * `--sld-length` 沿轴长度（只对竖杆有意义，横杆一般由宿主 flex 撑开）、
 * `--sld-track` 可见轨道的粗细 —— 音量的悬浮面板窄而矮、均衡器那十根高得多、
 * 整体增益是一整行，三处都不必改组件。
 */
const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    step?: number;
    /** 从中线向两侧填充：±dB 的双极控件要这个，0~1 的音量从底往上就行 */
    centered?: boolean;
    /** 缺省竖杆；均衡器的整体增益是横杆 */
    orientation?: "vertical" | "horizontal";
    label: string;
    /** 给屏读的读数（如 "60%" / "+3 分贝"）；不传就用原始数值 */
    valueText?: string;
    /** 按住 Shift 的大步长，默认是小步长的 10 倍 */
    bigStep?: number;
  }>(),
  { step: 1, centered: false, orientation: "vertical", valueText: "", bigStep: undefined },
);

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);

const vertical = computed(() => props.orientation === "vertical");
const range = computed(() => ({ min: props.min, max: props.max, step: props.step }));
const ratio = computed(() => sliderRatio(props.modelValue, range.value));

/** 填充条几何：沿线从 min 端（或中线）起算 —— 两个朝向只差「用哪两个 CSS 属性」 */
const fillStyle = computed(() => {
  const { start, size } = fillGeometry(ratio.value, props.centered);
  return vertical.value
    ? { bottom: `${start * 100}%`, height: `${size * 100}%` }
    : { left: `${start * 100}%`, width: `${size * 100}%` };
});

const thumbStyle = computed(() =>
  vertical.value ? { bottom: `${ratio.value * 100}%` } : { left: `${ratio.value * 100}%` },
);

/** 指针位置 → 0~1：竖杆从下往上、横杆从左往右（都是「从 min 端起算」） */
function pointerRatio(event: PointerEvent): number {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect) return ratio.value;
  if (vertical.value) {
    return rect.height > 0 ? 1 - (event.clientY - rect.top) / rect.height : ratio.value;
  }
  return rect.width > 0 ? (event.clientX - rect.left) / rect.width : ratio.value;
}

function commit(event: PointerEvent): void {
  emit("update:modelValue", valueFromRatio(pointerRatio(event), range.value));
}

function onDown(event: PointerEvent): void {
  trackRef.value?.setPointerCapture(event.pointerId);
  dragging.value = true;
  commit(event);
}

function onMove(event: PointerEvent): void {
  if (!dragging.value) return;
  commit(event);
}

function onUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  trackRef.value?.releasePointerCapture(event.pointerId);
}

function onKeydown(event: KeyboardEvent): void {
  const next = stepValue(props.modelValue, event.key, {
    ...range.value,
    bigStep: props.bigStep,
    shift: event.shiftKey,
  });
  if (next === null) return;
  event.preventDefault();
  emit("update:modelValue", next);
}
</script>

<template>
  <div
    ref="trackRef"
    class="sld"
    :class="[vertical ? 'is-vertical' : 'is-horizontal', { dragging }]"
    role="slider"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="modelValue"
    :aria-valuetext="valueText || String(modelValue)"
    :aria-orientation="orientation"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @keydown="onKeydown"
  >
    <div class="sld__fill" :style="fillStyle" />
    <div class="sld__thumb" :style="thumbStyle" />
  </div>
</template>

<style scoped>
.sld {
  position: relative;
  /* 命中区比可见轨道粗：细条不好抓（音量面板本来就窄，这里再给点余量） */
  cursor: pointer;
  touch-action: none;
}

.sld.is-vertical {
  width: var(--sld-thickness, 24px);
  height: var(--sld-length, 84px);
}

.sld.is-horizontal {
  width: 100%;
  height: var(--sld-thickness, 20px);
}

/* 底轨：自绘最容易漏的一块 —— 原来那是原生 range 的轨道，不画就没有了（v4.65 的教训）。
   ::before 在绘制顺序上等价于第一个子元素，所以不用 z-index，填充与滑块自然压在它上面。 */
.sld::before {
  content: "";
  position: absolute;
  border-radius: 99px;
  background: var(--fill-track);
}

.sld.is-vertical::before {
  top: 0;
  bottom: 0;
  left: 50%;
  width: var(--sld-track, 5px);
  margin-left: calc(var(--sld-track, 5px) / -2);
}

.sld.is-horizontal::before {
  top: 50%;
  left: 0;
  right: 0;
  height: var(--sld-track, 5px);
  margin-top: calc(var(--sld-track, 5px) / -2);
}

/* 填充：位置与长度都是 JS 算好的（fillGeometry），这里只负责「长在轨道的哪一侧」 */
.sld__fill {
  position: absolute;
  border-radius: 99px;
  background: var(--accent);
}

.sld.is-vertical .sld__fill {
  left: 50%;
  width: var(--sld-track, 5px);
  margin-left: calc(var(--sld-track, 5px) / -2);
}

.sld.is-horizontal .sld__fill {
  top: 50%;
  height: var(--sld-track, 5px);
  margin-top: calc(var(--sld-track, 5px) / -2);
}

/* 滑块：**视觉配方在 global.css 的共用规则里**
   （`.progress .knob, .vol-pop__thumb, .sld__thumb`，尺寸/颜色/柔光与进度条手柄同一份）；
   这里只管定位 —— 竖杆靠 bottom、横杆靠 left，各自把滑块自身拉回半格。
   ⚠️ `position: absolute` 两个朝向都要写：共用配方里没有它，漏了滑块会落回文档流，
   堆在左上角（v5.69 重写时真踩了一次，实测 `thumb.left` 恒为 0）。 */
.sld.is-vertical .sld__thumb {
  position: absolute;
  left: 50%;
  margin-left: -4.5px;
  transform: translateY(50%);
}

.sld.is-horizontal .sld__thumb {
  position: absolute;
  top: 50%;
  margin-top: -4.5px;
  transform: translateX(-50%);
}

.sld:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 99px;
}
</style>
