<script setup lang="ts">
import { computed } from "vue";
import type { Track } from "@qingting/shared";
import IconMusicNotes from "~icons/ph/music-notes";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconX from "~icons/ph/x";
import { formatTime } from "@/utils/format";

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
  }>(),
  { removable: true },
);

const emit = defineEmits<{
  play: [index: number];
  remove: [index: number];
}>();

const SOURCE_LABELS: Record<Track["source"], string> = {
  local: "本地",
  server: "云端",
  online: "在线",
};

const sourceLabel = computed(() => SOURCE_LABELS[props.track.source]);
const isPlaying = computed(() => props.active && props.playing);
</script>

<template>
  <div class="row" :class="{ 'row--active': active }" @dblclick="emit('play', index)">
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
      <button class="ctl" :title="isPlaying ? '暂停' : '播放'" @click.stop="emit('play', index)">
        <IconPause v-if="isPlaying" class="icon" />
        <IconPlay v-else class="icon" />
      </button>
      <button v-if="removable" class="ctl" title="从列表移除" @click.stop="emit('remove', index)">
        <IconX class="icon" />
      </button>
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
  /* 歌名 + 歌手两行字需要呼吸：62px 时封面与两行字挤在一起（用户两次反馈“拥挤”），
     v4.43 上调到 76px / 上下 12px，封面同步放大到 44px（正好填满封面列）。
     行内呼吸和行高是两回事：上一轮只加了行高，行内 3px 的行间距/14px 的列间距
     依旧挤，所以这次一起放开。 */
  min-height: 76px;
  padding: 12px var(--row-pad-x);
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
</style>
