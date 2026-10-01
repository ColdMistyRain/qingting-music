<script setup lang="ts">
import { computed, ref } from "vue";
import { HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from "reka-ui";
import IconSpeakerHigh from "~icons/ph/speaker-high";
import IconSpeakerSlash from "~icons/ph/speaker-slash";
import { usePlayerStore } from "@/stores/player";

/**
 * 音量控件（PL-04）—— 播放条与沉浸页**共用这一个**。
 *
 * 需求方 v4.62：「歌词页面的音量条风格和主页保持一致」。
 * 教训：同一个控件在两处各写一套，一定会走偏（沉浸页那套横向滑杆就是这么来的），
 * 所以这里只保留一份实现，两处都只是把它摆进自己的控件行。
 *
 * - 交互：点击 = 静音 / 取消静音；悬浮或键盘聚焦 = 展开竖向音量条（开合交给 Reka HoverCard）；
 * - 静音语义（PL-04）：音量为 0 与"点了静音键"是同一件事，图标 / 读数 / 滑杆必须一致；
 *   静音时滑杆与读数按 0 显示，但**视觉样式保持正常**（清灰/降透明度会被当成"点不了"）；
 * - 图标尺寸随宿主：调用方用 `--ctl-icon-size` 覆盖（播放条 21px，沉浸页 22px）。
 */
const player = usePlayerStore();

const silent = computed(() => player.muted || player.volume === 0);
const icon = computed(() => (silent.value ? IconSpeakerSlash : IconSpeakerHigh));
const sliderValue = computed(() => (silent.value ? 0 : player.volume));
const levelPercent = computed(() => (silent.value ? "0%" : `${Math.round(player.volume * 100)}%`));

/* ---------- 竖向拖拽：自绘，不用旋转的原生 range（v4.64） ----------
   原生 range 旋转 -90° 之后，**点击映射是对的、但拖动不跟手**：
   Chrome 用未旋转的几何算拖动位移，指针从底部拖到顶部值只动了 1%
   （实测；需求方报的“无法拖拽”就是这个）。旋转写法本身撑不住，改成自绘：
   与播放条的进度条同一套 pointer 交互，向上 = 变大。 */
const trackRef = ref<HTMLElement | null>(null);
const dragging = ref(false);

function ratioFromPointer(event: PointerEvent): number {
  const rect = trackRef.value?.getBoundingClientRect();
  if (!rect || rect.height <= 0) return sliderValue.value;
  return Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height));
}

function onDown(event: PointerEvent): void {
  trackRef.value?.setPointerCapture(event.pointerId);
  dragging.value = true;
  player.setVolume(ratioFromPointer(event));
}

function onMove(event: PointerEvent): void {
  if (!dragging.value) return;
  player.setVolume(ratioFromPointer(event));
}

function onUp(event: PointerEvent): void {
  if (!dragging.value) return;
  dragging.value = false;
  trackRef.value?.releasePointerCapture(event.pointerId);
}

/** 键盘也自己接：原生 range 的键盘能力随旋转一起放弃了 */
function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 0.1 : 0.05;
  let next: number | null = null;
  if (event.key === "ArrowUp" || event.key === "ArrowRight") next = sliderValue.value + step;
  else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = sliderValue.value - step;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = 1;
  if (next === null) return;
  event.preventDefault();
  player.setVolume(Math.min(1, Math.max(0, next)));
}
</script>

