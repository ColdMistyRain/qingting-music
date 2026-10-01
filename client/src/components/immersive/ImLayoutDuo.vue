<script setup lang="ts">
import IconMusicNotes from "~icons/ph/music-notes";
import ImTitle from "@/components/immersive/ImTitle.vue";
import LyricsView from "@/components/immersive/LyricsView.vue";
import type { LyricLine } from "@/utils/lyrics";

/**
 * 布局一：经典双栏（封面左 · 标题/歌词右，VS-03 的主形态）。
 *
 * 本组件只负责**版式与专属视觉层**（VS-09）：栅格、封面造型与呼吸动效（VS-04）；
 * 标题块与歌词引擎是共享子组件，这里只是摆放。
 */
defineProps<{
  title: string;
  subtitle: string;
  coverUrl: string | null;
  lines: LyricLine[];
  time: number;
  playing: boolean;
}>();

const emit = defineEmits<{ seek: [seconds: number] }>();
</script>

<template>
  <div class="duo">
    <div class="cover-wrap">
      <div class="cover" :class="{ 'is-playing': playing }">
        <img v-if="coverUrl" :src="coverUrl" :alt="`${title} 封面`" />
        <IconMusicNotes v-else class="icon" />
      </div>
    </div>

    <div class="right">
      <ImTitle :title="title" :subtitle="subtitle" />
      <LyricsView class="ly" :lines="lines" :time="time" @seek="emit('seek', $event)" />
    </div>
  </div>
</template>

<style scoped>
.duo {
  display: grid;
  grid-template-columns: clamp(200px, 34vh, 420px) minmax(0, clamp(280px, 36vw, 620px));
  gap: clamp(32px, 6vw, 120px);
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  min-height: 0;
  height: 100%;
}

.cover-wrap {
  display: grid;
  place-items: center;
}

.cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  overflow: hidden;
  display: grid;
  place-items: center;
  /* 没有封面时不空着：用主题色渐变兜底，与列表里的占位同一套语言 */
  background: radial-gradient(circle at 32% 30%, var(--cv1), var(--cv2) 78%);
  color: rgba(255, 255, 255, 0.7);
  box-shadow: 0 24px 60px -22px rgba(0, 0, 0, 0.55);
}

.cover .icon {
  width: 34%;
  height: 34%;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* VS-04 封面动效：方形封面用**呼吸浮动**而不是旋转（转一块方图不好看），
   播放中才动、暂停即停（animation-play-state），并遵循 prefers-reduced-motion。 */
.cover.is-playing {
  animation: cover-breathe 4.5s ease-in-out infinite;
}

@keyframes cover-breathe {
  0%,
  100% {
    transform: translateY(-6px) scale(1);
  }
  50% {
    transform: translateY(6px) scale(1.012);
  }
}

.right {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
  min-width: 0;
  height: 100%;
}

/* 歌词窗口：双栏下给它一个固定高度，居中的位移才是可预期的 */
.ly {
  height: min(46vh, 420px);
}

@media (prefers-reduced-motion: reduce) {
  .cover.is-playing {
    animation: none;
  }
}

/* 窄屏（RT-08 的最小照顾）：封面与歌词上下叠，不做两栏硬挤 */
@media (max-width: 720px) {
  .duo {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    padding: 0 16px;
  }

  .cover {
    width: min(56vw, 220px);
  }

  .ly {
    height: min(38vh, 300px);
  }
}
</style>
