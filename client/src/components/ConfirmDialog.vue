<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";
import { answerConfirm, currentConfirm } from "@/utils/confirm";
import { isTopLayer, popTopLayer, pushTopLayer } from "@/utils/topLayer";

/**
 * 应用内确认对话框（v5.53，VS-04 的确认语言）。
 *
 * 需求方：“在点击清空列表按钮后能否弹出我们自己对话框。”——原生 `confirm()` 在这套界面里
 * 格格不入（系统白框、样式不可改、挡住整个标签页），而且手机上根本没得调。
 *
 * 这里只负责**渲染**：请求从 `utils/confirm` 的队列里来，答案经 `answerConfirm()` 送回去。
 * 所以它挂在 `App.vue`（全站一份），页面里谁也不用管弹窗，只写 `await confirmAction({...})`。
 *
 * 行为层用 Reka Dialog（铁律 1）：焦点锁在对话框里、Esc / 点遮罩关闭、关闭后焦点归还、
 * `aria-modal` 与背景 `aria-hidden` 都是它给的；样式全部自己写。
 * ⚠️ 样式写在**非 scoped** 的 `<style>` 里：Teleport 到 body 之后 Vue 的 scoped 属性不跟过去
 * （v4.60 实测：class 在、选择器带 [data-v-x] 永远匹配不上）；隔离靠 `cf-` 前缀。
 *
 * 两个按钮的顺序与默认焦点是**故意**的：取消在前、打开时焦点落在取消上 ——
 * 破坏性动作里“回车 = 确定”太容易误删，安全默认是“回车 = 取消”（macOS 同款）。
 */
const open = computed(() => currentConfirm.value !== null);
const request = computed(() => currentConfirm.value);

/** 上面那层是谁由 topLayer 登记处说了算：它决定 Esc 该不该由我们吃掉 */
let layerId: number | null = null;

const cancelRef = ref<HTMLButtonElement | null>(null);
let focusFrame = 0;

/**
 * 把焦点放到“取消”上（打开时 + 每换一条请求）。
 *
 * ⚠️ 实测踩坑（v5.53）：最初只写了一次 `cancelRef.focus()`，结果焦点**仍在背后的触发按钮上**
 * （实测 activeElement 是页面上那颗“清空列表”）。真因不在这里，而在样式：关闲态的
 * `.cf-card` 是 `visibility: hidden`，而 `transition: visibility .2s` 这种“离散属性按时长过渡”
 * 的写法会让**打开后的前 100ms 它仍是 hidden**，而对 hidden 元素调 `focus()` 会**静默失败**。
 * 修法见样式里的 `visibility 0s 0.2s`（显示立即、隐藏延迟）；这里再留一次下一帧复核兜底。
 */
function focusCancel(): void {
  if (!open.value) return;
  cancelRef.value?.focus();
  cancelAnimationFrame(focusFrame);
  focusFrame = requestAnimationFrame(() => {
    if (open.value && document.activeElement !== cancelRef.value) cancelRef.value?.focus();
  });
}

watch(
  () => request.value?.id,
  async (id) => {
    if (id === undefined) {
      if (layerId !== null) {
        popTopLayer(layerId);
        layerId = null;
      }
      return;
    }
    if (layerId === null) layerId = pushTopLayer();
    await nextTick();
    focusCancel();
  },
  { immediate: true },
);

/** 用户的答案。Esc / 点遮罩 / 点取消都是 Cancel —— 三条路径都走这里 */
function answer(accepted: boolean): void {
  answerConfirm(accepted);
}

/**
 * Esc：**捕获阶段**挂 window，只处理“我是最上面那层”的情况。
 *
 * 沉浸页在 window 上听 Esc（收起整页）、手机上队列抽屉也在 window 捕获阶段听 ——
 * 三个监听都在同一目标上，靠注册顺序不可控（v5.40 实测：按一下把抽屉和整页一起关了）。
 * 现在由 topLayer 判定谁在最上面，最上面的那层吃掉事件（`stopPropagation`），下面的层放行。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!open.value || event.key !== "Escape") return;
  if (layerId === null || !isTopLayer(layerId)) return;
  event.stopPropagation();
  answer(false);
}

/**
 * 默认焦点给“取消”（安全默认：回车不会误删）。
 * 挂 Reka 的 `open-auto-focus`：它每次打开都会补发一次，比自己猜时序可靠（`force-mount` 下也如此）。
 */
function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
  focusCancel();
}

/**
 * 容器上的回车也算取消。
 * 焦点落在某个键上时（Tab 到了取消/确定）就交给那个键 —— 回车 = 按那颗键；
 * 落在对话框容器上时，回车不能“什么都没选就溜走”，安全默认仍是取消。
 */
function onCardKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter") return;
  if ((event.target as HTMLElement | null)?.closest("button")) return;
  event.preventDefault();
  answer(false);
}

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown, true);
  cancelAnimationFrame(focusFrame);
  if (layerId !== null) {
    popTopLayer(layerId);
    layerId = null;
  }
});
</script>

<template>
  <DialogRoot
    :open="open"
    @update:open="
      (value) => {
        if (!value) answer(false);
      }
    "
  >
    <DialogPortal>
      <!-- force-mount：常驻 DOM 才能播收起动画（v5.50 同款做法）。
           关闭态的可见性与点击全由 CSS 拿走，其中 `visibility: hidden` **不能省** ——
           `opacity: 0` 不等于不可点，透明遮罩会把整页点击都拦掉（v5.50 实测踩过）。 -->
      <DialogOverlay class="cf-scrim" force-mount />

      <DialogContent
        class="cf-card"
        force-mount
        @open-auto-focus="onOpenAutoFocus"
        @keydown="onCardKeydown"
      >
        <DialogTitle class="cf-title">{{ request?.title }}</DialogTitle>
        <!-- Reka 的 Dialog 对 Title 与 Description **都有**要求（缺任一条都会告警）。
             没有额外说明时给一条屏读专用的描述，别让 a11y 缺一块。 -->
        <DialogDescription v-if="request?.description" class="cf-desc">
          {{ request.description }}
        </DialogDescription>
        <DialogDescription v-else class="sr-only"> 这一步需要你确认后才会执行。 </DialogDescription>

        <div class="cf-actions">
          <button ref="cancelRef" type="button" class="btn" @click="answer(false)">
            {{ request?.cancelText }}
          </button>
          <button
            type="button"
            class="btn"
            :class="request?.tone === 'primary' ? 'btn-primary' : 'btn-danger'"
            @click="answer(true)"
          >
            {{ request?.confirmText }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
/* ⚠️ 非 scoped：内容被 Teleport 到 body，scoped 的 [data-v-x] 不会跟过去（v4.60）。 */
.cf-scrim {
  position: fixed;
  inset: 0;
  /* 比队列抽屉（95/96）更上一层：确认框永远在最上面 */
  z-index: 100;
  /* 全站只有一种“后面还有东西”的压暗（与左抽屉、队列抽屉共用 --scrim） */
  background: var(--scrim);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  /* visibility 是离散属性，现代引擎按“过渡进行到一半才翻转”处理（实测 Firefox 如此）——
     所以两个方向要分开写：**隐藏**等淡出播完（延迟 = 时长），**显示**立即生效。
     否则打开后的前半个过渡期里元素仍是 hidden：`focus()` 会静默失败（实测取消键聚焦不上）。 */
  transition:
    opacity 0.2s var(--ease-ios),
    visibility 0s 0.2s;
}

.cf-scrim[data-state="open"] {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition:
    opacity 0.2s var(--ease-ios),
    visibility 0s;
}

/* 居中不用 transform（那样会和入场位移打架）：inset: 0 + margin: auto 就能两个方向居中 */
.cf-card {
  position: fixed;
  inset: 0;
  margin: auto;
  z-index: 101;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(360px, 92vw);
  height: fit-content;
  max-height: min(80vh, 460px);
  padding: 20px 22px 18px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--glass-border);
  /* 材质取“大面”那一档（--tray-*，与手机左抽屉同一档）而不是小浮层的 --panel-*：
     对话框背后常常是**成片的正文**（队列抽屉的文字、列表页的标题），
     0.52 的半透明会让两层文字叠在一起糊成一片（v5.53 实测：手机抽屉上弹确认框时最明显）。
     投影仍旧用方向中性的 --panel-shadow（--tray-shadow 是朝右的，那是抽屉专用）。 */
  background: var(--tray-bg);
  backdrop-filter: var(--tray-blur);
  -webkit-backdrop-filter: var(--tray-blur);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  opacity: 0;
  visibility: hidden;
  transform: translateY(8px) scale(0.98);
  transition:
    opacity 0.2s var(--ease-ios),
    transform 0.2s var(--ease-ios),
    visibility 0s 0.2s;
}

.cf-card[data-state="open"] {
  opacity: 1;
  visibility: visible;
  transform: none;
  transition:
    opacity 0.2s var(--ease-ios),
    transform 0.2s var(--ease-ios),
    visibility 0s;
}

.cf-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--text-1);
}

.cf-desc {
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-2);
}

.cf-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

@media (max-width: 480px) {
  /* 手机上两个键各占一半：大拇指在地带里更好点，也不会因为标题换行而挤成两行 */
  .cf-actions .btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
