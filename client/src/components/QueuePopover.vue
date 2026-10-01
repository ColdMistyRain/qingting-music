<script setup lang="ts">
import { ref } from "vue";
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from "reka-ui";
import IconBroom from "~icons/ph/broom";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconX from "~icons/ph/x";
import { usePlayerStore } from "@/stores/player";
import { confirmAction } from "@/utils/confirm";
import { formatTime } from "@/utils/format";

/**
 * 播放队列弹层（PL-06）。
 *
 * 行为层交给 Reka UI 的 Popover（v4.59 定稿）：打开/关闭、点外部关闭、Esc、焦点归还、
 * 与触发器的位置计算（含碰撞避让）全都不用自己写——这正是"复杂交互件用 Reka UI"（铁律 1）的意义。
 * 样式仍然全部自己写（Reka 是无样式行为层，不引带样式的组件库）。
 *
 * 触发按钮由**调用方**通过 #trigger 插槽传入：它属于播放条那套控件（`.ctl`），
 * 样式留在 PlayerBar，别在这里复制一份。
 */
const player = usePlayerStore();
const open = ref(false);

/** 清空是破坏性操作（队列没了要一首首重新加）→ 走统一确认入口（开发约定） */
function askClear(): void {
  if (!confirmAction("清空播放队列？")) return;
  player.clear();
  open.value = false;
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent class="q-pop" side="top" align="end" :side-offset="10">
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
            <button
              class="q-main"
              :title="`播放 ${track.title}`"
              @click="player.playAt(index)"
            >
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
            <button
              class="q-del"
              :title="`从队列移除 ${track.title}`"
              @click="player.removeAt(index)"
            >
              <IconX class="icon" />
            </button>
          </li>
        </ul>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
/* 浮层材质用 chrome 配方（--chrome-bg / --chrome-blur，Apple Music 实测值）：
   这是"内容会从它下面经过"的层，玻璃在这里才真的成立（v4.55 结论）。 */
.q-pop {
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: min(390px, 92vw);
  max-height: min(60vh, 470px);
  padding: 10px 10px 8px;
  border-radius: var(--radius-panel);
  background: var(--chrome-bg);
  backdrop-filter: var(--chrome-blur);
  -webkit-backdrop-filter: var(--chrome-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow);
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

.q-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 6px;
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
   两套滚动条会打架。Reka 在这里提供的是行为（关闭/焦点），不是滚动条。 */
.q-list {
  list-style: none;
  overflow-y: auto;
  min-height: 0;
  padding-right: 2px;
}

.q-item {
  display: flex;
  align-items: center;
  border-radius: var(--radius-row);
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

.q-item.current .q-main {
  background: var(--accent-soft);
  border-radius: var(--radius-row);
}

@media (prefers-reduced-motion: reduce) {
  .q-pop {
    animation: none;
  }
}
</style>
