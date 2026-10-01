<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import IconList from "~icons/ph/list";
import AppSidebar from "@/components/AppSidebar.vue";
import { MOBILE_QUERY, useMediaQuery } from "@/composables/useMediaQuery";
import { isTouchTap } from "@/utils/pointer";

/**
 * 手机端左侧导航抽屉（RT-02，参考 Salt Player 的「侧栏收起来」）。
 *
 * **只在手机（<768px）出现**：桌面沿用原来的侧栏（收起 = 缩成图标条），一分不变 ——
 * 曾经把桌面也改成“收起即完全隐藏 + 左缘临时滑出”，需求方澄清后回退（只动手机）。
 *
 * 打开：左上角按钮 / 屏幕左缘右滑；关闭：遮罩、抽屉内左滑、Esc、选完页面自动收起。
 */
const route = useRoute();
const isMobile = useMediaQuery(MOBILE_QUERY);

const open = ref(false);

/** 抽屉里的侧栏永远是“展开态”（抽屉里再缩成图标条没有意义） */
const drawerCollapsed = false;

function show(): void {
  open.value = true;
}

function hide(): void {
  open.value = false;
}

function toggle(): void {
  if (open.value) hide();
  else show();
}

/** 抽屉里的“收起侧栏”按钮就是收起抽屉 */
function onSidebarToggle(): void {
  hide();
}

const toggleLabel = "收起侧栏";

// 选完页面自动收起（Salt 的抽屉也是这个行为）
watch(
  () => route.fullPath,
  () => hide(),
);

/* ---------- 触发方式一：左缘热区 ---------- */
// 触摸：从左缘右滑拉出
const swipe = { x: 0, active: false };

function onEdgeDown(event: PointerEvent): void {
  if (!isMobile.value || open.value || !isTouchTap(event.pointerType)) return;
  swipe.active = true;
  swipe.x = event.clientX;
}

function onEdgeUp(event: PointerEvent): void {
  if (!swipe.active) return;
  swipe.active = false;
  if (event.clientX - swipe.x >= 40) show();
}

/* ---------- 关闭：遮罩点击 / 抽屉内左滑 / Esc ---------- */
const drawerSwipe = { x: 0, active: false };

function onDrawerDown(event: PointerEvent): void {
  if (!isMobile.value || !isTouchTap(event.pointerType)) return;
  drawerSwipe.active = true;
  drawerSwipe.x = event.clientX;
}

function onDrawerUp(event: PointerEvent): void {
  if (!drawerSwipe.active) return;
  drawerSwipe.active = false;
  if (drawerSwipe.x - event.clientX >= 40) hide();
}

function onKeydown(event: KeyboardEvent): void {
  // Ctrl+B：手机开关抽屉（桌面侧栏有自己的折叠按钮，这里不插手）
  if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
    if (!isMobile.value) return;
    event.preventDefault();
    toggle();
    return;
  }
  if (event.key === "Escape" && open.value) hide();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <!-- 整个组件只在手机存在：桌面（≥768px）侧栏仍是常驻 + 图标条折叠 -->
  <button
    v-if="isMobile"
    class="nav-toggle"
    :title="open ? '收起侧栏' : '展开侧栏'"
    aria-controls="nav-drawer"
    :aria-expanded="open"
    @click="toggle"
  >
    <IconList class="icon" />
  </button>

  <!-- 屏幕左缘热区：从这里右滑拉出抽屉 -->
  <div
    v-if="isMobile"
    class="nav-edge"
    aria-hidden="true"
    @pointerdown="onEdgeDown"
    @pointerup="onEdgeUp"
    @pointercancel="onEdgeUp"
  />

  <div v-if="isMobile" class="nav-scrim" :class="{ 'is-open': open }" @click="hide" />

  <aside
    v-if="isMobile"
    id="nav-drawer"
    class="nav-drawer"
    :class="{ 'is-open': open }"
    aria-label="侧边导航"
    @pointerdown="onDrawerDown"
    @pointerup="onDrawerUp"
    @pointercancel="onDrawerUp"
  >
    <AppSidebar
      :collapsed="drawerCollapsed"
      :toggle-label="toggleLabel"
      @toggle="onSidebarToggle"
    />
  </aside>
</template>

<style scoped>
/* ---------- 入口按钮 ---------- */
.nav-toggle {
  position: fixed;
  /* 与页面内边距（16px）对齐，视觉上落在内容岛左上角；比标题略高一点，看着像页头的一部分 */
  top: 18px;
  left: 18px;
  z-index: 70;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-control);
  color: var(--text-2);
  transition:
    color 0.15s,
    background 0.15s;
}

.nav-toggle:hover {
  color: var(--text-1);
  background: var(--hover);
}

.nav-toggle .icon {
  width: 20px;
  height: 20px;
}

/* ---------- 左缘热区 ---------- */
.nav-edge {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 65;
  width: 12px;
  /* 触摸时要真的收到 pointer 事件，所以不能 pointer-events: none；
     它只有 12px 宽，且比内容岛低一层，正常点击不受影响。 */
}

/* ---------- 遮罩 ---------- */
.nav-scrim {
  position: fixed;
  inset: 0;
  z-index: 85;
  background: rgba(12, 16, 28, 0.34);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.24s ease;
}

.nav-scrim.is-open {
  opacity: 1;
  pointer-events: auto;
}

/* ---------- 抽屉本体 ---------- */
.nav-drawer {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 90;
  width: 236px;
  /* 岛与视口留出与桌面外壳相同的 14px，抽屉拉出时侧栏仍是同一个“岛” */
  padding: 14px;
  transform: translateX(-104%);
  visibility: hidden;
  transition:
    transform 0.28s cubic-bezier(0.32, 0.72, 0, 1),
    visibility 0.28s;
}

.nav-drawer.is-open {
  transform: translateX(0);
  visibility: visible;
}

/* 侧栏自己不知道“我在抽屉里”，高度由这里给 */
.nav-drawer :deep(.sidebar) {
  height: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .nav-drawer,
  .nav-scrim {
    transition: none;
  }
}
</style>
