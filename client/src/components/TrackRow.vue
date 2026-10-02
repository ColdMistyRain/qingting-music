<script setup lang="ts">
import { computed } from "vue";
import type { Track } from "@qingting/shared";
import IconHeartFill from "~icons/ph/heart-fill";
import IconHeartStraight from "~icons/ph/heart-straight";
import IconMusicNotes from "~icons/ph/music-notes";
import IconX from "~icons/ph/x";
import AppTooltip from "@/components/AppTooltip.vue";
import { formatTime } from "@/utils/format";

/**
 * 通用曲目行（PRD 3.8 歌曲行结构）。
 * 本地列表、音乐库、在线搜索共用一套行视觉；行交互交给父组件决定。
 *
 * **行里不放播放/暂停键**（v5.96）：点整行就是播这首，行尾那列只放“对这首歌的动作”
 * （收藏、从列表移除）。播放/暂停归底部播放条与沉浸页。
 */
const props = withDefaults(
  defineProps<{
    track: Track;
    index: number;
    active: boolean;
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

/** 点这一行就是播这一首（v5.96）—— 列表行里不再有播放/暂停键。
    需求方：“播放和暂停都不应该在列表中有这功能，列表行的最右应该放操作歌曲相关的动作”。
    于是“点行即播”从触摸专属（v5.32）扩到鼠标：桌面也靠它，不再需要行内那枚键。
    已经是当前曲目时点它**不做事**：列表只负责“选播哪一首”，暂停/续播归底部播放条；
    顺带也避开了双击的第二下把这首歌从头再放一遍（播放键没了，双击也没必要了）。
    行内动作键自己 @click.stop，不会连带触发这里。 */
function onRowClick(): void {
  if (props.active) return;
  emit("play", props.index);
}
</script>

<template>
  <div
    class="row"
    :class="{ 'row--active': active }"
    :title="active ? undefined : `播放 ${track.title}`"
    @click="onRowClick"
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
  /* 整行都是播放入口（v5.96）—— 行内不再有播放键，所以要有“可点”的指示 */
  cursor: pointer;
}

.row:hover {
  background: var(--hover);
}

/* 当前曲目那行悬浮时**保持**主题色淡底：`.row:hover` 的特异性 (0,2,0) 高于 `.row--active`
   (0,1,0)，不补这条就会“悬浮到正在播的那一行，它反而从主题色淡底（α .14）掉成更淡的
   通用悬浮底（α .06）”—— 越靠近越不像当前曲目（v5.95 实测：background 由
   `oklab(… / 0.14)` 变成 `rgba(18,24,38,0.06)`）。悬浮反馈本身不靠底色：
   操作键显形那一下已经说明了。 */
.row--active:hover {
  background: var(--accent-soft);
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

/* 无悬浮能力的设备（触摸屏）：动作键**常显** —— 触摸没有悬浮态，藏起来就点不到。
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

/* 动作键默认不占位，悬浮本行才显形（减少每行的视觉噪音）。
   v5.95 需求方：“这个播放按钮有点多此一举了，我直接看底部的播放控件就知道哪首歌正在播放了”
   —— 原先这里还有一条 `.row--active .row__actions .ctl { opacity: 1 }`，把**正在播放那一行**
   的键钉成常显当作“正在播放”标记。那个标记是重复的：① 行自己已经说了（歌名主题色
   + 加粗 + 行底色 `--accent-soft`）；② 底部播放条一直在说。
   v5.96 进一步：那一列里连播放/暂停键也不放了（见 onRowClick），只留“对这首歌的动作”。 */
.row__actions .ctl {
  opacity: 0;
  transition: opacity 0.15s;
}

.row:hover .row__actions .ctl {
  opacity: 1;
}

/* 收藏键（PS-05）：已收藏的那一枚**常显** —— 否则列表看起来像“这一首没有收藏”，
   得把鼠标移上去才知道。状态色（主题色）不在这里写第二份 —— 统一由 global.css 的
   `.ctl.is-on` 给（v5.70 收口：播放条 / 沉浸页控制栏 / 列表行三处一个来源）。 */
.row__actions .row__fav.is-on {
  opacity: 1;
}
</style>