<template>
  <HoverCardRoot :open-delay="120" :close-delay="140">
    <HoverCardTrigger as-child>
      <button
        class="vctl"
        :title="silent ? '取消静音' : '静音'"
        :aria-label="silent ? '取消静音' : '静音'"
        @click="player.toggleMute()"
      >
        <component :is="icon" class="icon" />
      </button>
    </HoverCardTrigger>

    <HoverCardPortal>
      <HoverCardContent
        class="vol-pop"
        side="top"
        :side-offset="4"
        role="group"
        aria-label="音量调节"
      >
        <div
          ref="trackRef"
          class="vol-pop__track"
          role="slider"
          tabindex="0"
          aria-label="音量"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(sliderValue * 100)"
          :aria-valuetext="levelPercent"
          aria-orientation="vertical"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
          @keydown="onKeydown"
        >
          <div class="vol-pop__fill" :style="{ height: `${sliderValue * 100}%` }" />
          <div class="vol-pop__thumb" :style="{ bottom: `${sliderValue * 100}%` }" />
        </div>
        <span class="vol-pop__value">{{ levelPercent }}</span>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
</template>

<style scoped>
/* 触发按钮：与两处控件行同一套语言（颜色 / 悬浮 / 尺寸）。
   它不在 Teleport 里，所以可以正常用 scoped。 */
.vctl {
  color: var(--text-2);
  display: grid;
  place-items: center;
  transition:
    color 0.15s,
    transform 0.1s;
}

.vctl:hover {
  color: var(--text-1);
  transform: scale(1.08);
}

.vctl .icon {
  width: var(--ctl-icon-size, 21px);
  height: var(--ctl-icon-size, 21px);
}
</style>

<style>
/* ---------- 音量悬浮面板（PL-04） ----------
   开合、延迟、"鼠标从按钮移到面板上"的判定全部交给 Reka HoverCard（v4.60）：
   ::after 透明桥接与 ::before 手写小三角都已退役；小三角在 v4.61 按要求拿掉
   （面板底边离按钮只有 4px，箭头反而多一层噪音）。
   材质：用浮层面板材质（--panel-*，仍是玻璃，只是比底下的播放条更实一档）。
   v4.60 一度改成实底，理由是"背后是平坦底色、没有内容可模糊"——真因其实是
   面板与它下面的播放条用了**同一个填充值**，同色叠同色等于没画（v4.63 修正）。
   按材质阶梯来：页面底 → 岛/播放条（--chrome-*） → 弹出的临时面板（--panel-*）。
   ⚠️ 必须是非 scoped 块：面板被 Reka Teleport 到 body，Vue 的 scoped 属性不会跟过去，
   带 [data-v-x] 的规则永远匹配不上（v4.60 实测：class 在、样式不生效）。
   隔离靠 .vol-pop* 前缀，不进全局命名空间。 */
.vol-pop {
  z-index: 70;
  display: grid;
  justify-items: center;
  gap: 6px;
  /* 横向内边距与最小宽度都是"收窄面板"的旋钮：面板只需容下 18px 滑杆与
     "100%"读数，宽出一截都是空白（v4.61 需求方："音量条窄一点"）。 */
  padding: 14px 8px 10px;
  min-width: 46px;
  border-radius: var(--radius-control);
  background: var(--panel-bg);
  backdrop-filter: var(--panel-blur);
  -webkit-backdrop-filter: var(--panel-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--panel-sheen), var(--panel-shadow);
  transform-origin: bottom center;
  animation: vol-in 0.18s var(--ease-ios);
}

@keyframes vol-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }
}

.vol-pop__track {
  position: relative;
  /* 命中区比可见轨道宽：6px 的细条不好抓（面板宽度已经收窄过，这里再给点余量） */
  width: 18px;
  height: 84px;
  cursor: pointer;
  touch-action: none;
}

.vol-pop__fill {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 6px;
  margin-left: -3px;
  border-radius: 99px;
  background: var(--accent);
}

.vol-pop__thumb {
  position: absolute;
  left: 50%;
  width: 13px;
  height: 13px;
  margin-left: -6.5px;
  border-radius: 50%;
  background: var(--accent);
  /* bottom 是“值的位置”，所以要把滑块自身往上提半格才对齐 */
  transform: translateY(50%);
}

.vol-pop__track:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 99px;
}

.vol-pop__value {
  font-size: 11px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .vol-pop {
    animation: none;
  }
}
</style>
