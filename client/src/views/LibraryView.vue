<script setup lang="ts">
import { RouterLink } from "vue-router";
import IconMusicNotes from "~icons/ph/music-notes";
import EmptyState from "@/components/EmptyState.vue";
import { useAuthStore } from "@/stores/auth";

/** 音乐库（PRD 3.4）：对所有登录用户为纯浏览视图，上传入口在控制台（3.12） */
const auth = useAuthStore();
</script>

<template>
  <section>
    <div class="page-head">
      <h1>
        音乐库
        <div class="sub">云端曲库 · 0 首</div>
      </h1>
    </div>

    <EmptyState
      :icon="IconMusicNotes"
      title="音乐库还是空的"
      desc="上传的音乐会出现在这里，可以搜索、排序、播放。"
      fill
    >
      <RouterLink v-if="auth.isAdmin" class="btn btn-primary" :to="{ name: 'console-upload' }">
        去管理台上传音乐
      </RouterLink>
      <p v-else class="hint">等管理员上传后，这里就会出现曲库列表。</p>
    </EmptyState>
  </section>
</template>

<style scoped>
.hint {
  font-size: 12.5px;
  color: var(--text-3);
}
</style>
