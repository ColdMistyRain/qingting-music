<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { toPlaylistItem } from "@qingting/shared";
import IconHeartStraight from "~icons/ph/heart-straight";
import IconHeartStraightDuotone from "~icons/ph/heart-straight-duotone";
import IconMusicNotes from "~icons/ph/music-notes";
import IconSkipBack from "~icons/ph/skip-back";
import IconSkipForward from "~icons/ph/skip-forward";
import { usePlayerStore } from "@/stores/player";
import { useListeningStore } from "@/stores/listening";
import AppTooltip from "@/components/AppTooltip.vue";
import ProgressBar from "@/components/ProgressBar.vue";
import ScrollingText from "@/components/ScrollingText.vue";
import QueuePopover from "@/components/QueuePopover.vue";
import SpectrumBars from "@/components/SpectrumBars.vue";
import VolumeControl from "@/components/VolumeControl.vue";
import { usePlayback } from "@/composables/usePlayback";
import { MOBILE_QUERY, useMediaQuery } from "@/composables/useMediaQuery";
import { formatTime } from "@/utils/format";
import { currentLineIndex, parseLyrics } from "@/utils/lyrics";
import { isTouchTap } from "@/utils/pointer";

/**
 * 常驻底部播放条（PRD 3.8 + PL-01~05）。
 * 全部状态来自 player store；未选歌时整条退为"幽灵态"，不出现点不动的高亮主按钮。
 */
const player = usePlayerStore();
const router = useRouter();

/** 收藏（PS-05）：按“正在播的那一首”的引用口径算（与歌单/历史同一套身份键） */
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

/** VS-03：点击播放条左侧（封面 / 歌曲信息）展开沉浸式播放页。
 *  就是一次普通跳页 —— 动效由沉浸页自己负责：它作为一张从底部升起的 sheet 上场，
 *  从沉浸页退回时同一段位移反向播（见 App.vue 的层过渡与 ImmersiveView 的 `.im-sheet`）。 */
function openImmersive(): void {
  if (!player.hasTrack) return;
  void router.push({ name: "now" });
}

/* ---------- 手机手势（RT-05，按 Salt Player 的交互语言） ----------
   ① 左侧信息区**左右滑** → 上一首 / 下一首（拇指最常停在这一带；也是迷你条只剩两枚按钮后
      “上一首”的去处）；② **长按播放键** → 展开沉浸页（Salt 官方：“独家长按播放键沉浸模式”）。
   两条都只认真实触摸（`pointerType === "touch"`）：桌面上按住播放键不该算“长按”，
   鼠标拖拽也不该被当成滑动切歌 —— 桌面既有行为一分不变。 */
const SWIPE_MIN_PX = 40;
const LONG_PRESS_MS = 500;

const swipeStart = { x: 0, y: 0, active: false };
/** 刚滑过一下：抑制紧随其后的 click（否则还会展开沉浸页） */
const justSwiped = ref(false);
let pressTimer = 0;
let openedByPress = false;

function onLeftPointerDown(event: PointerEvent): void {
  if (!isTouchTap(event.pointerType)) return;
  swipeStart.active = true;
  swipeStart.x = event.clientX;
  swipeStart.y = event.clientY;
}

function onLeftPointerUp(event: PointerEvent): void {
  if (!swipeStart.active) return;
  swipeStart.active = false;
  const dx = event.clientX - swipeStart.x;
  const dy = event.clientY - swipeStart.y;
  // 竖向意图（滚动/下拉）不当切歌：横向位移要明显压过纵向
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  justSwiped.value = true;
  window.setTimeout(() => (justSwiped.value = false), 400);
  if (dx < 0) player.next();
  else player.prev();
}

function onLeftClick(): void {
  if (justSwiped.value) return;
  openImmersive();
}

function clearPressTimer(): void {
  if (!pressTimer) return;
  window.clearTimeout(pressTimer);
  pressTimer = 0;
}

