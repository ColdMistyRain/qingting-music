<script setup lang="ts">
import IconPlaylist from "~icons/ph/playlist";
import EmptyState from "@/components/EmptyState.vue";

/** 歌单详情（PRD 3.6 / 原型 v2.6）：侧栏分区进入的详情页，数据接入在 M2 */
defineProps<{ id: string }>();
</script>

<template>
  <section>
    <div class="page-head">
      <h1>
        歌单
        <div class="sub">歌单 ID：{{ id }}</div>
      </h1>
    </div>
    <EmptyState
      :icon="IconPlaylist"
      title="歌单功能将在 M2 接入"
      desc="歌单的创建/重命名/删除、跨来源曲目收录与整单播放属于里程碑 M2（PS-01~05）。侧栏分区与详情页结构已就位。"
    />
  </section>
</template>
