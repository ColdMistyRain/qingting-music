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
  /* 最后一列放开：纯浏览场景（音乐库）不显示移除按钮，列宽自动收窄 */
  grid-template-columns: 44px 1fr 64px 56px auto;
  align-items: center;
  gap: 14px;
  /* 歌名 + 歌手两行字需要呼吸：56px 那样塞两行会显得紧凑（v4.28 统一行节奏） */
  min-height: 62px;
  padding: 8px 12px;
  border-radius: var(--radius-row);
  transition: background 0.15s;
}

.row:hover {
  background: var(--hover);
}

/* 相邻两行用一条极淡分割线分隔（不用斑马纹：圆角行 + 没有列分隔线时，
   斑马纹看着像"残留的悬浮态"，v4.29 实拍对比过）。行本身够高（62px），
   细线不会显挤；悬浮/选中仍是圆角底色块。 */
.row + .row {
  border-top: 1px solid var(--glass-border);
}

.row--active {
  background: var(--accent-soft);
}

.row__cover {
  width: 40px;
  height: 40px;
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
  width: 18px;
  height: 18px;
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
  margin-top: 3px;
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
