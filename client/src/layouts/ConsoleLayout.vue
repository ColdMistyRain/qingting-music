<script setup lang="ts">
import type { Component } from "vue";
import { RouterLink } from "vue-router";
import IconArrowLeft from "~icons/ph/arrow-left";
import IconChartPieSlice from "~icons/ph/chart-pie-slice";
import IconListDashes from "~icons/ph/list-dashes";
import IconMonitor from "~icons/ph/monitor";
import IconUploadSimple from "~icons/ph/upload-simple";
import EmptyState from "@/components/EmptyState.vue";

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
      <div class="sb-logo"><span class="brand-mark" /><span class="lbl">轻听 · 控制台</span></div>
      <!-- 与播放器侧栏同一套配方（v5.15）：品牌与页脚固定、中段（导航）是唯一滚动区，
           否则窗口一矮就把「返回播放器」推出去滚不见了。 -->
      <nav class="cs-nav">
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
      </nav>
      <div class="sb-foot">
        <RouterLink class="nav-item" :to="{ name: 'library' }">
          <IconArrowLeft class="icon" />
          <span class="lbl">返回播放器</span>
        </RouterLink>
      </div>
    </aside>
    <main class="cs-main glass">
      <!-- 手机端（RT-03）：上传/删除/曲库管理以桌面为主，与其把三栏管理界面硬挤成单列，
           不如直接说清楚。必须自带一条“回播放器”的路 —— 控制台侧栅栏在手机上已隐藏，
           而播放器的底部标签栏在**本布局里不存在**（它挂在 PlayerLayout 下），
           不给出口就是死路。 -->
      <div class="cs-hint">
        <EmptyState
          :icon="IconMonitor"
          fill
          title="请使用电脑访问"
          desc="上传、删除与曲库管理以桌面为主；手机上先听歌就好。"
        >
          <RouterLink class="btn" :to="{ name: 'library' }">回到音乐库</RouterLink>
        </EmptyState>
      </div>

      <div class="cs-body">
        <RouterView v-slot="{ Component }">
          <Transition name="page">
            <component :is="Component" />
          </Transition>
        </RouterView>
      </div>
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
  /* 与播放器侧栏 `.sidebar`/`.sb-inner` 同一套分工：
     这一层只管裁切与内边距，滚动的只有中段的 .cs-nav，品牌与页脚固定。 */
  overflow: hidden;
}

/* 导航与页脚共用同一个“项间距”（4px，v5.11 定稿的规则；控制台原来是 0 / 2px 两种节奏） */
.cs-nav,
.sb-foot {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 中段滚动区：**滚动条槽常留**（`scrollbar-gutter: stable`）+ 负的右外边距把槽挪进内边距里，
   于是“要不要滚动”永远不改变项的宽度（展开时 200），滚动条也不会压住项与高亮。
   配方与 .sb-scroll 完全一致（v5.15，改动同步两处）。 */
.cs-nav {
  flex: 1 1 auto;
  min-height: 0;
  margin-right: calc(var(--scrollbar-size, 0px) * -1);
  padding-bottom: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.cs-main {
  /* 内容区与播放器外壳一致，同为玻璃岛（否则控制台是裸背景，两套外壳视觉不统一） */
  overflow-y: auto;
  padding: 0 var(--island-pad-x) var(--island-pad-x);
}

.sb-logo {
  flex: none;
  /* 标记给 24px（默认 22px，这个图形细节多，太小会糊）；理由同播放器侧栏 */
  --brand-mark-size: 24px;
  /* flex 对齐的理由同播放器侧栏：标记是定高图片元素，行盒对齐会把它的高度算进去 */
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 24px;
  /* 左内边距的理由同播放器侧栏：标记比 19px 的图标列宽，按中轴对齐才不歪（v5.17） */
  padding: 4px 12px 18px calc(12px - (var(--brand-mark-size) - 19px) / 2);
  white-space: nowrap;
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
  /* 贴底由上面会伸缩的 .cs-nav 完成（flex 列与 4px 间距见共用规则），
     不再需要 `margin-top: auto`（两个机制并存只会互相打架）。 */
  flex: none;
}

.sb-foot .nav-item {
  font-size: 12.5px;
  color: var(--text-3);
}

/* 手机端提示：桌面不出现。用 display 而不是 v-if 切换，是因为断点判定交给 CSS
   （与全局响应式同一套机制）；代价是窄屏还会挂载一次页面，多一次接口请求 —— 可接受。 */
.cs-hint {
  display: none;
}

@media (max-width: 767px) {
  .console {
    grid-template-columns: 1fr;
  }

  .cs-side {
    display: none;
  }

  .cs-hint {
    display: flex;
    min-height: 100%;
  }

  .cs-body {
    display: none;
  }
}
</style>