function onPlayPointerDown(event: PointerEvent): void {
  if (!isTouchTap(event.pointerType) || !player.hasTrack) return;
  pressTimer = window.setTimeout(() => {
    pressTimer = 0;
    openedByPress = true;
    openImmersive();
  }, LONG_PRESS_MS);
}

function onPlayClick(): void {
  // 长按已经进了沉浸页，这一下不要再当成“播放/暂停”
  if (openedByPress) {
    openedByPress = false;
    return;
  }
  player.toggle();
}

const isMobile = useMediaQuery(MOBILE_QUERY);

/* 模式图标 / 播放图标 / 总时长与沉浸页共用一份（`composables/usePlayback`，v6.11）——
   原先两边各写了一遍，新增播放模式时只改一边就会出现“播放条上有、沉浸页上没有”。 */
const { modeIcon, playIcon, totalSeconds } = usePlayback();

const isIdle = computed(() => !player.hasTrack);
/* 长文本滚动（歌名 / 歌手 · 专辑）：宽度从 store 与 utils 拿，滚动交给 ScrollingText */
const titleText = computed(() => player.currentTrack?.title ?? "尚未播放");
const subtitleText = computed(() =>
  player.currentTrack
    ? `${player.currentTrack.artist} · ${player.currentTrack.album}`
    : "从本地播放或音乐库选择歌曲",
);

/* 迷你条第二行：**当前歌词行**（Salt Player 的“迷你播放条歌词”），没歌词时退回 歌手 · 专辑。
  桌面播放条不变（那里有位置放完整信息）。这一行不做跑马灯 —— 歌词每隔几秒就换一句，
  每换一句重启一次滚动会很恰，长句直接省略，要看全的歌词去沉浸页。 */
const lyricLine = computed(() => {
  const lines = parseLyrics(player.lyricsSource).lines;
  if (lines.length === 0) return "";
  return lines[currentLineIndex(lines, player.displaySeconds)]?.text ?? "";
});
const miniSubtitle = computed(() => lyricLine.value || subtitleText.value);

/* 播放中或鼠标停在左侧信息区时，两条长文本才滚动；其余时间保持静态单行 */
const hovering = ref(false);
const marqueeActive = computed(() => player.playing || hovering.value);
</script>

