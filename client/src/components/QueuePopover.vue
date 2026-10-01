<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  DialogContent,
  DialogDescription,
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
import { isTopLayer, popTopLayer, pushTopLayer } from "@/utils/topLayer";

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
 * 沉浸页在 `window` 上听 Esc（收起整页）、确认对话框也在 `window` 上听（关对话框）——
 * 三个监听同在 `window`，按注册顺序跑不可控。所以这里：开抽屉时在 `utils/topLayer` 登记，
 * 处理按键前先问“我是不是最上面那层”—— 不是就放行（让上面的对话框去关）。
 * 是最上面那层时挂**捕获阶段**监听并 `stopPropagation()`，下面的沉浸页就收不到（v5.40）。
 */
const layerId = ref<number | null>(null);
watch(open, (isOpen) => {
  if (isOpen && layerId.value === null) layerId.value = pushTopLayer();
  else if (!isOpen && layerId.value !== null) {
    popTopLayer(layerId.value);
    layerId.value = null;
  }
});

function onKeydown(event: KeyboardEvent): void {
  if (!isMobile.value || !open.value || event.key !== "Escape") return;
  if (layerId.value === null || !isTopLayer(layerId.value)) return;
  event.stopPropagation();
  open.value = false;
}

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown, true);
  if (layerId.value !== null) popTopLayer(layerId.value);
});
</script>

<template>
  <!-- 桌面：贴着触发器弹出的浮层 -->
  <PopoverRoot v-if="!isMobile" v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent class="q-pop" side="top" align="end" :side-offset="10" force-mount>
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
      <!-- force-mount 两个（v5.50）：Reka 的 Dialog 默认“一关就卸载”，于是只有进场动画、
           收起时会直接消失（需求方：“歌曲列表收回是没有过渡动画”）。
           留着不卸载、用 data-state 驱动过渡，两个方向就都有动画了。
           关闭态的可见性与点击由下面 CSS 的 visibility/pointer-events 拿走。 -->
      <DialogOverlay class="q-scrim" force-mount />
      <DialogContent class="q-sheet" force-mount>
        <!-- 无障碍名字与描述：视觉上由面板里的“当前播放”承担。
             ⚠️ 两个都要给：Reka 的 DialogContent 缺 DialogTitle **或** DialogDescription
             都会在控制台告警（Popover 没有这条要求）—— 只在浏览器里看 error 会漏掉它。 -->
        <DialogTitle class="sr-only">播放队列</DialogTitle>
        <DialogDescription class="sr-only">
          查看当前播放队列，可切换曲目，或把某一首移出队列。
        </DialogDescription>

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
  /* 进出场都改成**状态驱动的过渡**（原来是只播一次的 `animation: q-in`）：
     Reka 的 Popover 默认一关就卸载，根本没有能播退场动画的元素 —— 于是加了 `force-mount`
     把节点留在 DOM 里，而 `animation` 只会在挂载那一次播，所以进出场交给 `data-state` 驱动。
     只做 `opacity`：面板带 `backdrop-filter`，动 transform 会让浏览器每帧重算模糊
     （v5.54 确认框就是这么改的，同一个道理）；为了一点点“弹一下”不值得每秒重算几十次。
     `visibility: hidden` 必须写：关闭态 `opacity: 0` **不等于不可点**，否则面板会隐形地
     压住播放条右下角那一片（v5.50 的遮罩就是这么拦住全页点击的）。 */
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    visibility 0s 0.18s;
}

.q-pop[data-state="open"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 0.18s var(--ease-ios),
    visibility 0s;
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
  /* 与左抽屉、确认对话框同一档遮罩：全站只有一种“后面还有东西”的压暗（--scrim） */
  background: var(--scrim);
  /* 与抽屉同时长（下面 .q-sheet 的 0.34s），一升一降看着是一层。
     ⚠️ `visibility: hidden` 不能省：遮罩现在 force-mount 常驻 DOM（为了收起动画），
        而 `opacity: 0` **不等于不可点** —— 少了这一句，关闭态的透明遮罩会拦住整页的点击
        （实测：列表里的行都点不动了）。visibility 是离散属性，会在过渡结束时才隐藏。 */
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity 0.34s var(--ease-ios),
    visibility 0s 0.34s;
}

