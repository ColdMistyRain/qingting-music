<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import { useRouter } from "vue-router";
import IconArrowRight from "~icons/ph/arrow-right";
import IconMusicNotes from "~icons/ph/music-notes";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconQueue from "~icons/ph/queue";
import IconRepeat from "~icons/ph/repeat";
import IconRepeatOnce from "~icons/ph/repeat-once";
import IconShuffle from "~icons/ph/shuffle";
import IconSkipBack from "~icons/ph/skip-back";
import IconSkipForward from "~icons/ph/skip-forward";
import { usePlayerStore } from "@/stores/player";
import ScrollingText from "@/components/ScrollingText.vue";
import QueuePopover from "@/components/QueuePopover.vue";
import VolumeControl from "@/components/VolumeControl.vue";
import { formatTime } from "@/utils/format";
import type { PlayMode } from "@/utils/player";

/**
 * 常驻底部播放条（PRD 3.8 + PL-01~05）。
 * 全部状态来自 player store；未选歌时整条退为"幽灵态"，不出现点不动的高亮主按钮。
 */
const player = usePlayerStore();
const router = useRouter();

/** VS-03：点击播放条左侧（封面 / 歌曲信息）展开沉浸式播放页 */
function openImmersive(): void {
  if (!player.hasTrack) return;
  router.push({ name: "now" });
}

const MODE_ICONS: Record<PlayMode, Component> = {
  seq: IconArrowRight,
  list: IconRepeat,
  one: IconRepeatOnce,
  random: IconShuffle,
};

const isIdle = computed(() => !player.hasTrack);
const modeIcon = computed(() => MODE_ICONS[player.mode]);
const playIcon = computed(() => (player.playing ? IconPause : IconPlay));

const totalSeconds = computed(() => player.duration || player.currentTrack?.duration || 0);

/* 进度条交互（PL-03）：用指针事件同时覆盖鼠标与触摸；
   数值夹取与跳转都在 store（已单测），这里只把指针位置换算成比例 */
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

/* 长文本滚动（歌名 / 歌手 · 专辑）：宽度从 store 与 utils 拿，滚动交给 ScrollingText */
const titleText = computed(() => player.currentTrack?.title ?? "尚未播放");
const subtitleText = computed(() =>
  player.currentTrack
    ? `${player.currentTrack.artist} · ${player.currentTrack.album}`
    : "从本地播放或音乐库选择歌曲",
);

/* 播放中或鼠标停在左侧信息区时，两条长文本才滚动；其余时间保持静态单行 */
const hovering = ref(false);
const marqueeActive = computed(() => player.playing || hovering.value);
</script>

<template>
  <footer class="playerbar glass" :class="{ 'is-idle': isIdle, 'is-playing': player.playing }">
    <div
      class="pb-left"
      role="button"
      :tabindex="player.hasTrack ? 0 : -1"
      :title="player.hasTrack ? '展开沉浸式播放页' : undefined"
      @click="openImmersive"
      @keydown.enter="openImmersive"
      @mouseenter="hovering = true"
      @mouseleave="hovering = false"
    >
      <div class="cover">
        <img v-if="player.currentTrack?.cover" :src="player.currentTrack.cover" alt="" />
        <IconMusicNotes v-else class="icon" />
      </div>
      <div class="pb-info">
        <ScrollingText class="pb-title" :text="titleText" :active="marqueeActive" />
        <ScrollingText class="pb-artist" :text="subtitleText" :active="marqueeActive" />
        <div v-if="player.notice" class="pb-notice">{{ player.notice }}</div>
      </div>
    </div>

    <div class="pb-center">
      <div class="pb-ctrls">
        <button
          class="ctl mode"
          :title="`播放模式：${player.modeLabel}`"
          @click="player.cycleMode()"
        >
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

        <!-- 音量：与沉浸页共用同一个控件（components/VolumeControl.vue，v4.62） -->
        <VolumeControl />
      </div>

      <div class="progress-row">
        <span class="time">{{ formatTime(player.displaySeconds) }}</span>
        <div
          ref="barRef"
          class="progress"
          :class="{ 'progress--disabled': !player.hasTrack }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="player.endSeek()"
          @pointercancel="player.endSeek()"
        >
          <div class="fill" :style="{ width: `${player.displayRatio * 100}%` }" />
          <div
            v-if="player.hasTrack"
            class="knob"
            :style="{ left: `${player.displayRatio * 100}%` }"
          />
        </div>
        <span class="time">{{ formatTime(totalSeconds) }}</span>
      </div>
    </div>

    <div class="pb-right">
      <!-- 队列弹层（PL-06）：触发按钮由这里传入，保持播放条那套控件样式 -->
      <QueuePopover>
        <template #trigger>
          <button class="ctl" :title="`播放队列（${player.queue.length} 首）`">
            <IconQueue class="icon" />
          </button>
        </template>
      </QueuePopover>
    </div>
  </footer>
</template>
