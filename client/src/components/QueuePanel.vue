<script setup lang="ts">
import IconBroom from "~icons/ph/broom";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconX from "~icons/ph/x";
import AppTooltip from "@/components/AppTooltip.vue";
import { usePlayerStore } from "@/stores/player";
import { confirmAction } from "@/utils/confirm";
import { formatTime } from "@/utils/format";

/**
 * 播放队列的**内容**（PL-06）：标题行 + 清空 + 列表。
 *
 * 壳层由调用方给（见 QueuePopover.vue）：桌面是贴着触发器弹出的浮层（Reka Popover），
 * 手机是从底部升起的半屏抽屉（Reka Dialog）。**内容只有这一份** ——
 * 行配方、删除键、播放中标识都写在这里，两边不会再各自长出一套。
 *
 * 壳层要提供 `--q-pad`（面板水平内边距）：列表拿它做负外边距，把滚动条推到面板边缘。
 *
 * 这里可以用 `scoped`（与壳层相反）：本组件的 class 全部由**自己**渲染，元素一定带自己的
 * data-v；踩坑的是"给别人（Reka/其他组件）的元素写样式"，那种才必须写非 scoped 全局样式。
 */
const player = usePlayerStore();
const emit = defineEmits<{ close: [] }>();

/** 清空是破坏性操作（队列没了要一首首重新加）→ 走统一确认入口（开发约定） */
async function askClear(): Promise<void> {
  const count = player.queue.length;
  const ok = await confirmAction({
    title: "清空播放队列？",
    description: `队列里的 ${count} 首会全部移除，播放同时停止；不会删除任何歌曲文件。`,
  });
  if (!ok) return;
  player.clear();
  emit("close");
}
</script>

<template>
  <div class="q-panel">
    <header class="q-head">
      <b>当前播放</b>
      <span class="q-count">{{ player.queue.length }} 首</span>
      <button class="btn q-clear" :disabled="player.queue.length === 0" @click="askClear">
        <IconBroom class="icon" />
        清空
      </button>
    </header>

    <p v-if="player.queue.length === 0" class="q-empty">
      队列是空的，从本地播放或音乐库选一首歌就会出现在这里。
    </p>

    <ul v-else class="q-list">
      <li
        v-for="(track, index) in player.queue"
        :key="track.id"
        class="q-item"
        :class="{ current: index === player.currentIndex }"
      >
        <button class="q-main" :title="`播放 ${track.title}`" @click="player.playAt(index)">
          <!-- 正在播放标识（PL-06）：当前曲目显示播放/暂停图标，其余显示序号 -->
          <span class="q-mark">
            <template v-if="index === player.currentIndex">
              <component :is="player.playing ? IconPause : IconPlay" class="icon" />
            </template>
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="q-tb">
            <b>{{ track.title }}</b>
            <span>{{ track.artist }}</span>
          </span>
          <span class="q-dur">{{ formatTime(track.duration ?? 0) }}</span>
        </button>
        <AppTooltip :label="`从队列移除 ${track.title}`">
          <button class="q-del" @click="player.removeAt(index)">
            <IconX class="icon" />
          </button>
        </AppTooltip>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* 撑满壳层的高度（`flex: 1` + `min-height: 0`）：
   浮层里壳层高度由内容撑、上限 max-height，短的队列不会被拉高；
   抽屉里壳层是固定 50vh，列表于是把剩余高度全吃掉。一份配方两种壳层都对。 */
.q-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.q-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 6px;
  flex: none;
}

.q-head b {
  font-size: 13px;
}

.q-count {
  font-size: 11.5px;
  color: var(--text-3);
  margin-right: auto;
}

.q-clear {
  padding: 5px 10px;
  font-size: 12px;
}

.q-clear .icon {
  width: 14px;
  height: 14px;
}

.q-empty {
  padding: 18px 10px 20px;
  font-size: 12.5px;
  color: var(--text-3);
  line-height: 1.6;
}

