<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeat, useBeat, type BeatFrame } from "@/composables/useBeat";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";
import { baseBlobs } from "@/utils/audioReactive";

/**
 * 节奏光晕画布（v5.90，彩胶唱片布局专属）—— 需求方选的是 canvas 方案：
 * “光晕更加灵动和随机”，而且**跟着歌曲节奏**动。
 *
 * 与 CSS 那三团柔光的分工（关键取舍）：
 *  · CSS 那三团是**底光**（常亮、缓慢变形、暂停也留着）—— 它负责“这张盘在一间有光的屋子里”；
 *  · 这块画布**只做加法**（`globalCompositeOperation = "lighter"`，画面里没有一处是“遮”），
 *    只画两样东西：随强度呼吸的几团光 + **每次击打随机甩出去的一下**。
 *    于是没有音频（跨域音源 / 图还没接上）、开了减弱动效、或者关掉开关时，
 *    画面自动退回纯 CSS 底光 —— **不需要“降级分支”**，因为加法不成立时它本来就是零。
 *
 * 尺寸与位置与底光同源（同一套 `--vinyl-d` / `--art-pad*`），并且压在**盘下面**：
 * 加法光只从盘的四周溢出来，不会把盘面洗白。
 *
 * 性能（需求方原话：“如果觉得耗电那可以换成纯歌词布局”）：逐帧只做几十次渐变填充，
 * 分辨率按 devicePixelRatio 封顶 2；暂停时**整个循环停掉**并清空画布，页面不可见时
 * rAF 本来就不跑（AGENTS 坑 10）。
 */
const theme = useThemeStore();
const player = usePlayerStore();

// 开启节奏分析：循环只有一份，门（在播 / 开关 / 减动效）在 useBeat 里管；
// 本组件只是订阅者（画布逐帧画，不走 Vue 响应式）
useBeat();

const canvasEl = ref<HTMLCanvasElement | null>(null);
/** 底光斑：角度均分、速度两两不同（纯函数 baseBlobs，有单测） */
const blobs = baseBlobs(6);
/** 击打甩出去的光斑：位置与消散速度都随机 */
interface Burst {
  angle: number;
  dist: number;
  r0: number;
  growth: number;
  life: number;
  decay: number;
}
let bursts: Burst[] = [];
let spin = 0;
let rgb: [number, number, number] = [255, 255, 255];

const enabled = computed(() => theme.glowBeat && !prefersReducedMotion());

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 取光晕颜色：**不在这里算颜色**（铁律 3：JS 不写内联色），而是读 CSS 给这块画布算好的
 * `color`。借 canvas 自己把 `oklch(...)` 归一成 `#rrggbb` —— 比手写解析器可靠。
 */
function readColor(): void {
  const el = canvasEl.value;
  const ctx = el?.getContext("2d");
  if (!el || !ctx) return;
  ctx.fillStyle = "#000000";
  ctx.fillStyle = getComputedStyle(el).color;
  const value = ctx.fillStyle;
  if (typeof value !== "string") return;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (hex) {
    rgb = [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
    return;
  }
  const parts = /^rgba?\(([^)]+)\)$/.exec(value);
  if (parts) {
    const [r, g, b] = parts[1].split(",").map((piece) => Number.parseFloat(piece));
    if ([r, g, b].every((piece) => Number.isFinite(piece))) rgb = [r, g, b];
  }
}

function rgba(alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}

function clear(): void {
  const el = canvasEl.value;
  const ctx = el?.getContext("2d");
  bursts = [];
  spin = 0;
  if (el && ctx) ctx.clearRect(0, 0, el.width, el.height);
}

/** 一次击打：在盘的边缘附近随机甩出一到两团光（强的拍子甩两团） */
function spawn(level: number): void {
  const count = level > 0.45 ? 2 : 1;
  for (let i = 0; i < count; i += 1) {
    bursts.push({
      angle: Math.random() * Math.PI * 2,
      // 盘的边缘在画布里是 0.71 倍半径（画布 1.4 盘径、盘 1 盘径），落在它附近才像“从盘上打出来”
      dist: 0.62 + Math.random() * 0.16,
      r0: 0.05 + Math.random() * 0.06,
      growth: 0.4 + Math.random() * 0.5,
      life: 1,
      decay: 0.7 + Math.random() * 0.7,
    });
  }
  if (bursts.length > 14) bursts = bursts.slice(-14);
}

