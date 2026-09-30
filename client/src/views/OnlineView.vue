<script setup lang="ts">
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
      <h1>
        在线搜索
        <div class="sub">音源：网易云（ON-02/03）</div>
      </h1>
    </div>

    <EmptyState
      v-if="config.onlineEnabled"
      :icon="IconGlobe"
      title="音源已连上，搜索即将可用"
      desc="后端已检测到音源服务。搜索、试听与歌词随后续版本上线。"
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
