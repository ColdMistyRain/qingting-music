<script setup lang="ts">
import type { Component } from "vue";
import { RouterLink } from "vue-router";
import IconArrowLeft from "~icons/ph/arrow-left";
import IconChartPieSlice from "~icons/ph/chart-pie-slice";
import IconListDashes from "~icons/ph/list-dashes";
import IconUploadSimple from "~icons/ph/upload-simple";

interface ConsoleNavItem {
  name: string;
  label: string;
  icon: Component;
}

/** 控制台独立侧栏导航（PRD 3.12：概览 / 曲库管理 / 上传导入） */
const navItems: ConsoleNavItem[] = [
  { name: "console-overview", label: "概览", icon: IconChartPieSlice },
  { name: "console-songs", label: "曲库管理", icon: IconListDashes },
  { name: "console-upload", label: "上传导入", icon: IconUploadSimple },
];
</script>

<template>
  <div class="console">
    <aside class="cs-side glass">
      <div class="sb-logo">
        <span class="note">♫</span><span class="lbl">轻听 · 控制台</span>
      </div>
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        class="nav-item"
        active-class="active"
        :to="{ name: item.name }"
      >
        <component :is="item.icon" class="icon" />
        <span class="lbl">{{ item.label }}</span>
      </RouterLink>
      <div class="sb-foot">
        <RouterLink class="nav-item" :to="{ name: 'library' }">
          <IconArrowLeft class="icon" />
          <span class="lbl">返回播放器</span>
        </RouterLink>
      </div>
    </aside>
    <main class="cs-main glass">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.console {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 224px 1fr;
  gap: 14px;
  height: 100vh;
  padding: 14px;
}

.cs-side {
  display: flex;
  flex-direction: column;
  padding: 18px 12px 12px;
  overflow-y: auto;
}

.cs-main {
  /* 内容区与播放器外壳一致，同为玻璃岛（否则控制台是裸背景，两套外壳视觉不统一） */
  overflow-y: auto;
  padding: 0 var(--island-pad-x) var(--island-pad-x);
}

.sb-logo {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 4px 12px 18px;
  white-space: nowrap;
}

.sb-logo .note {
  color: var(--accent);
  margin-right: 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-control);
  color: var(--text-2);
  font-size: 13.5px;
  text-align: left;
  position: relative;
  /* text-decoration 已由全局 reset 统一处理（global.css 的 a 规则） */
  transition:
    background 0.15s,
    color 0.15s;
}

.nav-item:hover {
  background: var(--hover);
  color: var(--text-1);
}

.nav-item.active {
  background: var(--accent-soft);
  color: var(--text-1);
}

.nav-item.active::before {
  content: "";
  position: absolute;
  left: 0;
  top: 22%;
  height: 56%;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}

.nav-item .icon {
  width: 19px;
  height: 19px;
}

.sb-foot {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sb-foot .nav-item {
  font-size: 12.5px;
  color: var(--text-3);
}

@media (max-width: 767px) {
  .console {
    grid-template-columns: 1fr;
  }

  .cs-side {
    display: none;
  }
}
</style>