.q-scrim[data-state="open"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 0.34s var(--ease-ios),
    visibility 0s;
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
  /* 材质：**面板玻璃那一档**（--panel-bg / --panel-blur，与队列浮层同一套）——
     它背后是沉浸页本身（明亮 + 封面光晕），所以透得出去、也不显脏。
     与左侧抽屉的 --tray-* **故意不同档**：那套是为“背后是被遮罩压暗的页面 + 成片正文”
     定的，要实一档才不显脏、不会比页面上的岛暗（v5.45/5.46 的两次反馈都出在那里）。
     这里曾明确写成实心面，理由是背后那排走带键会透出轮廓（实测 0.94 遮盖度下仍能认出来，
     且模糊在某些环境不参与合成）；那条问题现在用“打开时把控件与进度行淡出”解决了
     （见下面 `body:has(.q-sheet)` 那条），于是 0.88/0.80 那种保守透度反而看不出玻璃
     （v5.49 需求方：“并没有过分的透，甚至看不出来透”）。“透”的底气来自两件事：
     遮罩压暗 + 背后控件已淡出。 */
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  box-shadow:
    var(--panel-sheen),
    0 -18px 44px -16px rgba(20, 28, 60, 0.34);
  color: var(--text-1);
  /* 圆角里的内容是列表，裁一下，免得行色/滚动条从圆角处漏出去 */
  overflow: hidden;
  /* 开合都走过渡（v5.50）：base 态是“收在屏幕外”，[data-state="open"] 才是升起后的位置。
     visibility 按“隐藏等淡出播完（延迟 = 时长）、显示立即生效”分开写（v5.53 修正）：
     它是离散属性，现代引擎按“过渡过半才翻转”处理 —— 两个方向用同一个时长的话，
     打开后的前半个过渡期里元素仍是 hidden（不参与合成的截图里就是“半天升不上来”，
     而且 `focus()` 会静默失败）。 */
  transform: translateY(100%);
  visibility: hidden;
  transition:
    transform 0.34s var(--ease-ios),
    visibility 0s 0.34s;
}

.q-sheet[data-state="open"] {
  transform: translateY(0);
  visibility: visible;
  transition:
    transform 0.34s var(--ease-ios),
    visibility 0s;
}

:root[data-theme="dark"] .q-sheet {
  /* 深色主题用面板那套深投影（黑 + 更大一点），与 --panel-shadow 口径一致 */
  box-shadow:
    var(--panel-sheen),
    0 -20px 46px -16px rgba(0, 0, 0, 0.6);
}

/* 从底部升起：位移与沉浸页那张 sheet（.im-sheet-enter-from）完全一致 ——
   全站“从下面上来”只有这一种动法；时长 0.34s 比整页的 0.42s 短一档（这是个面板，不是整页） */

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
  .q-pop {
    animation: none;
  }

  .q-sheet,
  .q-scrim {
    transition: none;
  }
}

/* 队列抽屉打开时，把沉浸页那排走带键与进度行**淡出**（v5.48）：
   它们正好落在玻璃背后，不挪开就会透出轮廓（模糊不参与合成时尤其明显，
   实测 0.94 遮盖度下仍能认出那几个键）。被抽屉盖住的东西本来也看不见，
   所以这一步在视觉上零代价，只是把玻璃背后变干净。
   ⚠️ 选择器要带 [data-state="open"]：抽屉现在 force-mount 常驻 DOM（为了收起动画），
      不带状态的话关闭后控件会被永久淡出。
   用 `:has()` 而不是共享状态：`.q-sheet` 只在手机端存在（浮层是另一套壳），
   所以桌面浮层不会误触；真不支持 :has() 的环境只是少一层润色，玻璃仍能用。 */
body:has(.q-sheet[data-state="open"]) .im-ctrls,
body:has(.q-sheet[data-state="open"]) .im-progress {
  opacity: 0;
}
</style>
