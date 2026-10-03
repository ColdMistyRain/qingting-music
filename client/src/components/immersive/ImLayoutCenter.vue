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

/* 标题那一行是 **flex**（歌名 + 收藏键），而 `text-align` 管不到 flex items ——
   上面 `.tb` 的 `text-align: center` 只让歌手行居中，歌名与心形键还是贴在左边缘
   （v6.24 需求方圈图：“这个标题应该也居中吧”；实测标题中心 x=126 / 容器中心 195）。
   歌名定长超长时由自己的 `flex: 0 1 auto` + 省略号处理，整组居中不影向它。 */
.center :deep(.im-tb__head) {
  justify-content: center;
}

@media (max-width: 720px) {
  .ly {
    /* 吃剩余空间（而不是 `min(40vh, 320px)` 的固定高）：
       固定 vh 在矮屏（iPhone SE 667）上会把歌词窗口顶出 `.im-body`，
       下半截画到进度条背后（v6.15 实测）。`max-height` 只用来在**高**屏上收住留白。 */
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
    max-height: min(48vh, 440px);
  }
}
</style>
