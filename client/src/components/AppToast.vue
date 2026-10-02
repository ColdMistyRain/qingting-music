<script setup lang="ts">
import {
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport,
} from "reka-ui";
import IconX from "~icons/ph/x";
import AppTooltip from "@/components/AppTooltip.vue";
import { TOAST_DURATION_MS, dismissToast, toasts } from "@/utils/toast";

/**
 * 提示条宿主（v5.72，Reka Toast）—— 挂在 App.vue，全站就这一份。
 *
 * 队列与文案在 `utils/toast.ts`（任何地方 `showToast(...)` 都能用）；这里只做三件事：
 * 把 Reka 的行为层装起来、给皮肤、在它自己关闭时把条目从队列里摘掉。
 *
 * Reka 给到的（都不必自己写）：计时自动关、**悬停/聚焦/窗口失焦时暂停倒计时**、
 * 左右滑动关闭、`F8` 把焦点送到提示容器、`Esc` 关掉聚焦中的那条、
 * `aria-live` 与 `type="foreground"` 的朗读优先级。
 *
 * ⚠️ 队列是唯一数据源：Reka 说“我关了”（`update:open` 为 false）时我们从队列里摘掉它，
 * 元素随之卸载。**没做退场动画** —— Reka 的 Presence 要播退场就得把节点留到 `animationend`，
 * 而节点留多久由我们的队列说了算：为一次 150ms 的淡出再加一层状态与定时器不值（进场动画照旧）。
 * ⚠️ 进场动画挂在 `[data-state="open"]` 上（基础类上永远挂动画名会让 Presence 等一个不来的
 * `animationend`，AGENTS 坑 24）。
 * ⚠️ 样式写在**非 scoped** 块里（Teleport 到 body，坑 6）；隔离靠 `toast` 前缀。
 */
</script>

<template>
  <ToastProvider :duration="TOAST_DURATION_MS" swipe-direction="right" label="通知">
    <ToastViewport class="toast-vp">
      <ToastRoot
        v-for="item in toasts"
        :key="item.id"
        class="toast"
        :class="`is-${item.tone}`"
        :duration="item.duration"
        type="foreground"
        @update:open="
          (open: boolean) => {
            if (!open) dismissToast(item.id);
          }
        "
      >
        <ToastTitle class="toast__title">{{ item.title }}</ToastTitle>
        <ToastDescription v-if="item.description" class="toast__desc">
          {{ item.description }}
        </ToastDescription>
        <AppTooltip label="关闭提示">
          <ToastClose class="toast__close">
            <IconX class="icon" />
          </ToastClose>
        </AppTooltip>
      </ToastRoot>
    </ToastViewport>
  </ToastProvider>
</template>

<style>
/* ⚠️ 非 scoped：内容被 Teleport 到 body（坑 6）。隔离靠 .toast* 前缀。 */
.toast-vp {
  position: fixed;
  /* 提示永远在最上层：面板浮层 70~92、队列抽屉 95/96、对话框 100/101、工具提示 110 */
  z-index: 120;
  right: 20px;
  /* 落在播放条**上方**：值取外壳那条栅格行用的同一个令牌（--playerbar-h，v5.72） */
  bottom: calc(var(--playerbar-h, 84px) + 16px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(340px, calc(100vw - 40px));
  margin: 0;
  padding: 0;
  list-style: none;
  /* 容器本身不吃点击（只是给提示排队）：否则它会挡住窗口右下角那一片 */
  pointer-events: none;
}

.toast {
  position: relative;
  pointer-events: auto;
  /* 右侧留出关闭键的位置 */
  padding: 11px 32px 11px 14px;
  border-radius: var(--radius-control);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
}

/* 入场：从下方 8px 浮上来（退场不做，见组件注释） */
.toast[data-state="open"] {
  animation: toast-in 0.2s var(--ease-ios);
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

/* 滑动关闭（Reka 只给 CSS 变量与 data-swipe 状态，位移怎么写由我们定） */
.toast[data-swipe="move"] {
  transform: translateX(var(--reka-toast-swipe-move-x));
}

.toast[data-swipe="cancel"] {
  transform: translateX(0);
  transition: transform 0.2s ease-out;
}

.toast[data-swipe="end"] {
  animation: toast-swipe-out 0.1s ease-out forwards;
}

@keyframes toast-swipe-out {
  to {
    transform: translateX(calc(100% + 24px));
    opacity: 0;
  }
}

.toast__title {
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-1);
}

/* 只有出错用状态色（颜色只表达状态；文案本身已经说清了发生什么） */
.toast.is-danger .toast__title {
  color: var(--danger);
}

.toast__desc {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-2);
}

/* 关闭键：图标键那套（只有图标 → 提示里有名字，AppTooltip 的 label 同时是 aria-label） */
.toast__close {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  place-items: center;
  color: var(--text-3);
  cursor: pointer;
  transition: color 0.15s;
}

.toast__close:hover {
  color: var(--text-1);
}

.toast__close .icon {
  width: 14px;
  height: 14px;
}

@media (max-width: 767px) {
  .toast-vp {
    /* 手机：贴着底边铺满（迷你条 56px + 12px 余量），比右下角一小块更好点 */
    right: 12px;
    left: 12px;
    bottom: calc(var(--playerbar-h, 56px) + 12px);
    width: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .toast[data-state="open"],
  .toast[data-swipe="end"] {
    animation: none;
  }
}
</style>
