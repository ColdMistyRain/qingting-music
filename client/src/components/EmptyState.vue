<script setup lang="ts">
import type { Component } from "vue";

/**
 * 空态提示（PRD 3.8：各场景均有引导性文案与操作入口）。
 * fill：当空态是页面唯一内容时，让它占据可用高度并垂直居中，避免顶在上方。
 */
defineProps<{
  icon?: Component;
  title: string;
  desc?: string;
  fill?: boolean;
}>();
</script>

<template>
  <div class="empty" :class="{ 'empty--fill': fill }">
    <span v-if="icon" class="empty__badge"><component :is="icon" class="icon" /></span>
    <div class="empty__title">{{ title }}</div>
    <p v-if="desc" class="empty__desc">{{ desc }}</p>
    <div v-if="$slots.default" class="empty__actions"><slot /></div>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 56px 24px;
  text-align: center;
}

/* 页面唯一内容时：占住可用高度并垂直居中（否则空态顶在上方、下方一大片空） */
.empty--fill {
  min-height: 52vh;
  justify-content: center;
}

/* 图标套主题色软底圆徽 + 一圈柔和光晕：给空态一个视觉锚点与氛围，而不是一个裸图标 */
.empty__badge {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
  margin-bottom: 6px;
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--accent) 16%, transparent),
    0 16px 46px -16px color-mix(in srgb, var(--accent) 60%, transparent);
}

.empty__badge .icon {
  width: 26px;
  height: 26px;
}

.empty__title {
  font-size: 15px;
  font-weight: 600;
}

.empty__desc {
  font-size: 12.5px;
  color: var(--text-2);
  max-width: 48ch;
  line-height: 1.8;
}

.empty__actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}
</style>
