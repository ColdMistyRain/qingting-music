<script setup lang="ts">
import type { Track } from "@qingting/shared";
import TrackRow from "@/components/TrackRow.vue";

/**
 * 曲目列表（v4.45，v4.90 简化）。
 *
 * 列表层面的东西只在这里写一次：曲目行 + 行与行之间的间距（间距在 `.row-list`）。
 * 历史：分隔线先是行自己的伪元素 → 再改成由本组件插入的独立 1px 元素（v4.45，
 * 为的是“这条线到底归谁”不再有歧义）；v4.90 曾整个删掉、改用间距；
 * v4.91 按需求方“窄列表不采取细线，宽列表采用细线”做成**按宽度自动切换**：
 * 元素常驻，宽屏（列展开）看得见，≤1024px（专辑列收起）由 CSS 隐掉；
 * v4.92 又对齐了设备像素：**行距与“线到上一行”都取 4 的倍数**（76 / 4），
 * 否则 125% 缩放下 1px 线的相位会循环，出现“有的细线粗有的细”（见 `global.css`）。
 */
withDefaults(
  defineProps<{
    tracks: readonly Track[];
    /** 正在播的那首用 id 判定：列表被搜索/排序后索引会错位 */
    activeId?: string | null;
    /** 纯浏览场景（如音乐库）不给移除按钮，删除入口统一在控制台（LB-05 / AD-02） */
    removable?: boolean;
    /** 行尾那枚收藏键（v5.96）。列表行不再放播放键之后，“最右那列”得有它该管的事 */
    showFavorite?: boolean;
    /** 这一首收藏了没 —— 由页面传入（行本身不碰 store，与 TrackRow 的同一套分工） */
    favoriteOf?: (track: Track) => boolean;
  }>(),
  {
    activeId: null,
    removable: true,
    showFavorite: false,
    favoriteOf: () => false,
  },
);

defineEmits<{
  play: [index: number];
  remove: [index: number];
  toggleFavorite: [index: number];
}>();
</script>

<template>
  <div class="row-list">
    <template v-for="(track, index) in tracks" :key="track.id">
      <!-- 宽屏可见、窄屏由 CSS 隐掉（v4.91）；归属明确是做成元素而不是伪元素的原因 -->
      <div v-if="index > 0" class="row-sep" aria-hidden="true" />
      <TrackRow
        :track="track"
        :index="index"
        :active="activeId === track.id"
        :removable="removable"
        :show-favorite="showFavorite"
        :favorite="favoriteOf(track)"
        @play="$emit('play', $event)"
        @remove="$emit('remove', $event)"
        @toggle-favorite="$emit('toggleFavorite', $event)"
      />
    </template>
  </div>
</template>
