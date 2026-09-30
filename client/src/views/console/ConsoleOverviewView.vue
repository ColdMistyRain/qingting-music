<script setup lang="ts">
import { computed } from "vue";
import { useConfigStore } from "@/stores/config";

/**
 * 控制台 · 概览（PRD 3.12 AD-03）。
 * 在线音源状态实时读 /api/config；曲库计数随曲库索引接入后改为 /api/stats。
 */
const config = useConfigStore();

interface StatItem {
  label: string;
  value: string;
}

const stats = computed<StatItem[]>(() => [
  { label: "曲目总数", value: "0" },
  { label: "占用空间", value: "0 B" },
  { label: "本月上传", value: "0" },
  { label: "在线音源", value: config.onlineEnabled ? "已配置" : "未配置" },
]);
</script>

<template>
  <section>
    <div class="page-head">
      <h1>
        概览
        <div class="sub">曲库与上传情况一览</div>
      </h1>
    </div>

    <div class="stat-row">
      <div v-for="item in stats" :key="item.label" class="stat card">
        <b>{{ item.value }}</b>
        <span>{{ item.label }}</span>
      </div>
    </div>

    <p class="roadmap">最常播放、各来源播放占比等图表随 M2 交付。</p>
  </section>
</template>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px 22px;
}

.stat b {
  font-size: 26px;
  letter-spacing: -0.5px;
}

.stat span {
  font-size: 12.5px;
  color: var(--text-2);
}

.roadmap {
  font-size: 12px;
  color: var(--text-3);
  padding: 2px 2px 0;
}
</style>
