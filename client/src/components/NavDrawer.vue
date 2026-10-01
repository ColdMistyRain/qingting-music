<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import AppSidebar from "@/components/AppSidebar.vue";
import { useNavDrawer } from "@/composables/useNavDrawer";
import { MOBILE_QUERY, useMediaQuery } from "@/composables/useMediaQuery";
import { isTouchTap } from "@/utils/pointer";

/**
 * 手机端左侧导航抽屉（RT-02，参考 Salt Player 的「侧栏收起来」）。
 *
 * **只在手机（<768px）出现**：桌面沿用原来的侧栏（收起 = 缩成图标条），一分不变 ——
 * 曾经把桌面也改成“收起即完全隐藏 + 左缘临时滑出”，需求方澄清后回退（只动手机）。
 *
 * 这里只有**面板**；入口按钮在页头里（`components/NavToggle.vue`）——
 * 因为需求方要求按钮与标题同一行，而面板必须盖住整页，两者无法写在一起（状态在 useNavDrawer 里）。
 *
 * 打开：左上角按钮 / 屏幕左缘右滑；关闭：遮罩、抽屉内左滑、Esc、选完页面自动收起。
 */
const route = useRoute();
const isMobile = useMediaQuery(MOBILE_QUERY);

const { open, show, hide, toggle } = useNavDrawer();

/** 抽屉里的侧栏永远是“展开态”（抽屉里再缩成图标条没有意义） */
const drawerCollapsed = false;

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
  <!-- 整个组件只在手机存在：桌面（≥768px）侧栏仍是常驻 + 图标条折叠。
       入口按钮不在这里 —— 它在各页页头里（NavToggle），与标题同一行。 -->

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
  /* 岛与视口留出与桌面外壳相同的 14px（抽屉里那层“岛”壳已撤，14px 现在是抽屉自己的内边距）；
     底部再让出安全区：页脚那两行（设置 / 收起侧栏）是可点的，不能被全面屏的指示条压住。 */
  padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
  /* 抽屉自己是一块**面**（v5.43）：背后是列表正文，而岛是玻璃 —— 不垫底时正文会直接从
     抽屉里透出来（截图里能看到“搜索歌名…”“时长”两层字叠在一起）。
     底色用 --tray-bg（= --plane，比页面底亮一档）：一开始用的 --bg-base 在深色下近黑
     （#0a0c12），抽屉看着就是一块黑斑（需求方：“深色模式下，这个侧边栏也太黑了吧”，v5.45）。 */
  background: var(--tray-bg);
  border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
  box-shadow: 14px 0 40px -18px rgba(20, 28, 60, 0.34);
  transform: translateX(-104%);
  visibility: hidden;
  transition:
    transform 0.28s cubic-bezier(0.32, 0.72, 0, 1),
    visibility 0.28s;
}

:root[data-theme="dark"] .nav-drawer {
  box-shadow: 14px 0 40px -18px rgba(0, 0, 0, 0.6);
}

.nav-drawer.is-open {
  transform: translateX(0);
  visibility: visible;
}

/* 侧栏自己不知道“我在抽屉里”，高度由这里给；
   同时**去掉它那层“岛”壳**（背景/描边/投影/模糊全撤）：抽屉面板本身就是那块面，
   再套一层卡就变成“面板里套卡”两层嵌套 —— 同一个层级只说一次（简约优先）。
   导航项自己的悬浮/选中底色本来就是按页面底色标定的，落在抽屉上对比度一致。 */
.nav-drawer :deep(.sidebar) {
  height: 100%;
  background: none;
  border: 0;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* 内容层的宽度要**跟着宿主走**：`.sb-inner` 写死了展开态宽度 224px（那是桌面外壳的列宽），
   抽屉的内宽只有 208 —— 写死的宽度会溢出去 16px，被 `.sidebar` 的 overflow:hidden 裁掉。
   表现就是需求方说的“选中这块背景右侧被分割”：行的右圆角与 12px 内缩全被切平
   （实测：项 26~226 宽 200，而岛只到 222 → 右边 0px 内缩、左边 12px）。
   抽屉不会折叠（`collapsed` 恒为 false），所以这里不再需要那两档固定宽度。 */
.nav-drawer :deep(.sb-inner) {
  width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .nav-drawer,
  .nav-scrim {
    transition: none;
  }
}
</style>