<template>
  <footer class="playerbar glass" :class="{ 'is-idle': isIdle, 'is-playing': player.playing }">
    <AppTooltip label="展开沉浸式播放页" :disabled="!player.hasTrack">
      <div
        class="pb-left"
        role="button"
        :tabindex="player.hasTrack ? 0 : -1"
        @click="onLeftClick"
        @keydown.enter="openImmersive"
        @pointerdown="onLeftPointerDown"
        @pointerup="onLeftPointerUp"
        @pointercancel="onLeftPointerUp"
        @mouseenter="hovering = true"
        @mouseleave="hovering = false"
      >
        <div class="cover-wrap">
          <div class="cover">
            <img v-if="player.currentTrack?.cover" :src="player.currentTrack.cover" alt="" />
            <IconMusicNotes v-else class="icon" />
          </div>
          <!-- 手机：进度绕着封面走（QQ 音乐那个样式）。形状必须**跟着封面的轮廓**：
             封面是 40×40 的**圆角矩形**，所以用 <rect> 而不是 <circle> ——
             圆环会切在封面的四个角上（角上离中心最远），看着像套错了。
             环画在封面外扩 3px 的圆角矩形上，圆角半径也跟着 +3px，四边与四角间距才均匀。
             pathLength="100" 把路径长度归一化：进度只跟比例有关，与周长、圆角半径都无关
             （否则圆角一改周长就得重算，而 π 在 CSS 里算不了）。
             JS 只写原始比例（--p），怎么用留在 CSS。 -->
          <svg v-if="isMobile" class="cover-ring" viewBox="0 0 46 46" aria-hidden="true">
            <rect class="cover-ring__track" x="1" y="1" width="44" height="44" pathLength="100" />
            <rect
              class="cover-ring__fill"
              x="1"
              y="1"
              width="44"
              height="44"
              pathLength="100"
              :style="{ '--p': player.displayRatio }"
            />
          </svg>
        </div>
        <!-- 频谱迷你指示（VS-05，v6.54）：在播时的活信号 —— 桌面才有（手机那排被
             封面环进度占了，塞不下也不需要）；拿不到数据（跨域兜底）时自动隐藏 -->
        <SpectrumBars v-if="!isMobile && player.hasTrack" class="pb-spectrum" :count="4" />
        <div class="pb-info">
          <ScrollingText class="pb-title" :text="titleText" :active="marqueeActive" />
          <!-- 第二行按断点换内容：桌面是 歌手 · 专辑，手机是当前歌词（内容不同，只能换文本，
             不能用 CSS 显隐 —— 两个 ScrollingText 都在树上会各跑一份测量） -->
          <ScrollingText
            v-if="!isMobile"
            class="pb-artist"
            :text="subtitleText"
            :active="marqueeActive"
          />
          <div v-else class="pb-artist pb-lyric" :title="miniSubtitle">{{ miniSubtitle }}</div>
        </div>
      </div>
    </AppTooltip>

    <div class="pb-center">
      <div class="pb-ctrls">
        <AppTooltip :label="`播放模式：${player.modeLabel}`">
          <button class="ctl mode" @click="player.cycleMode()">
            <component :is="modeIcon" class="icon" />
          </button>
        </AppTooltip>
        <AppTooltip label="上一首">
          <button class="ctl prev" :disabled="!player.hasTrack" @click="player.prev()">
            <IconSkipBack class="icon" />
          </button>
        </AppTooltip>
        <AppTooltip :label="player.playing ? '暂停（空格）' : '播放（空格）'">
          <button
            class="ctl play"
            :disabled="!player.hasTrack"
            @pointerdown="onPlayPointerDown"
            @pointerup="clearPressTimer"
            @pointerleave="clearPressTimer"
            @pointercancel="clearPressTimer"
            @click="onPlayClick"
          >
            <component :is="playIcon" class="icon" />
          </button>
        </AppTooltip>
        <AppTooltip label="下一首">
          <button class="ctl" :disabled="!player.hasTrack" @click="player.next()">
            <IconSkipForward class="icon" />
          </button>
        </AppTooltip>

        <!-- 音量：与沉浸页共用同一个控件（components/VolumeControl.vue，v4.62） -->
        <VolumeControl />
      </div>

      <div class="progress-row">
        <span class="time">{{ formatTime(player.displaySeconds) }}</span>
        <!-- 轨道本身是共用件（`ProgressBar.vue`，与沉浸页同一份交互与无障碍）：
             这里只负责“时间贴两端”的排布 -->
        <ProgressBar />
        <span class="time">{{ formatTime(totalSeconds) }}</span>
      </div>
    </div>

    <div class="pb-right">
      <!-- 收藏（PS-05）：对**正在播的那一首**生效（本地/云端都能收）。
           放在队列键**左侧**、两枚并列在最右 —— 中间那组（模式/上一首/播放/下一首/音量）
           因此对进度条左右对称，播放键正落在进度条中线上（带这枚键时是 6 枚，
           播放键会偏左一档，实测偏 19px）。
           手机整组收起（迷你条只留播放/下一首），手机上的收藏入口在沉浸页控制栏。 -->
      <AppTooltip :label="isFavorite ? '取消收藏' : '收藏'">
        <button
          class="ctl pb-fav"
          :class="{ 'is-on': isFavorite }"
          :disabled="!canFavorite"
          :aria-pressed="isFavorite"
          @click="toggleFavorite"
        >
          <IconHeartStraightDuotone v-if="isFavorite" class="icon" />
          <IconHeartStraight v-else class="icon" />
        </button>
      </AppTooltip>

      <!-- 队列弹层（PL-06）：触发按钮由这里传入，保持播放条那套控件样式 -->
      <QueuePopover :label="`播放队列（${player.queue.length} 首）`" />
    </div>
  </footer>
</template>