/* 列表自己滚（不用 Reka 的 ScrollArea）：滚动条要走全站那套自绘样式，
   两套滚动条会打架。Reka 在这里提供的是行为（关闭/焦点），不是滚动条。
   滚动条贴面板边缘：负外边距吃掉面板的右内边距，让滚动条落进面板的留白区，
   再用等量内边距把行缩回来（行右边缘到边框的距离不变）——
   与列表页 .page-frame__scroll 同一套做法。
   不这么做时滚动条会“悬”在右留白中间，看起来行宽与面板内宽不一致
   （需求方实拍：“有点抽象，两个宽度最好一致”）。 */
/* 行节奏：紧凑浮层用自己的间距（6px）——没有间距时，悬浮态与“播放中”的底色
   会直接贴在一起（需求方：“这个挨的有点紧了”）。
   主列表那边是“宽屏 6px + 细线 / 窄屏 13px”（v4.91），两者行距一致；
   浮层算窄列表，不画线。
   用 flex 列 + gap（**不要**给行加 margin：那样首尾会多出半格，滚动时也不好算）。 */
.q-list {
  list-style: none;
  overflow-y: auto;
  /* 吃掉壳层剩余高度；min-height: 0 是滚动能生效的前提（否则被内容撑开、滚不动） */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-right: calc(var(--q-pad, 10px) * -1);
  padding-right: var(--q-pad, 10px);
}

.q-item {
  display: flex;
  align-items: center;
  border-radius: var(--radius-row);
  /* 列方向 flex 里要显式禁止收缩，否则行会被压矮 */
  flex: none;
}

.q-item:hover {
  background: var(--hover);
}

.q-main {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 46px;
  align-items: center;
  gap: 10px;
  padding: 7px 4px 7px 8px;
  text-align: left;
}

.q-mark {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  display: grid;
  place-items: center;
}

.q-mark .icon {
  width: 15px;
  height: 15px;
}

.q-tb {
  min-width: 0;
}

.q-tb b {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.q-tb span {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-3);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.q-dur {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.q-del {
  flex: none;
  display: grid;
  place-items: center;
  padding: 7px 10px;
  color: var(--text-3);
  opacity: 0;
  transition: opacity 0.15s;
}

.q-del .icon {
  width: 15px;
  height: 15px;
}

.q-item:hover .q-del,
.q-del:focus-visible {
  opacity: 1;
}

.q-del:hover {
  color: var(--danger);
}

/* 当前曲目：主题色 + 稍强底色，与"正在播放"图标一起把位置说清（PL-06） */
.q-item.current .q-mark,
.q-item.current .q-tb b {
  color: var(--accent);
}

/* 当前曲目：底色铺在**整行**上，宽度与悬浮态一致（需求方：“正在播放的和悬浮选中的
   长度要一样”）。原来铺在 .q-main 上 —— 那里不含右侧删除键那块，看着就比悬浮态短一截。
   写在 .q-item 上、且排在 :hover 之后，保证“播放中的行”悬停时仍然是主题色。 */
.q-item.current {
  background: var(--accent-soft);
}

/* ---------- 手机：只有底部抽屉一种壳层（浮层是桌面专用的） ----------
   这里行要按**主列表**的尺寸来，而不是浮层的紧凑尺寸：
   半屏抽屉就是手机上的“当前播放列表”，12.5px 在这个高度里显得太小。
   同时把删除键常显 —— 触屏没有 hover，`opacity: 0` 等于这枚键在手机上不存在
   （需求方实拍里整列 × 都是隐形的）。 */
@media (max-width: 767px) {
  .q-tb b {
    font-size: 14px;
  }

  .q-tb span,
  .q-dur,
  .q-mark {
    font-size: 12px;
  }

  .q-main {
    grid-template-columns: 24px minmax(0, 1fr) 48px;
    padding: 9px 4px 9px 8px;
  }

  .q-del {
    opacity: 1;
    padding: 9px 12px;
  }

  .q-del .icon {
    width: 17px;
    height: 17px;
  }
}
</style>
