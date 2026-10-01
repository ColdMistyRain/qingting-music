<script setup lang="ts">
import NavToggle from "@/components/NavToggle.vue";
import IconPlaylist from "~icons/ph/playlist";
import EmptyState from "@/components/EmptyState.vue";

/** 歌单详情（PRD 3.6 / 原型 v2.6）：侧栏分区进入的详情页，数据接入在 M2 */
defineProps<{ id: string }>();
</script>

<template>
  <section>
    <div class="page-head">
      <NavToggle />
      <h1>歌单</h1>
    </div>
    <EmptyState
      :icon="IconPlaylist"
      title="歌单还没上线"
      desc="创建、重命名、删除、收录曲目与整单播放会在后续版本上线。"
    />
  </section>
</template>
