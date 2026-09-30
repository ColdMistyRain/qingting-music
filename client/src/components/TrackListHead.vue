<script setup lang="ts">
/**
 * 曲目列表表头（v4.38）。
 *
 * 只做“标签 + 对齐”：列宽读与 `TrackRow` 同一份全局 `--row-grid`，两边不会错位；
 * 排序/筛选入口统一放在工具栏，不往表头塞第二套交互语言（表头是说明，不是控件）。
 * 列表为空时不渲染——空态本身已经把“还没有歌”说清楚了。
 */
</script>

<template>
  <div class="list-head">
    <span />
    <span>曲目</span>
    <span class="list-head__album">专辑</span>
    <span>来源</span>
    <span>时长</span>
    <span />
  </div>
</template>

<style scoped>
/* 窄屏专辑列让位：与 TrackRow 同一断点（栅格由全局 --row-grid 同步收窄） */
@media (max-width: 1024px) {
  .list-head__album {
    display: none;
  }
}
</style>
