<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import IconArrowRight from "~icons/ph/arrow-right";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconRepeat from "~icons/ph/repeat";
import IconRepeatOnce from "~icons/ph/repeat-once";
import IconShuffle from "~icons/ph/shuffle";
import IconSkipBack from "~icons/ph/skip-back";
import IconSkipForward from "~icons/ph/skip-forward";
import { usePlayerStore } from "@/stores/player";
import VolumeControl from "@/components/VolumeControl.vue";
import { formatTime } from "@/utils/format";
import type { PlayMode } from "@/utils/player";

/**
 * 沉浸页底部控制与进度（VS-03：「底部居中控制与进度」；VS-09：三布局**共享**的子组件）。
 *
 * 状态与动作全部走 player store —— 与播放条是同一个来源，不存在"两套播放状态"。
 * 已知债务：这里的**标记与进度条交互**与 PlayerBar 有重复（逻辑没有重复，store 是唯一来源），
 * 等 PL-06 播放队列弹层落地（第三个消费者）时一起抽成 PlaybackControls，见开发约定。
 */
const player = usePlayerStore();

const MODE_ICONS: Record<PlayMode, Component> = {
  seq: IconArrowRight,
  list: IconRepeat,
  one: IconRepeatOnce,
  random: IconShuffle,
};

const modeIcon = computed(() => MODE_ICONS[player.mode]);
const playIcon = computed(() => (player.playing ? IconPause : IconPlay));
const totalSeconds = computed(() => player.duration || player.currentTrack?.duration || 0);

/* 进度条：与播放条同一套交互（点/拖都走 store 的 begin/update/end，数值夹取在 store 里已单测） */
const barRef = ref<HTMLDivElement | null>(null);

function ratioFromEvent(event: PointerEvent): number {
  const rect = barRef.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0) return 0;
  return (event.clientX - rect.left) / rect.width;
}

function onPointerDown(event: PointerEvent): void {
  if (!player.hasTrack) return;
  barRef.value?.setPointerCapture(event.pointerId);
  player.beginSeek(ratioFromEvent(event));
}

function onPointerMove(event: PointerEvent): void {
  if (!player.seeking) return;
  player.updateSeek(ratioFromEvent(event));
}

function onPointerUp(event: PointerEvent): void {
  if (!player.seeking) return;
  barRef.value?.releasePointerCapture(event.pointerId);
  // endSeek 不带参数：拖拽过程中 updateSeek 已经把目标写进 store（PL-03）
  player.endSeek();
}
</script>

<template>
  <div class="im-ctl">
    <div class="im-ctrls">
      <button class="ctl mode" :title="`播放模式：${player.modeLabel}`" @click="player.cycleMode()">
        <component :is="modeIcon" class="icon" />
      </button>
      <button class="ctl" title="上一首" :disabled="!player.hasTrack" @click="player.prev()">
        <IconSkipBack class="icon" />
      </button>
      <button
        class="ctl play"
        :title="player.playing ? '暂停（空格）' : '播放（空格）'"
        :disabled="!player.hasTrack"
        @click="player.toggle()"
      >
        <component :is="playIcon" class="icon" />
      </button>
      <button class="ctl" title="下一首" :disabled="!player.hasTrack" @click="player.next()">
        <IconSkipForward class="icon" />
      </button>
      <!-- 音量：与播放条共用同一个控件（components/VolumeControl.vue，v4.62）——
           两边不再各写一套，否则一定会走偏（这里原来是一条横条）。 -->
      <VolumeControl />
    </div>

    <div class="im-progress">
      <span class="time">{{ formatTime(player.displaySeconds) }}</span>
      <div
        ref="barRef"
        class="progress"
        :class="{
          'progress--disabled': !player.hasTrack,
          playing: player.playing,
          seeking: player.seeking,
        }"
        :style="{ '--p': `${player.displayRatio * 100}%` }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
      >
        <div class="fill" :style="{ width: `${player.displayRatio * 100}%` }" />
        <div class="knob" :style="{ left: `${player.displayRatio * 100}%` }" />
      </div>
      <span class="time">{{ formatTime(totalSeconds) }}</span>
    </div>
  </div>
</template>

<style scoped>
.im-ctl {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  width: min(560px, 74vw);
}

.im-ctrls {
  display: flex;
  align-items: center;
  gap: 20px;
  /* 沉浸页的控件图标略大（22px），共享的音量控件跟着这里走 */
  --ctl-icon-size: 22px;
}

.ctl {
  color: var(--text-2);
  display: grid;
  place-items: center;
  transition:
    color 0.15s,
    filter 0.15s;
}

.ctl:hover:not(:disabled) {
  color: var(--text-1);
  /* 与播放条一致：悬浮反馈用光，不用放大（v4.67） */
  filter: drop-shadow(0 0 6px var(--glow-halo));
}

.ctl:disabled {
  opacity: 0.45;
}

.ctl .icon {
  width: 22px;
  height: 22px;
}

/* 主按钮与播放条同一套语言（半透明主题色软底 + 主题色图标 + 极淡描边）：
   两处长得一样，用户才不会以为是两个不同的播放器 */
.ctl.play {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  box-shadow:
    0 0 0 1px var(--glow-ring),
    0 3px 14px -7px color-mix(in srgb, var(--accent) 45%, transparent);
}

.ctl.play:hover:not(:disabled) {
  filter: brightness(1.12) drop-shadow(0 0 6px var(--glow-halo));
}

.ctl.play .icon {
  width: 30px;
  height: 30px;
}

.im-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.time {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  min-width: 34px;
}

/* 进度条本体（轨道 / 填充 / 手柄 / 播放时的柔光）与“手柄何时出现”全在 global.css 的共用规则里
   （v4.95 手柄配方、v4.96 悬停才出现、v4.97 填充柔光）——
   播放条与沉浸页是同一个控件，这里不再写第二份：v4.95 就是因为两边各留一份而漂过一次。 */
</style>
