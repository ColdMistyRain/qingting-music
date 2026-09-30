<script setup lang="ts">
import IconListDashes from "~icons/ph/list-dashes";
import EmptyState from "@/components/EmptyState.vue";

/** 控制台 · 曲库管理（AD-02）：搜索/排序/删除依赖 /api/songs，随曲库接口一并接入 */
</script>

<template>
  <section>
    <div class="page-head">
      <h1>曲库管理</h1>
    </div>

    <EmptyState
      :icon="IconListDashes"
      title="曲库还是空的"
      desc="上传的音乐会出现在这里，可以搜索、排序与批量管理。"
      fill
    />
  </section>
</template>
