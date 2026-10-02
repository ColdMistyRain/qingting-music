<script setup lang="ts">
import NavToggle from "@/components/NavToggle.vue";
import IconGlobe from "~icons/ph/globe";
import IconPlugsConnected from "~icons/ph/plugs-connected";
import EmptyState from "@/components/EmptyState.vue";
import { useConfigStore } from "@/stores/config";

/** 在线搜索（PRD 3.5）：未配置音源时给出配置指引（ON-04） */
const config = useConfigStore();
</script>

<template>
  <section>
    <div class="page-head">
      <div class="page-head__title">
        <NavToggle />
        <h1>在线搜索</h1>
        <div class="sub">音源：网易云</div>
      </div>
    </div>

    <EmptyState
      v-if="config.status === 'error'"
      :icon="IconPlugsConnected"
      title="配置没能读出来"
      desc="后端可能刚重启还没就绪。稍后重试一下就好，本地播放与云端曲库不受影响。"
      fill
    >
      <button class="btn btn-primary" @click="config.load(true)">重试</button>
    </EmptyState>
    <EmptyState
      v-else-if="config.onlineEnabled"
      :icon="IconGlobe"
      title="音源已连上"
      desc="这个页面暂时还没有可搜索的内容。本地播放、云端曲库与歌单都能照常用。"
      fill
    />
    <EmptyState
      v-else
      :icon="IconPlugsConnected"
      title="在线音源未配置"
      desc="在服务端的配置里填入音源地址并重启即可启用，前端无需改动。未配置时，本地播放与云端曲库不受任何影响。"
      fill
    />
  </section>
</template>
