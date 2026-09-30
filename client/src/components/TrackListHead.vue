<script setup lang="ts">
/**
 * 曲目列表表头（v4.38）。
 *
 * 只做“标签 + 对齐”：列宽读与 `TrackRow` 同一份全局 `--row-grid`，两边不会错位；
 * 排序/筛选入口统一放在工具栏，不往表头塞第二套交互语言（表头是说明，不是控件）。
 * 第一格跨过封面列：封面不是“可读的信息列”，没必要在它头上留一段空位，
 * “曲目”直接与封面左边对齐。
 * 列表为空时不渲染——空态本身已经把“还没有歌”说清楚了。
 */
</script>

<template>
  <div class="list-head">
    <span class="list-head__title">曲目</span>
    <span class="list-head__album">专辑</span>
    <span>来源</span>
    <span>时长</span>
  </div>
</template>

<style scoped>
/* 跨过封面列（第 1 列）落到歌名列（第 2 列），标签左边缘与封面一致 */
.list-head__title {
  grid-column: 1 / 3;
}

/* 窄屏专辑列让位：与 TrackRow 同一断点（栅格由全局 --row-grid 同步收窄） */
@media (max-width: 1024px) {
  .list-head__album {
    display: none;
  }
}
</style>
