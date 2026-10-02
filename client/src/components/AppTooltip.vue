<script setup lang="ts">
import { TooltipContent, TooltipPortal, TooltipRoot, TooltipTrigger } from "reka-ui";

/**
 * 应用内提示（Reka Tooltip 行为层 + 自绘玻璃皮肤）—— **只有图标的按钮**的标准做法（v5.71）。
 *
 * 为什么不再用原生 `title`：① 系统提示的延迟与样式都不可控（深色主题下仍是一个白框），
 * ② 它不受主题令牌控制、也和我们的浮层语言对不上，③ 手机上长按会弹出一串文字。
 * Reka 那份是**无样式行为层**：指针进入或键盘聚焦（尊重 `:focus-visible`）才开、
 * 指针移走 / 按 Esc / 点它自己就关，并且把内容接成触发元素的 `aria-describedby`。
 *
 * 用法（外层写 label，**不要再写 `title`**）：
 * ```vue
 * <AppTooltip label="下一首">
 *   <button class="ctl" :disabled="!player.hasTrack" @click="player.next()">
 *     <IconSkipForward class="icon" />
 *   </button>
 * </AppTooltip>
 * ```
 * `label` 同时是触发元素的 `aria-label`（图标键**没有可见文字**，名字不能丢 ——
 * `aria-describedby` 只在提示打开时存在，不能当名字用）与提示内容，所以只写一处。
 *
 * 有可见文字的控件不用它：那种情况写 `title`（截断时看全文）就够，加提示只是噪音。
 *
 * 延迟由 `App.vue` 里那**一个** `TooltipProvider` 统一给（400ms；连续移到下一枚键不再等）。
 * ⚠️ 内容被 Teleport 到 body，样式必须写在**非 scoped** 块里（AGENTS 坑 6）。
 * ⚠️ 不 `force-mount`（坑 18/21）：提示不需要退场动画，关掉就卸载，不会留隐形命中区。
 */
withDefaults(
  defineProps<{
    /** 提示文字，同时也是触发元素的 `aria-label` */
    label: string;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
    sideOffset?: number;
    /** 关掉某一处的提示（如侧栏展开、标签已经看得见时） */
    disabled?: boolean;
  }>(),
  { side: "top", align: "center", sideOffset: 8, disabled: false },
);
</script>

<template>
  <TooltipRoot :disabled="disabled">
    <TooltipTrigger as-child :aria-label="label">
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent class="tip" :side="side" :align="align" :side-offset="sideOffset">
        {{ label }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<style>
/* ⚠️ 非 scoped：Reka 把内容 Teleport 到 body，scoped 属性不会跟过去（AGENTS 坑 6）。
   隔离靠 .tip 前缀。 */
.tip {
  /* 提示永远在最上层：面板浮层 70~92、队列抽屉 95/96、对话框 100/101 —— 取 110 */
  z-index: 110;
  max-width: 260px;
  padding: 6px 10px;
  border-radius: var(--radius-control);
  background: var(--tray-bg);
  backdrop-filter: var(--tray-blur);
  -webkit-backdrop-filter: var(--tray-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  color: var(--text-1);
  font-size: 12px;
  line-height: 1.35;
  /* 键就在下面 8px，箭头只是多一层噪音（与 v4.61 音量面板同一个取舍） */
  transform-origin: var(--reka-tooltip-content-transform-origin);
}

/* ⚠️ 动画必须挂在 `data-state` 上，**不能写在 .tip 的基础类里**（v5.71 实测）：
   Reka 的 Presence 靠 `animationName` 判断"要不要等退场动画放完"，基础类上永远有一个
   `tip-in` 时，它会在关闭时等一个**永远不来的 `animationend`** —— 节点不卸载。
   后果不只是多一个隐形元素：提示的 DismissableLayer 名额一直占着，Reka 自己的
   "最上层"判别（`index === layers.size - 1`）就被带坏 —— 实测**队列浮层的 Esc 一起失效**。 */
.tip[data-state="delayed-open"],
.tip[data-state="instant-open"] {
  animation: tip-in 0.14s var(--ease-ios);
}

@keyframes tip-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tip {
    animation: none;
  }
}
</style>
