<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
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
 * 封面动效（v4.71 需求方定稿）：**卡片式 3D 倾斜**，静置时微微斜侧，
 * 鼠标悬浮跟着指针改方位；原来的“呼吸浮动”按需求方意见去掉。
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

/* 封面倾斜：JS 只写**原始指针位置**（--mx/--my ∈ 0~1），角度在 CSS 里派生——
   与取色管线同一条原则（JS 注原始值，调校留在 CSS）。 */
const wrapRef = ref<HTMLElement | null>(null);
const mx = ref(0.5);
const my = ref(0.5);
let frame = 0;
/** 最新的指针位置（0~1，已夹取）；rAF 只负责“应用”，不负责“取值” */
let pending: { x: number; y: number } | null = null;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function onPointerMove(event: PointerEvent): void {
  // 系统开了“减少动态效果”就不跟指针（静置的斜侧姿态仍保留）
  if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
    return;
  const rect = wrapRef.value?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;
  // **先记下最新位置，再节流**：把取值放进 rAF 回调会丢掉同一帧内的最后一次移动，
  // 表现是“指针已经移到别处、卡片还停在旧方位”（实测：移到 85% 处只读到 0.33）。
  pending = {
    x: clamp01((event.clientX - rect.left) / rect.width),
    y: clamp01((event.clientY - rect.top) / rect.height),
  };
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!pending) return;
    mx.value = pending.x;
    my.value = pending.y;
    pending = null;
  });
}

/** 指针离开回到静置姿态（平滑回去交给 CSS 的 transition） */
function onPointerLeave(): void {
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  pending = null;
  mx.value = 0.5;
  my.value = 0.5;
}

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
});
</script>

<template>
  <div class="duo">
    <div
      ref="wrapRef"
      class="cover-wrap"
      @pointermove="onPointerMove"
      @pointerleave="onPointerLeave"
    >
      <div class="cover" :style="{ '--mx': mx, '--my': my }">
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
  /* 3D 倾斜需要透视：没有它 rotateX/Y 只会被压扁，不是“斜侧” */
  perspective: 1000px;
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
  /* 静置姿态（-5deg 微微斜侧）+ 指针带来的偏移。角度在 CSS 里派生：
     - rotateX 为正时**下边靠向观看者**，所以抬头要取负；
     - rotateY 为正时**右边转进去**，所以指针在右要取负。
     系数小（10~12deg）是为了“像一张卡片轻轻侧着”，不是炫技。 */
  --dx: calc((0.5 - var(--mx, 0.5)) * 12deg);
  --dy: calc((var(--my, 0.5) - 0.5) * 10deg);
  transform: rotateX(calc(1.5deg + var(--dy))) rotateY(calc(-5deg + var(--dx)));
  transition: transform 0.45s var(--ease-ios);
  will-change: transform;
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
  /* 静置的斜侧姿态保留（它只是“摆法”），但不跟指针、不改动 */
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
