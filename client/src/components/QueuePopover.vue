<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from "reka-ui";
import QueuePanel from "@/components/QueuePanel.vue";
import { MOBILE_QUERY, useMediaQuery } from "@/composables/useMediaQuery";
import { isTouchTap } from "@/utils/pointer";

/**
 * 播放队列的**壳层**（PL-06）：同一个触发按钮，两种壳层。
 *
 * - **桌面**：贴着触发器弹出的浮层（Reka Popover，v4.59 定稿）——
 *   打开/关闭、点外部关闭、Esc、焦点归还、与触发器的位置计算（含碰撞避让）都不用自己写。
 * - **手机**：从底部升起的**半屏抽屉**（Reka Dialog）—— 需求方：“点击列表按钮后让它从底部弹出来
 *   占满下半屏幕”。半屏是因为手机上的“当前播放”本来就是一份要翻看的列表，
 *   塞在小浮层里又矮又贴边（旧版在 390px 宽下的实拍就是这样）。
 *   Dialog 顺带把 Esc、点遮罩关闭、焦点锁在面板里、aria-modal、关闭后焦点归还触发器都给了；
 *   手势（把手下滑 ≥ 40px 收起）与左抽屉的左滑同一档阈值，且只认真实触摸。
 *
 * 行为层用 Reka（铁律 1）、样式全部自己写（Reka 是无样式行为层）；
 * **内容**（标题行 + 列表）在 QueuePanel.vue，两套壳层共用一份。
 *
 * 触发按钮由**调用方**通过 #trigger 插槽传入：它属于播放条/沉浸页那套控件（`.ctl`），
 * 样式留在各自的调用点，别在这里复制一份。
 */
const open = ref(false);
const isMobile = useMediaQuery(MOBILE_QUERY);

/* 手机关闭手势：把手往下滑（与左抽屉的左滑同一档 40px） */
const gripSwipe = { y: 0, active: false };

function onGripDown(event: PointerEvent): void {
  if (!isTouchTap(event.pointerType)) return;
  gripSwipe.active = true;
  gripSwipe.y = event.clientY;
}

function onGripUp(event: PointerEvent): void {
  if (!gripSwipe.active) return;
  gripSwipe.active = false;
  if (event.clientY - gripSwipe.y >= 40) open.value = false;
}

/**
 * Esc：抽屉只关自己这一层。
 *
 * 沉浸页在 `window` 上听 Esc（收起整页），Reka 也在 `window` 上听（关抽屉）。
 * 两个都在同一层时“谁先注册谁先跑”，靠 `@escape-key-down` 里 stopPropagation 拦不住
 * （实测：按一下抽屉与整页一起关）。所以这里挂**捕获阶段**的 window 监听 ——
 * 它一定先于任何冒泡监听执行，拦住并自己关抽屉，保证“Esc 只关最上面那层”。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!isMobile.value || !open.value || event.key !== "Escape") return;
  event.stopPropagation();
  open.value = false;
}

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<template>
  <!-- 桌面：贴着触发器弹出的浮层 -->
  <PopoverRoot v-if="!isMobile" v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent class="q-pop" side="top" align="end" :side-offset="10">
        <QueuePanel @close="open = false" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>

  <!-- 手机：半屏底部抽屉。用 v-else 而不是再加一个断点判断：两套壳层共用一个开关，
       断点变化时只是换壳，不会出现“两个都开”。 -->
  <DialogRoot v-else v-model:open="open">
    <DialogTrigger as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay class="q-scrim" />
      <DialogContent class="q-sheet">
        <!-- 无障碍名字：视觉上由面板里的“当前播放”承担（Reka 缺 DialogTitle 会告警） -->
        <DialogTitle class="sr-only">播放队列</DialogTitle>

        <!-- 把手：既是“从底部上来的”的信号，也是下滑收起的抓手。
             手势只挂在把手上（不挂整块面板）：列表要能正常滚动，两者不能抢。 -->
        <div
          class="q-grip-area"
          @pointerdown="onGripDown"
          @pointerup="onGripUp"
          @pointercancel="onGripUp"
        >
          <span class="q-grip" aria-hidden="true" />
        </div>

        <QueuePanel @close="open = false" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
/* ⚠️ 这里**不能**用 scoped：Reka 把弹层 Teleport 到 body，而 Vue 的 scoped 属性
   不会跟过去，带 [data-v-x] 的规则永远匹配不上（v4.60 实测：class 在、样式不生效）。
   隔离靠类名前缀：本组件所有类都用 q- 开头，不污染全局。 */
