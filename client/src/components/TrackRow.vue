<script setup lang="ts">
import { computed } from "vue";
import type { Track } from "@qingting/shared";
import IconHeartFill from "~icons/ph/heart-fill";
import IconHeartStraight from "~icons/ph/heart-straight";
import IconMusicNotes from "~icons/ph/music-notes";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconX from "~icons/ph/x";
import AppTooltip from "@/components/AppTooltip.vue";
import { formatTime } from "@/utils/format";
import { isTouchTap } from "@/utils/pointer";

/**
 * 通用曲目行（PRD 3.8 歌曲行结构）。
 * 本地列表、音乐库、在线搜索共用一套行视觉；行交互交给父组件决定。
 */
const props = withDefaults(
  defineProps<{
    track: Track;
    index: number;
    active: boolean;
    playing: boolean;
    /** 纯浏览场景（如音乐库）不给移除按钮，删除入口统一在控制台（LB-05 / AD-02） */
    removable?: boolean;
    /** 收藏键（PS-05）：只有需要它的页面打开（收藏页、音乐库），默认不渲染 */
    showFavorite?: boolean;
    /** 当前是否已收藏（由父组件传，行本身不碰 store） */
    favorite?: boolean;
  }>(),
  { removable: true, showFavorite: false, favorite: false },
);

const emit = defineEmits<{
  play: [index: number];
  remove: [index: number];
  toggleFavorite: [index: number];
}>();

const SOURCE_LABELS: Record<Track["source"], string> = {
  local: "本地",
  server: "云端",
  online: "在线",
};

const sourceLabel = computed(() => SOURCE_LABELS[props.track.source]);
const isPlaying = computed(() => props.active && props.playing);

/** 触摸设备的“点一下”就是播这首（RT-03：手机端要能播放/切歌）。
    桌面不变：单击无响应、双击播放 —— 所以只认 pointerType 为 touch 的点击。
    行内的按钮全部 @click.stop，不会连带触发这里。 */
function onRowClick(event: MouseEvent): void {
  if (isTouchTap((event as PointerEvent).pointerType)) emit("play", props.index);
}
</script>

<template>
  <div
    class="row"
    :class="{ 'row--active': active }"
    @click="onRowClick"
    @dblclick="emit('play', index)"
  >
    <div class="row__cover">
      <img v-if="track.cover" :src="track.cover" alt="" />
      <IconMusicNotes v-else class="icon" />
    </div>

    <div class="row__main" :title="track.title">
      <div class="row__title">{{ track.title }}</div>
      <div class="row__artist">{{ track.artist }}</div>
    </div>

    <div class="row__album" :title="track.album">{{ track.album }}</div>

    <div class="row__source">{{ sourceLabel }}</div>
    <div class="row__time">{{ formatTime(track.duration) }}</div>

    <div class="row__actions">
      <AppTooltip v-if="showFavorite" :label="favorite ? '取消收藏' : '收藏'">
        <button
          class="ctl row__fav"
          :class="{ 'is-on': favorite }"
          :aria-pressed="favorite"
          @click.stop="emit('toggleFavorite', index)"
        >
          <IconHeartFill v-if="favorite" class="icon" />
          <IconHeartStraight v-else class="icon" />
        </button>
      </AppTooltip>
      <AppTooltip :label="isPlaying ? '暂停' : '播放'">
        <button class="ctl" @click.stop="emit('play', index)">
          <IconPause v-if="isPlaying" class="icon" />
          <IconPlay v-else class="icon" />
        </button>
      </AppTooltip>
      <AppTooltip v-if="removable" label="从列表移除">
        <button class="ctl row__remove" @click.stop="emit('remove', index)">
          <IconX class="icon" />
        </button>
      </AppTooltip>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: grid;
  /* 列宽与行保持一致：与表头（TrackListHead）读同一份 --row-grid（v4.38）。
     第 3 列放专辑：行填满岛宽时，中间那块空间用真实信息吃掉，不留大洞（v4.34）。
     最后一列固定宽：auto 会随“本行有几个操作键”变化，表头对不上（见 global.css）。 */
  grid-template-columns: var(--row-grid);
  align-items: center;
  /* 列间距与表头共享同一令牌：两边读同一份，列才对得上 */
  gap: var(--row-gap);
  /* 行盒子（悬浮/选中底色的大小）：只由封面与上下内边距决定。
     “内容离细线远一点”**不是**靠这里——那是 .row-list 的 gap 管的（两个独立旋钮，
     当时把前者当后者调，才把行拱到 76px。见 global.css 的 .row-list）。 */
  min-height: 64px;
  padding: 10px var(--row-pad-x);
  border-radius: var(--radius-row);
  transition: background 0.15s;
}

.row:hover {
  background: var(--hover);
}

.row--active {
  background: var(--accent-soft);
}

.row__cover {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-cover);
  display: grid;
  place-items: center;
  overflow: hidden;
  background: linear-gradient(135deg, var(--cv1), var(--cv2));
  color: rgba(255, 255, 255, 0.8);
}

.row__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.row__cover .icon {
  width: 20px;
  height: 20px;
}

.row__main {
  min-width: 0;
}

.row__title {
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row--active .row__title {
  color: var(--accent);
  font-weight: 600;
}

.row__artist {
  font-size: 11.5px;
  color: var(--text-3);
  /* 歌名与歌手不要黏在一起：3px 看着挤（用户反馈），放到 5px */
  margin-top: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row__source,
.row__time {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

/* 专辑列：单行省略，颜色比歌名淡一档 */
.row__album {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 窄屏：专辑列优先让位（窗口不宽时宁可少一列信息，也不把歌名挤没）。
   栅格由全局 --row-grid 的同断点覆盖，表头与这里保持同一套。 */
@media (max-width: 1024px) {
  .row__album {
    display: none;
  }
}

/* 手机：来源列也让位（栅格见 global.css 的 <768px 段，与表头同断点） */
@media (max-width: 767px) {
  .row__source {
    display: none;
  }

  /* RT-03：删除属管理操作，手机端不给入口（入口在控制台，桌面为主） */
  .row__remove {
    display: none;
  }
}

/* 无悬浮能力的设备（触摸屏）：操作键**常显**。
   手机上主要的播放入口是“点整行”（见 onRowClick），这枚键是**兜底与显式入口**：
   ① 万一某个引擎的 click 不带 pointerType（老引擎），还能靠它点；② 正在播的那行它变“暂停”，
   需要一直看得见（那条规则还在上面：.row--active .ctl）。
   用能力查询（hover）而不是宽度：桌面窗口调窄仍能悬浮，没必要常显。 */
@media (hover: none) {
  .row__actions .ctl {
    opacity: 1;
  }
}

.row__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.row__actions .ctl {
  opacity: 0;
  transition: opacity 0.15s;
}

.row:hover .row__actions .ctl,
.row--active .row__actions .ctl {
  opacity: 1;
}

/* 收藏键（PS-05）：已收藏的那一枚**常显** —— 否则列表看起来像“这一首没有收藏”，
   得把鼠标移上去才知道。状态色（主题色）不在这里写第二份 —— 统一由 global.css 的
   `.ctl.is-on` 给（v5.70 收口：播放条 / 沉浸页控制栏 / 列表行三处一个来源）。 */
.row__actions .row__fav.is-on {
  opacity: 1;
}
</style>
