<script setup lang="ts">
import { computed } from "vue";
import { HoverCardContent, HoverCardPortal, HoverCardRoot, HoverCardTrigger } from "reka-ui";
import IconSpeakerHigh from "~icons/ph/speaker-high";
import IconSpeakerSlash from "~icons/ph/speaker-slash";
import Slider from "@/components/Slider.vue";
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
/** 触发键的无障碍名字（只有图标，名字不能丢）—— **不是**提示文字：
    这个键**故意不给提示**（v6.6 需求方：“音量按钮的 tooltip 可以去掉了”）：
    悬浮它的那一刻就已经弹出音量面板，提示再跟一条就是同一件事说两遍，
    而且面板底边离按钮只有 6px，提示正好压在面板上（实拍就是挡住滑杆下段）。
    库里的其余图标键没有这种“悬浮自带面板”的行为，提示照旧。 */
const label = computed(() => (silent.value ? "取消静音" : "静音"));
const sliderValue = computed(() => (silent.value ? 0 : player.volume));
const levelPercent = computed(() => (silent.value ? "0%" : `${Math.round(player.volume * 100)}%`));

/* ---------- 竖向拖拽交给 Slider（自绘，v4.64 / v5.68 抽成共用件） ----------
   原生 range 加 rotate(-90deg) 之后点击映射对、拖动不跟手（AGENTS 坑 7），
   所以音量与均衡器共用同一个自绘滑杆；这里只管把 0~1 的音量映射过去。 */
function setVolume(ratio: number): void {
  player.setVolume(Math.min(1, Math.max(0, ratio)));
}
</script>

<template>
  <HoverCardRoot :open-delay="120" :close-delay="140">
    <!-- ⚠️ `HoverCardTrigger as-child` 的**孩子必须是一个元素**，中间不能夹组件（v6.6 修）。
        v5.71 把提示写成了 `<HoverCardTrigger as-child><AppTooltip><button/></AppTooltip></HoverCardTrigger>`
        —— 触发器合并到的就是一个组件而不是按钮，提示的 Root 又把两边的 `pointerenter` 挤在一起：
        结果**提示正常、悬浮面板却永远不出现**（`*.vol-pop` 压根没进 DOM），
        这就是需求方说的“之前列表按钮那个问题”的同族（AGENTS 坑 25）。
        正确写法与 `QueuePopover` / `LyricsSourceMenu` 一致：触发器直接包按钮。
        本键**不挂提示**（悬浮就出面板，见上面 label 的注释）—— 但“孩子必须是元素”这条对
        将来给它加别的行为层同样成立。 -->
    <HoverCardTrigger as-child>
      <button class="vctl" :aria-label="label" @click="player.toggleMute()">
        <component :is="icon" class="icon" />
      </button>
    </HoverCardTrigger>

    <HoverCardPortal>
      <HoverCardContent
        class="vol-pop"
        side="top"
        :side-offset="10"
        role="group"
        aria-label="音量调节"
      >
        <Slider
          class="vol-pop__track"
          :model-value="sliderValue"
          :min="0"
          :max="1"
          :step="0.05"
          label="音量"
          :value-text="levelPercent"
          @update:model-value="setVolume"
        />
        <span class="vol-pop__value">{{ levelPercent }}</span>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
</template>

<style scoped>
/* 触发按钮：与两处的控件行同一套语言（颜色 / 尺寸）。
   它不在 Teleport 里，所以可以正常用 scoped。
   **悬浮不放大**（v4.66 需求方）：悬浮已经会开面板，面板就是反馈；
   再让按钮自己跳一下，鼠标刚落上去目标就变大，反而像在躲。
   只留颜色变化。播放条上那些只有图标的控件（播放 / 上一首 / 下一首）不动，
   它们除了放大没有别的反馈。 */
.vctl {
  color: var(--text-2);
  display: grid;
  place-items: center;
  transition: color 0.15s;
}

.vctl:hover {
  color: var(--text-1);
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
}

/* ⚠️ 进场动画必须挂在 `[data-state="open"]` 上，**不能写在基础类里**（v6.6 修，同 AGENTS 坑 24）：
   Reka 的 Presence 靠 `animationName` 判断“要不要等退场动画放完”—— 基础类上永远挂着一个
   `vol-in` 时，关闭那一刻它会去等一个**永远不来的 `animationend`**，于是节点不卸载：
   面板已经 `data-state="closed"` 却继续留在 DOM 里（实测离开 1.5s 后仍在）。
   收进 `[data-state="open"]` 之后，关闭态 `animationName` 为空 → 立刻卸载。 */
.vol-pop[data-state="open"] {
  animation: vol-in 0.18s var(--ease-ios);
}

@keyframes vol-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }
}

.vol-pop__track {
  /* 尺寸交给共用滑杆（--sld-*）；命中区比可见轨道宽那一点也在那里 */
  --sld-thickness: 18px;
  --sld-length: 84px;
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
