<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import IconArrowRight from "~icons/ph/arrow-right";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconQueue from "~icons/ph/queue";
import IconRepeat from "~icons/ph/repeat";
import IconRepeatOnce from "~icons/ph/repeat-once";
import IconShuffle from "~icons/ph/shuffle";
import IconSkipBack from "~icons/ph/skip-back";
import IconSkipForward from "~icons/ph/skip-forward";
import { usePlayerStore } from "@/stores/player";
import QueuePopover from "@/components/QueuePopover.vue";
import VolumeControl from "@/components/VolumeControl.vue";
import { MOBILE_QUERY, useMediaQuery } from "@/composables/useMediaQuery";
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

/** 手机断点：走带键独占一排、其余控件收进次排（Salt Player 的控件分布），
 *  并且手机上多一枚**队列**入口 —— 迷你条为了留白把队列键收起了，
 *  这里是手机端唯一能打开播放队列的地方（Salt 的全屏播放页也有这一枚）。 */
const isMobile = useMediaQuery(MOBILE_QUERY);

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
      <!-- 三组结构在桌面与手机共用，只是**排布**不同：
           桌面挤成一行（模式 上一首 播放 下一首 音量，组间间距与键间距同为 20px，看不出分组），
           手机换行后走带键在前、其余两枚小组走到第二排小键。
           队列入口只在手机上出现：迷你条把队列键收起了，这里是手机唯一入口。 -->
      <div class="im-ctrls__row im-ctrls__row--secondary">
        <button
          class="ctl mode"
          :title="`播放模式：${player.modeLabel}`"
          @click="player.cycleMode()"
        >
          <component :is="modeIcon" class="icon" />
        </button>

        <QueuePopover v-if="isMobile">
          <template #trigger>
            <button class="ctl" :title="`播放队列（${player.queue.length} 首）`">
              <IconQueue class="icon" />
            </button>
          </template>
        </QueuePopover>
      </div>

      <div class="im-ctrls__row im-ctrls__row--primary">
        <button class="ctl prev" title="上一首" :disabled="!player.hasTrack" @click="player.prev()">
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
        <button class="ctl next" title="下一首" :disabled="!player.hasTrack" @click="player.next()">
          <IconSkipForward class="icon" />
        </button>
      </div>

      <div class="im-ctrls__row im-ctrls__row--secondary">
        <!-- 音量：与播放条共用同一个控件（components/VolumeControl.vue，v4.62）——
             两边不再各写一套，否则一定会走偏（这里原来是一条横条）。 -->
        <VolumeControl />
      </div>
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
  justify-content: center;
  /* 手机换行后两组次级键落到下一排；桌面 `nowrap` 时与下面各组的间距叠出视觉上的 20px */
  gap: 20px;
  flex-wrap: nowrap;
  /* 沉浸页的控件只是**尺寸**比播放条大一档；配方其余部分（图标/主按钮的软底、
     主题色、极淡描边、光晕、悬停光、禁用态、过渡）全在 global.css 的 .ctl 系列里，
     这里只写差异（v4.98 收口）。v4.95 的漂移就是因为两处各留一份实现：主按钮在这里
     写 48px / 图标 30px / 还有自己的一份 hover，播放条那边一改就只改了一半。
     --ctl-icon-size 同时管到共享的音量控件（它渲染在 .im-ctrls 里）。 */
  --ctl-icon-size: 22px;
  --ctl-play-size: 48px;
  --ctl-play-icon: 30px;
}

.im-ctrls__row {
  display: flex;
  align-items: center;
  gap: 20px;
}

@media (max-width: 767px) {
  /* 手机：走带键独占一排（排在最上、间距拉开、主键再大一点，拇指好按），
     模式/队列/静音降为下一排小键（图标 19px、间距松一点、颜色已由 .ctl 的 --text-2 管）。
     这就是 Salt Player 的控件分布：常用动作一条排，其余收进次排。 */
  .im-ctrls {
    flex-wrap: wrap;
    gap: 6px 18px;
  }

  .im-ctrls__row--primary {
    order: 1;
    gap: 26px;
    --ctl-play-size: 56px;
    --ctl-play-icon: 32px;
  }

  .im-ctrls__row--secondary {
    order: 2;
    gap: 22px;
    --ctl-icon-size: 19px;
  }
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
