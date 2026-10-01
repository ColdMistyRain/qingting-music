<script setup lang="ts">
import IconMusicNotes from "~icons/ph/music-notes";
import ImTitle from "@/components/immersive/ImTitle.vue";
import LyricsView from "@/components/immersive/LyricsView.vue";
import type { LyricLine } from "@/utils/lyrics";

/**
 * 布局一：经典双栏（封面左 · 标题/歌词右，VS-03 的主形态）。
 *
 * 本组件只负责**版式与专属视觉层**（VS-09）：栅格与封面造型；
 * 标题块与歌词引擎是共享子组件，这里只是摆放。
 *
 * 封面动效（v4.89，对照 AMLL 的 `react-full/Cover` 重做）：
 * - 封面**摆正**（平面、等比方形），只有一层柔和投影；
 * - 状态靠**缩放**表达：暂停时缩小一点点、投影一并收紧（AMLL 的 `musicPaused` 做法，
 *   也是 Apple Music 播/停时的那个缩放），带回弹曲线（`cubic-bezier(.3,.2,.2,1.4)`）。
 * - v4.71~v4.88 那个“静置 5° 斜侧 + 指针跟随”已去掉：参考实现里封面都是平的，
 *   3D 倾斜是电视/影音类封面的语言，不是音乐播放器的。
 * VS-04 的“缓慢旋转”仍是彩胶盘（海报布局）的形态。
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
      <!-- 暂停就缩一点（状态靠“形”说），class 只表达状态，数值在 CSS 里 -->
      <div class="cover" :class="{ paused: !playing }">
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
  /* 摆正：封面不旋转、不跟随指针。状态只在**大与小**之间走（见下方 .paused）。
     回弹曲线取自 AMLL 的 Cover（`cubic-bezier(.3,.2,.2,1.4)`）——播/停那一下带一点弹性，
     比线性缩放“活”，又不会像 3D 倾斜那样喧宾夺主。 */
  transform: scale(1);
  transition:
    transform 0.5s cubic-bezier(0.3, 0.2, 0.2, 1.4),
    box-shadow 0.5s ease;
}

/* 暂停：封面缩一点、投影跟着收紧（AMLL 的 `musicPaused` 做法，也是 Apple Music 的形态）。
   幅度取 0.9 而不是它的 0.75：我们的封面铺满一个固定栅格列，缩太狠会在列里剩一大块空。 */
.cover.paused {
  transform: scale(0.9);
  box-shadow: 0 16px 40px -18px rgba(0, 0, 0, 0.5);
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
  /* 减少动态效果：缩放的“过程”去掉，但状态本身还看得出来（直接到位） */
  .cover {
    transition: none;
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
