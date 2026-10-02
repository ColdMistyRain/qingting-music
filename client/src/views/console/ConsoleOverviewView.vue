<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import IconWarningCircle from "~icons/ph/warning-circle";
import { fetchStats, statsErrorMessage, type StorageStats } from "@/api/stats";
import { useConfigStore } from "@/stores/config";
import { formatSize } from "@/utils/format";

/**
 * 控制台 · 概览（PRD 3.12 AD-03）。
 *
 * 数字来源只有一个：`GET /api/stats`（服务端从曲库索引现算）—— 与曲库管理页同源，
 * 两页不会出现两个数（v5.97 接上；在此之前这里是写死的 `0`，页面一直在说假话）。
 * 「本月上传」没接（接口不给这个数）—— 没数据就不摆一张假卡片（铁律：未接入的功能不渲染假控件）。
 * 在线音源状态实时读 /api/config。
 */
const config = useConfigStore();
const stats = ref<StorageStats | null>(null);
const error = ref("");

async function load(): Promise<void> {
  try {
    stats.value = await fetchStats();
    error.value = "";
  } catch (err) {
    error.value = statsErrorMessage(err);
  }
}

onMounted(() => void load());

interface StatItem {
  label: string;
  value: string;
}

/** 还没读到之前给破折号，不给 0 —— “没数”与“真是 0”得能区分 */
const items = computed<StatItem[]>(() => [
  { label: "曲目总数", value: stats.value ? String(stats.value.songCount) : "—" },
  { label: "占用空间", value: stats.value ? formatSize(stats.value.totalSize) : "—" },
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

    <!-- 读取失败：只在上部给一条提示（与其他页同一套 .strip），卡片区照旧 -->
    <div v-if="error" class="strip">
      <IconWarningCircle class="icon" />
      <span>{{ error }}</span>
      <button class="btn btn-quiet" @click="load()">重试</button>
    </div>

    <div class="stat-row">
      <div v-for="item in items" :key="item.label" class="stat card">
        <b>{{ item.value }}</b>
        <span>{{ item.label }}</span>
      </div>
    </div>

    <p class="roadmap">最常播放、各来源播放占比等图表稍后补上。</p>
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