.q-pop {
  /* 面板的水平内边距单独提成变量：列表要用它做负边距，把滚动条推到面板边缘 */
  --q-pad: 10px;
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(390px, 92vw);
  max-height: min(60vh, 470px);
  padding: 10px var(--q-pad) 8px;
  border-radius: var(--radius-panel);
  /* 与音量面板同一套浮层材质（--panel-*）：弹出的临时面板比底下的常驻层更实一档 */
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  color: var(--text-1);
  transform-origin: bottom right;
  animation: q-in 0.18s var(--ease-ios);
}

@keyframes q-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.97);
  }
}

/* ---------- 手机：半屏底部抽屉 ----------
   需求方：“点击列表按钮后让它从底部弹出来占满下半屏幕”。
   高度用 50vh 而不是 50dvh：外壳自己就是 100vh（global.css 的 .app），
   两处同一个单位，抽屉的上沿才会正好落在屏幕正中。
   底部内边距带上安全区（全面屏的 home 指示条）：无安全区的环境里 env() 就是 0。 */
.q-scrim {
  position: fixed;
  inset: 0;
  z-index: 95;
  /* 与左抽屉（NavDrawer）同一档遮罩：全站只有一种“后面还有东西”的压暗 */
  background: rgba(12, 16, 28, 0.34);
  animation: q-scrim-in 0.24s ease;
}

@keyframes q-scrim-in {
  from {
    opacity: 0;
  }
}

.q-sheet {
  /* 面板的水平内边距：列表拿它做负边距，把滚动条推到面板边缘（见 QueuePanel） */
  --q-pad: 14px;
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 96;
  /* 高度自适应（v5.41）：**最多**半屏 —— 队列只有一两首时贴着底部收短，不空着半屏
     需要它去盖走带键（需求方定：“可以”）。用 max-height + 内容撑：
     行多时正好顶到 50vh，列表（`flex: 1` + `min-height: 0`）自己滚；
     行少时盒子跟着内容收短。 */
  max-height: 50vh;
  height: auto;
  display: flex;
  flex-direction: column;
  padding: 0 var(--q-pad) calc(10px + env(safe-area-inset-bottom));
  /* 下沿在屏幕外，下边框画了也看不到 */
  border: 1px solid var(--glass-border);
  border-bottom: 0;
  border-radius: var(--radius-panel) var(--radius-panel) 0 0;
  /* 半屏抽屉读成一块“**面**”，不是一块玻璃 —— 与浮层（.q-pop）故意不同：
     ① 背后正好是沉浸页那排走带键（实测就在抽屉范围内，y 762~818）。0.94 的遮盖度
        仍能认出那排键的轮廓（深色描边在平坦浅色面上太显眼）；
     ② `backdrop-filter` 在部分环境里根本不参与合成（无头浏览器实测不糊），
        不能把“看不清”赌在模糊上；
     ③ 半屏的实时 64px 模糊在手机上是一笔真开销，而它换来的信息本来就不该看见。
     “透”交给遮罩（.q-scrim）：抽屉外的页面仍然透出来并被压暗一层。
     底色用 --bg-base：行内的 --hover / --accent-soft 都是按页面底色标定的对比度，
     换成纯白面板会让“播放中”那行看着更重（参考对象 Salt / 网易云的底部抽屉也是实心）。 */
  background: var(--bg-base);
  box-shadow:
    var(--panel-sheen),
    0 -18px 44px -16px rgba(20, 28, 60, 0.34);
  color: var(--text-1);
  /* 圆角里的内容是列表，裁一下，免得行色/滚动条从圆角处漏出去 */
  overflow: hidden;
  animation: q-sheet-in 0.34s var(--ease-ios);
}

:root[data-theme="dark"] .q-sheet {
  /* 深色主题用面板那套深投影（黑 + 更大一点），与 --panel-shadow 口径一致 */
  box-shadow:
    var(--panel-sheen),
    0 -20px 46px -16px rgba(0, 0, 0, 0.6);
}

/* 从底部升起：位移与沉浸页那张 sheet（.im-sheet-enter-from）完全一致 ——
   全站“从下面上来”只有这一种动法；时长0.34s 比整页的 0.42s 短一档（这是个面板，不是整页） */
@keyframes q-sheet-in {
  from {
    transform: translateY(100%);
  }
}

/* 把手：既是“从底部上来的”信号，也是下滑收起的抓手（手势挂在这块 22px 高的区域上） */
.q-grip-area {
  flex: none;
  height: 22px;
  display: grid;
  place-items: center;
  /* 这块只用来拖，别让浏览器把它当成滚动手势的起点 */
  touch-action: none;
}

.q-grip {
  width: 36px;
  height: 4px;
  border-radius: 999px;
  background: var(--text-3);
  opacity: 0.5;
}

@media (prefers-reduced-motion: reduce) {
  .q-pop,
  .q-sheet,
  .q-scrim {
    animation: none;
  }
}
</style>
