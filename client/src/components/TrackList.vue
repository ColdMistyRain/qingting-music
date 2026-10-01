<script setup lang="ts">
import type { Track } from "@qingting/shared";
import TrackRow from "@/components/TrackRow.vue";

/**
 * 曲目列表（v4.45，v4.90 简化）。
 *
 * 列表层面的东西只在这里写一次：曲目行 + 行与行之间的间距（间距在 `.row-list`）。
 * 历史：分隔线先是行自己的伪元素 → 再改成由本组件插入的独立 1px 元素（v4.45，
 * 为的是“这条线到底归谁”不再有歧义）；v4.90 需求方说“这些细线都可以去掉了”，
 * 于是线整个删掉，分隔完全交给间距 —— 也回到了 v4.30 的简约优先。
 */
withDefaults(
  defineProps<{
    tracks: readonly Track[];
    /** 正在播的那首用 id 判定：列表被搜索/排序后索引会错位 */
    activeId?: string | null;
    playing?: boolean;
    /** 纯浏览场景（如音乐库）不给移除按钮，删除入口统一在控制台（LB-05 / AD-02） */
    removable?: boolean;
  }>(),
  { activeId: null, playing: false, removable: true },
);

defineEmits<{
  play: [index: number];
  remove: [index: number];
}>();
</script>

<template>
  <div class="row-list">
    <TrackRow
      v-for="(track, index) in tracks"
      :key="track.id"
      :track="track"
      :index="index"
      :active="activeId === track.id"
      :playing="playing"
      :removable="removable"
      @play="$emit('play', $event)"
      @remove="$emit('remove', $event)"
    />
  </div>
</template>
