<script setup lang="ts">
import IconList from "~icons/ph/list";
import AppTooltip from "@/components/AppTooltip.vue";
import { useNavDrawer } from "@/composables/useNavDrawer";
import { MOBILE_QUERY, useMediaQuery } from "@/composables/useMediaQuery";

/**
 * 手机端抽屉的入口按钮（v5.35）。
 *
 * **渲染在页头里**（各页 `.page-head` 的第一个子元素），于是它天然与标题同一行、
 * 同一个基线 —— 页头住在滚动区外面，它也不会被列表滚走。
 * 不用 fixed 去“对齐”标题：那要靠猜标题的行高与页面内边距，改一处样式就会错位。
 */
const isMobile = useMediaQuery(MOBILE_QUERY);
const { open, toggle } = useNavDrawer();
</script>

<template>
  <AppTooltip v-if="isMobile" :label="open ? '收起侧栏' : '展开侧栏'">
    <button class="nav-toggle" aria-controls="nav-drawer" :aria-expanded="open" @click="toggle">
      <IconList class="icon" />
    </button>
  </AppTooltip>
</template>

<style scoped>
.nav-toggle {
  /* 与标题首行对齐：按标题的**行盒**居中（行盒高由页头给的两个变量算出），
     不用 flex 默认居中 —— 那会把按钮居到“标题 + 描述”整块的中线上。
     尺寸也全部来自页头变量（global.css 的 .page-head）：按钮、图标、描述缩进
     三者从同一组值派生，改一处三处一起变。 */
  align-self: flex-start;
  margin-top: calc(
    (var(--page-h1-size, 22px) * var(--page-h1-leading, 1.3) - var(--nav-toggle-size, 40px)) / 2
  );
  /* 不参与压缩：标题会被长文本挤，按钮得保持形状 */
  flex: none;
  display: grid;
  place-items: center;
  width: var(--nav-toggle-size, 40px);
  height: var(--nav-toggle-size, 40px);
  border-radius: var(--radius-control);
  color: var(--text-2);
  transition:
    color 0.15s,
    background 0.15s;
}

.nav-toggle:hover {
  color: var(--text-1);
  background: var(--hover);
}

.nav-toggle .icon {
  width: var(--nav-toggle-icon, 26px);
  height: var(--nav-toggle-icon, 26px);
}
</style>
