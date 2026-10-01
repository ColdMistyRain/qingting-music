<script setup lang="ts">
import ImTitle from "@/components/immersive/ImTitle.vue";
import LyricsView from "@/components/immersive/LyricsView.vue";
import type { LyricLine } from "@/utils/lyrics";

/**
 * 布局二：沉浸歌词（纯歌词居中，不显示封面）。
 *
 * 版式参数取自原型 `.immersive.layout-center`（2026-09-29 定稿）：
 * 单列 `minmax(0, 720px)`、水平居中、标题与歌词都居中。
 * 与其他布局一样，**只管版式**：标题块与歌词引擎都是共享子组件（VS-09）。
 */
defineProps<{
  title: string;
  subtitle: string;
  /** 本布局不显示封面，但保留同样的 props 形状，让 `<component :is>` 能一视同仁地传参 */
  coverUrl: string | null;
  lines: LyricLine[];
  time: number;
  playing: boolean;
}>();

const emit = defineEmits<{ seek: [seconds: number] }>();
</script>

<template>
  <div class="center">
    <ImTitle class="tb" :title="title" :subtitle="subtitle" />
    <LyricsView class="ly" :lines="lines" :time="time" @seek="emit('seek', $event)" />
  </div>
</template>

<style scoped>
.center {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 18px;
  height: 100%;
  min-height: 0;
  padding: 0 24px;
}

.tb {
  width: min(720px, 92vw);
  text-align: center;
}

.ly {
  width: min(720px, 92vw);
  height: min(48vh, 440px);
}

/* 歌词行自带左对齐与左侧缩放基点（列表布局用的），这里按居中版式覆盖。
   用 :deep 是因为它们在 LyricsView 的 scoped 样式里——
   共享组件不该为某个布局把自己的样式写成可配置的（VS-09：布局只管自己的版式）。 */
.center :deep(.lyline) {
  text-align: center;
  transform-origin: center;
}

.center :deep(.ly-list) {
  text-align: center;
}

@media (max-width: 720px) {
  .ly {
    height: min(40vh, 320px);
  }
}
</style>
