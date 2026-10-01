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
import IconSpeakerHigh from "~icons/ph/speaker-high";
import IconSpeakerSlash from "~icons/ph/speaker-slash";
import {
  HoverCardArrow,
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger,
} from "reka-ui";
import { usePlayerStore } from "@/stores/player";
import ScrollingText from "@/components/ScrollingText.vue";
import QueuePopover from "@/components/QueuePopover.vue";
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

        <!-- 音量：点击静音，悬浮/聚焦展开竖向音量条（PL-04）
             悬浮层交给 Reka 的 HoverCard：开合延迟与"悬浮到面板上算不算还在里面"
             由它判定，所以那个 ::after 透明桥接补丁（以及 ::before 手写小三角）退役。 -->
        <HoverCardRoot :open-delay="120" :close-delay="140">
          <HoverCardTrigger as-child>
            <button
              class="ctl"
              :title="silent ? '取消静音' : '静音'"
              :aria-label="silent ? '取消静音' : '静音'"
              @click="player.toggleMute()"
            >
              <component :is="volumeIcon" class="icon" />
            </button>
          </HoverCardTrigger>
          <HoverCardPortal>
            <HoverCardContent
              class="vol-pop"
              side="top"
              :side-offset="10"
              role="group"
              aria-label="音量调节"
            >
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
              <HoverCardArrow class="vol-pop__arrow" :width="10" :height="5" />
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCardRoot>
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

<style scoped>
/* 音量悬浮面板（PL-04）的样式在文件末尾的**非 scoped** 块里：
   Reka 把面板 Teleport 到 body，scoped 属性会丢（见那里的说明）。 */

@media (prefers-reduced-motion: reduce) {
  .vol-pop {
    animation: none;
  }
}
</style>

<style>
/* ---------- 音量悬浮面板（PL-04） ----------
   开合、延迟、"鼠标从按钮移到面板上"的判定全部交给 Reka HoverCard（v4.60）：
   原来的 ::after 透明桥接与 ::before 手写小三角已退役，箭头改用 HoverCardArrow。
   材质用**实底**而不是 chrome 玻璃：它浮在播放条上，背后是平坦底色，没有内容可模糊，
   玻璃在这只会变成"看不见的一圈描边"（实拍发现的回归）；
   队列弹层因为背后有滚动列表，仍然用 chrome 玻璃。
   ⚠️ 必须是非 scoped 块：面板被 Reka Teleport 到 body，Vue 的 scoped 属性不会跟过去，
   带 [data-v-x] 的规则永远匹配不上（v4.60 实测：class 在、样式不生效）。
   隔离靠 .vol-pop* 前缀，不进全局命名空间。 */
.vol-pop {
  z-index: 70;
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 14px 10px 10px;
  min-width: 60px;
  border-radius: var(--radius-control);
  background: var(--plane-2);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
  transform-origin: bottom center;
  animation: vol-in 0.18s var(--ease-ios);
}

@keyframes vol-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }
}

.vol-pop__arrow {
  fill: var(--plane-2);
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
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .vol-pop {
    animation: none;
  }
}
</style>
