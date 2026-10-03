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
  /** 翻译歌词行（v6.40，网易 tlyric）：与 lines 同时间轴，可为空数组 */
  translations?: LyricLine[];
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
      <LyricsView
        class="ly"
        :lines="lines"
        :translations="translations"
        :time="time"
        @seek="emit('seek', $event)"
      />
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

/* 歌词窗口：双栏下给它一个稳定高度，居中的位移才是可预期的 */
.ly {
  height: min(46vh, 420px);
}

@media (prefers-reduced-motion: reduce) {
  /* 减少动态效果：缩放的“过程”去掉，但状态本身还看得出来（直接到位） */
  .cover {
    transition: none;
  }
}

/* 窄屏（RT-08 的最小照顾）：封面与歌词上下叠，不做两栏硬挤。
   ⚠️ 两行的**行高规则**是这里的要紧处（v6.15）：
   - 封面那行 `auto`：它按自己的宽度（含 vh）定高；
   - 右侧那行 `minmax(0, 1fr)`：拿走**剩下的高度** —— 写 `auto` 的话行高就等于内容高，
     而 `.ly` 原先是 `min(38vh, 300px)` 的固定高度，在 375×667（iPhone SE）上
     整个 `.right` 比 `.im-body` 高出 48px，而 `.im-body` 不裁剪 ——
     歌词窗口的下半截就画到了**进度条背后**（实测 `.ly-view` 底 597，`.im-body` 底 549）。
   - 所以 `.ly` 在窄屏改成“吃剩余空间”（`flex: 1` + `min-height: 0`），只有下限、没有固定高。 */
@media (max-width: 720px) {
  .duo {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: clamp(12px, 2.6vh, 20px);
    padding: 0 16px;
  }

  /* 封面：`26vh` 让**矮屏自动收一档**（667 → 173px；844 的机器还给到 203px 上下，
     几乎不变），框住高度的同时不再与歌词抢地方 */
  .cover {
    width: min(52vw, 26vh, 220px);
  }

  .right {
    min-height: 0;
    gap: clamp(10px, 2vh, 18px);
  }

  .ly {
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
  }
}

/* 横屏手机（RT-06）：宽够、高不够 —— 上下叠会把封面顶出屏幕。
   这里回到两栏（封面在左、歌词在右），但封面尺寸改由**高度**派生：
   `34vh` 在 375px 高的屏上只有 127px，比竖屏的 220px 小得多，正好塞进上下两条控件之间。
   ⚠️ 横屏也属于“高不够”，所以下面这条同样要把歌词改成吃剩余空间。 */
@media (max-width: 767px) and (orientation: landscape) {
  .duo {
    grid-template-columns: min(38vh, 220px) minmax(0, 1fr);
    /* 只有一列不写行模板时，隐式行是 `auto` = 按内容定高 —— 内容比容器高就照样溢出去，
       显式写成 `minmax(0, 1fr)` 才把右列按在容器高度里 */
    grid-template-rows: minmax(0, 1fr);
    gap: 24px;
  }

  .cover {
    width: 100%;
  }

  .ly {
    /* 横屏也是“高不够”：这里同样吃剩余空间，别用固定 vh（375 高的屏上 46vh 只有 172px，
       但真正该守的是“不许超过容器”，而不是某个具体高度） */
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
  }
}
</style>
