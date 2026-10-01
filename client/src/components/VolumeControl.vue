<script setup lang="ts">
import { computed } from "vue";
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

function onVolume(event: Event): void {
  player.setVolume(Number((event.target as HTMLInputElement).value) / 100);
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
        <div class="vol-pop__track">
          <input
            class="vol-pop__range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="sliderValue"
            :style="{ '--p': levelPercent }"
            aria-label="音量"
            @input="onVolume"
          />
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
   材质用**实底**而不是 chrome 玻璃：它浮在播放条上，背后是平坦底色，没有内容可模糊，
   玻璃在这只会变成"看不见的一圈描边"（实拍发现的回归）；
   队列弹层因为背后有滚动列表，仍然用 chrome 玻璃。
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
  background: var(--plane-2);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
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
  width: 18px;
  height: 84px;
}

/* 竖放：原生滑杆旋转 -90°，样式仍走 tokens.css 里那套自绘轨道与主题色填充。
   居中不能靠 place-items（对超出容器的滑杆不生效，会偏到右侧），
   改为绝对定位 + 负 margin 先摆正，再绕自身中心旋转。 */
.vol-pop__range {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 84px;
  height: 6px;
  margin: -3px 0 0 -42px;
  transform: rotate(-90deg);
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
