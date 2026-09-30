<script setup lang="ts">
import type { Track } from "@qingting/shared";
import TrackRow from "@/components/TrackRow.vue";

/**
 * 曲目列表（v4.45）。
 *
 * 列表层面的东西只在这里写一次：曲目行 + 行与行之间的分隔线。
 * 之前分割线是行自己的伪元素，于是总有“这条线到底归谁”的问题——写在后一行会落进
 * 行的盒子里（高亮行上横穿一条线、末行还凭空多一条），改成绝对定位挂在前一行下沿
 * 又得靠“行外”这种隐含约定。现在把线做成**独立元素**，由列表插在行与行之间：
 * 归属明确、DevTools 里直接看得到、增删改都只动这一处。
 * 调用方只管传数据、接事件，不必逐行拼分隔线（这也是当初用伪元素的原因）。
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
    <template v-for="(track, index) in tracks" :key="track.id">
      <div v-if="index > 0" class="row-sep" aria-hidden="true" />
      <TrackRow
        :track="track"
        :index="index"
        :active="activeId === track.id"
        :playing="playing"
        :removable="removable"
        @play="$emit('play', $event)"
        @remove="$emit('remove', $event)"
      />
    </template>
  </div>
</template>