function draw(frame: BeatFrame): void {
  const el = canvasEl.value;
  const ctx = el?.getContext("2d");
  if (!el || !ctx) return;

  const rect = el.getBoundingClientRect();
  if (rect.width < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(rect.width * dpr);
  if (el.width !== size) {
    el.width = size;
    el.height = size;
    readColor();
  }

  const R = size / 2;
  const cx = R;
  const cy = R;
  const seconds = frame.dt / 1000;
  const level = frame.level;

  ctx.clearRect(0, 0, size, size);
  // **只做加法**：这一句是“没有音频就自动退回纯 CSS 底光”的全部秘密
  ctx.globalCompositeOperation = "lighter";

  // ① 底光斑：缓慢绕着盘心漂 + 随强度微微张大变亮
  spin += seconds;
  for (const blob of blobs) {
    const angle = blob.angle + spin * blob.speed;
    const dist = R * (0.1 + 0.045 * blob.size);
    const px = cx + Math.cos(angle) * dist;
    const py = cy + Math.sin(angle) * dist;
    const radius = R * (0.46 + 0.12 * blob.size) * (0.92 + level * 0.26);
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
    gradient.addColorStop(0, rgba(0.03 + level * 0.07));
    gradient.addColorStop(1, rgba(0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ② 整团随强度亮一下（“心跳”那一层）
  const bloom = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * (0.95 + level * 0.1));
  bloom.addColorStop(0, rgba(0.04 + level * 0.1));
  bloom.addColorStop(1, rgba(0));
  ctx.fillStyle = bloom;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // ③ 击打：新的一团 + 所有在衰减的旧团
  if (frame.onset) spawn(level);
  bursts = bursts.filter((burst) => burst.life > 0);
  for (const burst of bursts) {
    burst.life -= seconds * burst.decay;
    if (burst.life <= 0) continue;
    const fade = burst.life * burst.life;
    const radius = (burst.r0 + (1 - burst.life) * burst.growth) * R;
    const px = cx + Math.cos(burst.angle) * burst.dist * R;
    const py = cy + Math.sin(burst.angle) * burst.dist * R;
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
    gradient.addColorStop(0, rgba(0.26 * fade));
    gradient.addColorStop(1, rgba(0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
}

let off: (() => void) | null = null;

onMounted(() => {
  off = onBeat(draw);
});

onBeforeUnmount(() => {
  off?.();
  off = null;
});

// 换封面（⇒ 换配色）与换主题/材质时，重新从 CSS 取一次颜色
watch(() => [player.currentTrack?.id, theme.mode, theme.material], readColor);
watch(
  () => player.playing,
  (playing) => {
    if (!playing) clear();
  },
  { flush: "post" },
);
watch(enabled, (on) => {
  if (!on) clear();
});
</script>

<template>
  <canvas v-if="enabled" ref="canvasEl" class="beat-glow" aria-hidden="true" />
</template>

<style scoped>
/* 与 .vinyl-glow 同源同框（左右各 --art-pad、上下各 --art-pad-y 之外的 1.4 倍盘径），
   颜色也读同一条 CSS 链 —— 画布只负责“往这团光上加东西” */
.beat-glow {
  position: absolute;
  left: calc(var(--art-pad) - var(--vinyl-d) * 0.2);
  bottom: calc(var(--art-pad-y) - var(--vinyl-d) * 0.2);
  width: calc(var(--vinyl-d) * 1.4);
  aspect-ratio: 1;
  color: var(--cv1);
  color: oklch(from var(--cover-src) clamp(0.52, calc(l + 0.04), 0.68) clamp(0.07, c, 0.15) h);
  pointer-events: none;
}
</style>
