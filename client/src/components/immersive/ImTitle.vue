<script setup lang="ts">
/**
 * 沉浸页标题块（VS-09：三布局共享的子组件之一）。
 * 只负责"歌名 + 歌手·专辑"，定位与外边距由布局组件给（布局决定它在哪）。
 */
defineProps<{
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <div class="im-tb">
    <b :title="title">{{ title }}</b>
    <span :title="subtitle">{{ subtitle }}</span>
  </div>
</template>

<style scoped>
.im-tb {
  min-width: 0;
}

.im-tb b {
  display: block;
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
