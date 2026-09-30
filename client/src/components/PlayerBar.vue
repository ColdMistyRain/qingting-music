<script setup lang="ts">
import type { Component } from "vue";
import { computed, ref } from "vue";
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
import IconSpeakerHigh from "~icons/ph/speaker-high";
import IconSpeakerSlash from "~icons/ph/speaker-slash";
import { usePlayerStore } from "@/stores/player";
import ScrollingText from "@/components/ScrollingText.vue";
import { formatTime } from "@/utils/format";
import type { PlayMode } from "@/utils/player";

/**
 * 常驻底部播放条（PRD 3.8 + PL-01~05）。
 * 全部状态来自 player store；未选歌时整条退为"幽灵态"，不出现点不动的高亮主按钮。
 */
const player = usePlayerStore();

const MODE_ICONS: Record<PlayMode, Component> = {
  seq: IconArrowRight,
  list: IconRepeat,
  one: IconRepeatOnce,
  random: IconShuffle,
};

const isIdle = computed(() => !player.hasTrack);
const modeIcon = computed(() => MODE_ICONS[player.mode]);
const playIcon = computed(() => (player.playing ? IconPause : IconPlay));

/**
 * 静音（PL-04）：包括"点了静音键"与"把音量拉到 0"两种到达方式——
 * 它们是同一件事，图标 / 读数 / 滑杆必须长得一模一样（用户反馈三态不统一）。
 */
const silent = computed(() => player.muted || player.volume === 0);
const volumeIcon = computed(() => (silent.value ? IconSpeakerSlash : IconSpeakerHigh));
const volumePercent = computed(() => `${Math.round(player.volume * 100)}%`);
/**
 * 静音时滑杆与读数都按 0 显示（与斜杠图标一致），但**视觉样式保持正常**：
 * 清灰/降透明度会被当成“禁用、点不了”（用户反馈），空轨道 + 旋钮落底已经足够说明是 0。
 */
const sliderValue = computed(() => (silent.value ? 0 : player.volume));
const levelPercent = computed(() => (silent.value ? "0%" : volumePercent.value));
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

function onVolumeInput(event: Event): void {
  player.setVolume(Number((event.target as HTMLInputElement).value));
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
    <div class="pb-left" @mouseenter="hovering = true" @mouseleave="hovering = false">
      <div class="cover">
        <img v-if="player.currentTrack?.cover" :src="player.currentTrack.cover" alt="" />
        <IconMusicNotes v-else class="icon" />
      </div>
      <div style="min-width: 0">
        <ScrollingText class="pb-title" :text="titleText" :active="marqueeActive" />
        <ScrollingText class="pb-artist" :text="subtitleText" :active="marqueeActive" />
        <div v-if="player.notice" class="pb-notice">{{ player.notice }}</div>
      </div>
    </div>

    <div class="pb-center">
      <div class="pb-ctrls">
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

        <!-- 音量：点击静音，悬浮/聚焦展开竖向音量条（PL-04） -->
        <div class="vol-wrap">
          <button
            class="ctl"
            :title="silent ? '取消静音' : '静音'"
            :aria-label="silent ? '取消静音' : '静音'"
            @click="player.toggleMute()"
          >
            <component :is="volumeIcon" class="icon" />
          </button>
          <div class="vol-pop" role="group" aria-label="音量调节">
            <div class="vol-pop__track">
              <input
                class="vol-pop__range"
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="sliderValue"
                :style="{ '--p': levelPercent }"
                aria-label="音量"
                @input="onVolumeInput"
              />
            </div>
            <span class="vol-pop__value">{{ levelPercent }}</span>
          </div>
        </div>
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
      <button class="ctl" disabled title="播放队列（开发中）">
        <IconQueue class="icon" />
      </button>
    </div>
  </footer>
</template>

<style scoped>
/* ---------- 音量：悬浮/聚焦展开的竖向音量条（PL-04） ----------
   玻璃令牌 + 主题色填充，与全站一套视觉语言；纯 CSS 控制显隐（含键盘 focus-within），
   无需 JS 状态，触摸设备上仍可直接点按钮静音。 */
.vol-wrap {
  position: relative;
  display: grid;
  place-items: center;
}

.vol-pop {
  position: absolute;
  bottom: calc(100% + 16px);
  left: 50%;
  z-index: 5;
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 14px 10px 10px;
  /* 固定最小宽度：“100% → 44%”读数变化不能让面板宽度抽动；
     同时要能容下“已静音”三个字不换行 */
  min-width: 60px;
  border-radius: var(--radius-control);
  /* 悬浮层要压在页面内容之上：用接近实底的令牌色，保证两种主题下都读得清 */
  background: color-mix(in srgb, var(--bg-base) 86%, transparent);
  backdrop-filter: blur(28px) saturate(1.5);
  -webkit-backdrop-filter: blur(28px) saturate(1.5);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(-50%) translateY(6px) scale(0.96);
  transform-origin: bottom center;
  transition:
    opacity 0.18s cubic-bezier(0.32, 0.72, 0, 1),
    transform 0.22s cubic-bezier(0.32, 0.72, 0, 1),
    visibility 0.22s;
}

.vol-wrap:hover .vol-pop,
.vol-wrap:focus-within .vol-pop {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0) scale(1);
}

/* ① 小三角指向音量按钮（旋转 45° 的方块，只留朝外的两条边，颜色继承浮层） */
.vol-pop::before {
  content: "";
  position: absolute;
  bottom: -5.5px;
  left: 50%;
  width: 10px;
  height: 10px;
  transform: translateX(-50%) rotate(45deg);
  background: inherit;
  border-right: 1px solid var(--glass-border);
  border-bottom: 1px solid var(--glass-border);
  border-bottom-right-radius: 2px;
}

/* ② 透明"桥"填满按钮与浮层之间的空隙：
   否则鼠标从按钮移向滑杆的途中会离开悬浮区，浮层还没碰到就被收起（用户报的 bug）。
   它在浮层内部，所以鼠标停在这段空白上也算悬浮在浮层上。 */
.vol-pop::after {
  content: "";
  position: absolute;
  bottom: -16px;
  left: 0;
  width: 100%;
  height: 16px;
}

.vol-pop__track {
  position: relative;
  width: 18px;
  height: 84px;
}

/* 竖放：原生滑杆旋转 -90°，样式仍走 tokens.css 里那套自绘轨道与主题色填充。
   居中不能靠 place-items（对超出容器的滑杆不生效，会偏到右侧），
   改为绝对定位 + 负 margin 先摆正，再绕自身中心旋转。 */
.vol-pop__range {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 84px;
  height: 6px;
  margin: -3px 0 0 -42px;
  transform: rotate(-90deg);
}

.vol-pop__value {
  font-size: 11px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  /* 读数永远单行：“100% → 44%”变化时不能让面板宽度抽动 */
  white-space: nowrap;
}
</style>
