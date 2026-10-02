<script setup lang="ts">
import { ref } from "vue";
import { usePlayback } from "@/composables/usePlayback";
import { formatTime } from "@/utils/format";
import { togglePointerCapture } from "@/utils/pointer";
import { seekKeyTarget } from "@/utils/seek";

/**
 * 自绘进度条（播放条与沉浸页**共用一份**，v6.11）。
 *
 * 只有轨道本身（轨道 + 填充 + 手柄）住在这里，**两侧的时间**与排布留在各自的宿主：
 * 播放条是桌面一行 `flex`、沉浸页手机档是两行 `grid`（v5.94，时间贴两端与轨道对齐）——
 * 版式差异归宿主，交互与无障碍归这里，两边就不会各长一套。
 *
 * 交互（PL-03）：指针事件同时覆盖鼠标与触摸，数值夹取与跳转都在 store（已单测），
 * 这里只把指针位置换算成比例；拖拽用**指针捕获**，指针滑出轨道也不会断。
 * 无障碍（v6.8）：进度条是自绘的，`role="slider"` / `aria-*` / 键盘步进都要自己补
 * —— 步进算法在 `utils/seek.ts`（纯函数 + 单测），键位口径与全局快捷键同一份
 * `SEEK_STEP_SECONDS`（PL-08：±5 秒）。
 */
const { player, totalSeconds } = usePlayback();

const trackRef = ref<HTMLDivElement | null>(null);

function ratioFromEvent(event: PointerEvent): number {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0) return 0;
  return (event.clientX - rect.left) / rect.width;
}

function onPointerDown(event: PointerEvent): void {
  if (!player.hasTrack) return;
  togglePointerCapture(trackRef.value, event.pointerId, true);
  player.beginSeek(ratioFromEvent(event));
}

function onPointerMove(event: PointerEvent): void {
  if (!player.seeking) return;
  player.updateSeek(ratioFromEvent(event));
}

function onPointerUp(event: PointerEvent): void {
  if (!player.seeking) return;
  // 释放放在 `endSeek()` 前面，所以它**不能抛**（抛了 seeking 就永远挂着）——走共用兜底入口
  togglePointerCapture(trackRef.value, event.pointerId, false);
  // endSeek 不带参数：拖拽过程中 updateSeek 已经把目标写进 store（PL-03）
  player.endSeek();
}

/* ⚠️ 处理完要 `stopPropagation()`：全局快捷键挂在 `window` 上（冒泡阶段），
   不停住的话按一下方向键会同时按“全局 +5s”与这里各跳一次（10 秒）。 */
function onTrackKeydown(event: KeyboardEvent): void {
  if (!player.hasTrack) return;
  const next = seekKeyTarget(player.displaySeconds, event.key, totalSeconds.value);
  if (next === null) return;
  event.preventDefault();
  event.stopPropagation();
  player.seekTo(next);
}
</script>

<template>
  <div
    ref="trackRef"
    class="progress"
    :class="{
      'progress--disabled': !player.hasTrack,
      playing: player.playing,
      seeking: player.seeking,
    }"
    role="slider"
    tabindex="0"
    aria-label="播放进度"
    aria-orientation="horizontal"
    :aria-valuemin="0"
    :aria-valuemax="Math.round(totalSeconds)"
    :aria-valuenow="Math.round(player.displaySeconds)"
    :aria-valuetext="`${formatTime(player.displaySeconds)} / ${formatTime(totalSeconds)}`"
    :aria-disabled="!player.hasTrack"
    @keydown="onTrackKeydown"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="fill" :style="{ width: `${player.displayRatio * 100}%` }" />
    <!-- 没在播曲目时不画手柄：「一个能拖的点」会让人以为有什么可拖（v6.11 统一，
         原先沉浸页那一份在空态下也画） -->
    <div v-if="player.hasTrack" class="knob" :style="{ left: `${player.displayRatio * 100}%` }" />
  </div>
</template>
