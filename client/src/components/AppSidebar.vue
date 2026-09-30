<script setup lang="ts">
import type { Component } from "vue";
import { computed } from "vue";
import { RouterLink } from "vue-router";
import IconCaretDoubleLeft from "~icons/ph/caret-double-left";
import IconGearSix from "~icons/ph/gear-six";
import IconGlobe from "~icons/ph/globe";
import IconHouse from "~icons/ph/house";
import IconListPlus from "~icons/ph/list-plus";
import IconMusicNotes from "~icons/ph/music-notes";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

defineProps<{ collapsed: boolean }>();
defineEmits<{ toggle: [] }>();

const auth = useAuthStore();
const config = useConfigStore();

interface NavItem {
  name: string;
  label: string;
  icon: Component;
}

/** 导航项按身份与音源配置裁剪（AC-01：未登录只留本地播放；ON-04：音源未配置隐藏在线搜索） */
const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [{ name: "local", label: "本地播放", icon: IconHouse }];
  if (auth.canUseServer) {
    items.push({ name: "library", label: "音乐库", icon: IconMusicNotes });
    if (config.onlineEnabled) items.push({ name: "online", label: "在线搜索", icon: IconGlobe });
  }
  return items;
});
</script>

<template>
  <aside class="sidebar glass">
    <div class="sb-logo">
      <span class="note">♫</span><span class="lbl">轻听音乐</span>
    </div>

    <RouterLink
      v-for="item in navItems"
      :key="item.name"
      class="nav-item"
      active-class="active"
      :title="item.label"
      :to="{ name: item.name }"
    >
      <component :is="item.icon" class="icon" />
      <span class="lbl">{{ item.label }}</span>
    </RouterLink>

    <!-- 歌单分区（PRD 3.6 / 原型 v2.6）：数据接入在 M2（PS-01） -->
    <div class="sb-sep" />
    <div class="sb-section">
      <div class="sb-section-head">
        <span class="lbl">歌 单</span>
        <button class="sb-add" disabled title="新建歌单（开发中）">
          <IconListPlus class="icon" />
        </button>
      </div>
      <p class="sb-hint lbl">暂无歌单</p>
    </div>

    <div class="sb-foot">
      <RouterLink class="nav-item" active-class="active" title="设置" :to="{ name: 'settings' }">
        <IconGearSix class="icon" />
        <span class="lbl">设置</span>
      </RouterLink>
      <button class="nav-item" title="折叠侧边栏" @click="$emit('toggle')">
        <IconCaretDoubleLeft class="icon icon--collapse" />
        <span class="lbl">折叠侧边栏</span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  grid-row: 1;
  grid-column: 1;
  display: flex;
  flex-direction: column;
  padding: 18px 12px 12px;
  overflow-y: auto;
}

.sb-logo {
  font-size: 17px;
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

.sb-sep {
  height: 1px;
  background: var(--glass-border);
  margin: 10px 12px;
}

.sb-section {
  padding: 0 12px 8px;
}

.sb-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-3);
  font-size: 11px;
  letter-spacing: 2px;
  padding: 6px 0;
}

.sb-add {
  color: var(--text-3);
  display: grid;
  place-items: center;
}

.sb-add:disabled {
  opacity: 0.5;
}

.sb-add .icon {
  width: 15px;
  height: 15px;
}

.sb-hint {
  font-size: 12px;
  color: var(--text-3);
  padding: 4px 0;
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

.icon--collapse {
  transition: transform 0.25s;
}

.app.collapsed .icon--collapse {
  transform: rotate(180deg);
}

/* 折叠态：纯图标窄栏，状态由 PlayerLayout 记忆（原型 v2.7） */
.app.collapsed .sb-logo {
  text-align: center;
  padding: 4px 0 18px;
  font-size: 20px;
}

.app.collapsed .lbl {
  display: none;
}

.app.collapsed .sidebar {
  padding: 18px 8px 12px;
}

.app.collapsed .nav-item {
  justify-content: center;
  padding-left: 0;
  padding-right: 0;
  gap: 0;
}

.app.collapsed .sb-section-head {
  justify-content: center;
  padding: 10px 0 6px;
}

.app.collapsed .sb-sep {
  margin: 10px 6px;
}
</style>
