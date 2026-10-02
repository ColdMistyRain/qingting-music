<script setup lang="ts">
import { computed } from "vue";
import { toPlaylistItem } from "@qingting/shared";
import IconHeartFill from "~icons/ph/heart-fill";
import IconHeartStraight from "~icons/ph/heart-straight";
import AppTooltip from "@/components/AppTooltip.vue";
import { useListeningStore } from "@/stores/listening";
import { usePlayerStore } from "@/stores/player";

/**
 * 沉浸页标题块（VS-09：三布局共享的子组件之一）。
 * 负责“歌名 + 歌手·专辑”，以及**这首歌的收藏键**。
 *
 * 为什么收藏键在这里（v5.98）：它是歌曲强相关的动作，而原先它在底部控制栏最右
 * （模式 / 走带 / **音量 + 收藏**）—— 左边一组只有模式键 22px、右边一组 64px，
 * 整个控制簇的中心因此比播放键偏右 21px（需求方：“按钮不对称难受”）。
 * 拿掉之后两边各 22px，播放键才真的落在进度条中心上（实测偏差 0）。
 */
defineProps<{
  title: string;
  subtitle: string;
}>();

/* 收藏（PS-05）：算的是“正在播的那一首”的引用（与歌单/历史同一套身份键）。
   与底部控制栏同一套分工：状态与动作都走 store，行只负责显示。 */
const player = usePlayerStore();
const listening = useListeningStore();
const currentItem = computed(() =>
  player.currentTrack ? toPlaylistItem(player.currentTrack) : null,
);
const isFavorite = computed(() => {
  const item = currentItem.value;
  return item !== null && listening.isFavorite(item);
});

function toggleFavorite(): void {
  const item = currentItem.value;
  if (item) void listening.toggleFavorite(item);
}
</script>

<template>
  <div class="im-tb">
    <div class="im-tb__head">
      <b :title="title">{{ title }}</b>
      <AppTooltip :label="isFavorite ? '取消收藏' : '收藏'">
        <button
          class="ctl im-tb__fav"
          :class="{ 'is-on': isFavorite }"
          :disabled="!player.hasTrack"
          :aria-pressed="isFavorite"
          @click="toggleFavorite"
        >
          <IconHeartFill v-if="isFavorite" class="icon" />
          <IconHeartStraight v-else class="icon" />
        </button>
      </AppTooltip>
    </div>
    <span :title="subtitle">{{ subtitle }}</span>
  </div>
</template>

<style scoped>
.im-tb {
  min-width: 0;
  /* 与歌词共用同一条横向留白：标题与歌词的左边界必须落在同一个 x（v4.88） */
  padding-inline: var(--im-text-pad-x);
}

/* 歌名与收藏键同一行：键跟在歌名右边（不是贴到最右）—— 长歌名先自己截断，
   键始终紧跟在它旁边。 */
.im-tb__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* 图标档位随沉浸页（与底部控制栏同一条 22px），不新开一档 */
.im-tb__fav {
  flex: none;
  --ctl-icon-size: 22px;
}

.im-tb__head b {
  min-width: 0;
  flex: 0 1 auto;
  font-size: clamp(20px, 3.2vh, 34px);
  font-weight: 800;
  line-height: 1.2;
  /* 长歌名不折行：折行会把歌词列整体推下去（VS-03 的版式只有一列文字） */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.im-tb span {
  display: block;
  margin-top: 6px;
  font-size: clamp(12px, 1.7vh, 15px);
  color: var(--text-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
