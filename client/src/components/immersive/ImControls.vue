<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import { toPlaylistItem } from "@qingting/shared";
import IconArrowRight from "~icons/ph/arrow-right";
import IconHeartFill from "~icons/ph/heart-fill";
import IconHeartStraight from "~icons/ph/heart-straight";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconRepeat from "~icons/ph/repeat";
import IconRepeatOnce from "~icons/ph/repeat-once";
import IconShuffle from "~icons/ph/shuffle";
import IconSkipBack from "~icons/ph/skip-back";
import IconSkipForward from "~icons/ph/skip-forward";
import { usePlayerStore } from "@/stores/player";
import { useListeningStore } from "@/stores/listening";
import AppTooltip from "@/components/AppTooltip.vue";
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

/** 收藏（PS-05）：算的是“正在播的那一首”的引用（与歌单/历史同一套身份键） */
const listening = useListeningStore();
const currentItem = computed(() =>
  player.currentTrack ? toPlaylistItem(player.currentTrack) : null,
);
const canFavorite = computed(() => currentItem.value !== null);
const isFavorite = computed(() => {
  const item = currentItem.value;
  return item !== null && listening.isFavorite(item);
});

function toggleFavorite(): void {
  const item = currentItem.value;
  if (item) void listening.toggleFavorite(item);
}

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
           桌面一行：模式 上一首 播放 下一首 音量（组间间距与键间距同为 20px，看不出分组）；
           手机也一行，但把队列换到最右：模式 上一首 播放 下一首 队列
           —— 需求方指定（模式在上一曲左侧、列表在下一首右侧），音量交给系统音量键，整枚收起。
           所以队列与音量放同一组、顺序相邻：桌面显音量（队列 v-if 不渲染）。 -->
      <div class="im-ctrls__row">
        <AppTooltip :label="`播放模式：${player.modeLabel}`">
          <button class="ctl mode" @click="player.cycleMode()">
            <component :is="modeIcon" class="icon" />
          </button>
        </AppTooltip>
      </div>

      <div class="im-ctrls__row im-ctrls__row--primary">
        <AppTooltip label="上一首">
          <button class="ctl prev" :disabled="!player.hasTrack" @click="player.prev()">
            <IconSkipBack class="icon" />
          </button>
        </AppTooltip>
        <AppTooltip :label="player.playing ? '暂停（空格）' : '播放（空格）'">
          <button class="ctl play" :disabled="!player.hasTrack" @click="player.toggle()">
            <component :is="playIcon" class="icon" />
          </button>
        </AppTooltip>
        <AppTooltip label="下一首">
          <button class="ctl next" :disabled="!player.hasTrack" @click="player.next()">
            <IconSkipForward class="icon" />
          </button>
        </AppTooltip>
      </div>

      <div class="im-ctrls__row">
        <!-- 队列入口只在手机上出现：迷你条把队列键收起了，这里是手机唯一入口 -->
        <QueuePopover v-if="isMobile" :label="`播放队列（${player.queue.length} 首）`" />

        <!-- 音量：与播放条共用同一个控件（components/VolumeControl.vue，v4.62）——
             两边不再各写一套，否则一定会走偏（这里原来是一条横条）。
             手机整枚收起（样式在下面），音量由系统音量键接管。 -->
        <VolumeControl />

        <!-- 收藏（PS-05）：播放条那枚在手机上收起了（迷你条只留两枚键），
             所以这里是手机端收下当前这首歌的地方（与播放条那枚共用同一个 store） -->
        <AppTooltip :label="isFavorite ? '取消收藏' : '收藏'">
          <button
            class="ctl im-fav"
            :class="{ 'is-on': isFavorite }"
            :disabled="!canFavorite"
            :aria-pressed="isFavorite"
            @click="toggleFavorite"
          >
            <IconHeartFill v-if="isFavorite" class="icon" />
            <IconHeartStraight v-else class="icon" />
          </button>
        </AppTooltip>
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

/* 队列抽屉打开时会被淡出（规则在 QueuePopover 的非 scoped 样式里，靠 body:has(.q-sheet)）。
   这里有过渡，关抽屉那一刻才会淡回来而不是硬切。 */
.im-ctrls,
.im-progress {
  transition: opacity 0.2s;
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
  /* 手机上进度条与走带键**上下调换**（需求方：“播放按钮那一排和进度条调换位置”）：
     进度在上、走带键落在最下面 —— 屏幕底部是拇指最容易够到的区域，留给最常用的三个键，
     进度只是“看一眼”的信息，放它上面。（桌面不动：那里鼠标够得着，沿用原来的顺序。） */
  .im-progress {
    order: -1;
  }

  /* 一排五个键：模式 / 上一曲 / 播放 / 下一曲 / 队列（需求方指定：模式在上一曲左侧、
     列表在下一首右侧）—— 靠 DOM 顺序就是对的（三组依次是 模式 / 走带键 / 队列+音量），
     不用 order 去搬。图标统一 22px（不存在“次级键”了）。
     ⚠️ 音量要抬到 (0,3,0)：组件 scoped 的 .vctl 是运行时注入的，同特异性压不过。 */
  /* 宽度交给容器（下方 .im-ctl 的 100%），这里只管“三组怎么摆”。
     v5.93 需求方：“底部的进度条和按钮组能否距离两边更近一点” ——
     原来那一簇只占 74vw（390px 的屏上两侧各空 51px，窄窗口下空得更多），
     现在模式贴左、队列与收藏贴右、走带键居中，可用宽度全用上。
     **用 grid 的 `1fr auto 1fr` 而不是 space-between**：后者中间那组会被两侧宽度差推偏
     （左组 22px vs 右组 66px，播放键会左偏 22px），而 `1fr auto 1fr` 的中间列永远是容器正中
     —— 播放键与进度条中心对齐这条（v5.70 定的）在手机上同样要成立。
     桌面不改：那里鼠标够得着，聚拢的一簇比铺满更好点。 */
  .im-ctrls {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 0 22px;
    /* 必须显式铺满：.im-ctl 是 `align-items: center` 的列，子项默认收成内容宽
       —— 实测只剩 324px（容器 362），模式键落在 33 而进度条左端在 14，
       两边对不齐；铺满后它才和进度条同一条边界。 */
    width: 100%;
    --ctl-icon-size: 22px;
  }

  .im-ctrls__row:first-child {
    justify-content: flex-start;
  }

  .im-ctrls__row:last-child {
    justify-content: flex-end;
  }

  /* 手机上两侧留白收窄：宽度只认一个来源（容器），
     “距两边多远”写在一处（.im-bottom 的 14px 侧内边距）—— 同“同源派生”那条规则的思路。
     桌面保留 min(560px, 74vw)：大屏上控制区铺满整屏会散掉。 */
  .im-ctl {
    width: min(560px, 100%);
  }

  /* 音量整枚收起（音量由系统音量键接管）。
     ⚠️ 必须用 :deep()：`.vctl` 是 VolumeControl 的根元素，**没有本组件的 data-v 属性** ——
     直接写 `.im-ctrls .vctl` 会被 scoped 编译成带 data-v 的选择器，永远匹配不上
     （实测没藏住，而且没有任何报错）。:deep 同时把特异性抬到 (0,3,0)，压过组件自己的 (0,2,0)。 */
  .im-ctrls :deep(.vctl) {
    display: none;
  }

  .im-ctrls__row--primary {
    gap: 26px;
    --ctl-play-size: 56px;
    --ctl-play-icon: 32px;
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
