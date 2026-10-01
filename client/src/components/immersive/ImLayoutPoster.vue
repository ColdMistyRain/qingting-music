<script setup lang="ts">
import IconMusicNotes from "~icons/ph/music-notes";
import ImTitle from "@/components/immersive/ImTitle.vue";
import LyricsView from "@/components/immersive/LyricsView.vue";
import type { LyricLine } from "@/utils/lyrics";

/**
 * 布局三：海报背景（彩胶，VS-09 的第三形态，PRD 3.9④/⑤ 配方）。
 *
 * 歌词在左，右上角悬一张大彩胶唱片，盘面颜色跟着封面走（VS-02 管线）。
 * 与其他两个布局一样**只管版式与专属视觉层**：标题块与歌词引擎仍是共享子组件。
 *
 * 颜色：JS 一个内联 background 都不写（原型踩过两次坑，PRD 反复强调）——
 * 盘体漩涡、外圈光晕的填色、边缘环全部由 `--cover-src` 在 CSS 里用 OKLCH 相对颜色派生。
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
  <div class="poster" :class="{ 'is-playing': playing }">
    <!-- 彩胶：外壳（不转·不裁剪）> 旋转盘（转·圆形裁剪）> 盘体/纹理/标签，高光挂外壳内 -->
    <div class="poster__art" aria-hidden="true">
      <div class="vinyl-assembly">
        <div class="v-disc">
          <div class="v-vinyl"></div>
          <div class="v-texture"></div>
          <div class="v-label">
            <img v-if="coverUrl" :src="coverUrl" alt="" />
            <IconMusicNotes v-else class="v-label__ph" />
          </div>
        </div>
        <div class="v-gloss"></div>
      </div>
    </div>

    <div class="poster__col">
      <ImTitle :title="title" :subtitle="subtitle" />
      <LyricsView class="ly" :lines="lines" :time="time" @seek="emit('seek', $event)" />
    </div>
  </div>
</template>

<style scoped>
.poster {
  position: relative;
  display: flex;
  align-items: center;
  height: 100%;
  min-height: 0;
  padding: 0 24px;
}

/* ---------- 彩胶装配 ----------
   DOM 对齐 PRD v4.2 定稿：外壳 .vinyl-assembly（不转、不裁剪——光晕是它的 ::before，
   要溢出到盘外 1.4 倍；边缘环是 ::after）> 旋转盘 .v-disc（转 + 圆形裁剪，纹理的
   overlay 混合只在盘内生效）> 盘体/纹理/标签；高光 .v-gloss 挂外壳内、压在盘上，
   因为**光源固定**，它不跟着盘转。
   定位三变量收敛在 .poster__art 上，只用来摆外壳。 */
.poster__art {
  --vinyl-t: -27vh;
  --vinyl-r: -19vw;
  /* 盘径不但受高度限，还得受宽度限：16:9 屏上 90vh 会把盘体顶到歌词嘴边
     （实测 1226×935 下盘左缘 618px / 歌词列右缘 613px，只差 5px） */
  --vinyl-d: min(86vh, 62vw);
  position: absolute;
  inset: 0;
  z-index: 0;
  /* 装配占满整块版心，别挡住歌词行的点击 seek（歌词在 z-2） */
  pointer-events: none;
}

.vinyl-assembly {
  position: absolute;
  top: var(--vinyl-t);
  right: var(--vinyl-r);
  width: var(--vinyl-d);
  aspect-ratio: 1;
  /* 混合模式只在这个壳里生效，不外溢到页面 */
  isolation: isolate;
}

/* ::before = 外圈光晕。官方素材本身是浅灰的——灰色没有意义，有意义的是它的 alpha 分层：
   当 mask 用、再填色，才得到跟着封面配色走的**有机**柔光（box-shadow 做不出这种不规则衰减）。 */
.vinyl-assembly::before {
  content: "";
  position: absolute;
  inset: -20%;
  z-index: -1;
  background: var(--cv1);
  background: oklch(from var(--cover-src) clamp(0.52, calc(l + 0.04), 0.68) clamp(0.07, c, 0.15) h);
  -webkit-mask: url("../../assets/vinyl/glow.png") center / contain no-repeat;
  mask: url("../../assets/vinyl/glow.png") center / contain no-repeat;
}

/* 呼吸只在播放时挂上：**暂停时没有动画 = opacity 回到 1（最亮帧）**。
   若改成 animation-play-state: paused，暂停会停在呼吸到一半的暗帧（PRD 3.9 动效表要求）。 */
.poster.is-playing .vinyl-assembly::before {
  animation: v-breathe 3.4s ease-in-out infinite;
}

/* ::after = 盘缘内阴影环：一圈白边 + 向内晕开的深色，给盘体厚度 */
.vinyl-assembly::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.45);
  box-shadow: inset 0 0 26px oklch(from var(--cover-src) 0.3 clamp(0.07, c, 0.15) h / 0.26);
}

.v-disc {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  overflow: hidden;
  isolation: isolate;
  will-change: transform;
  animation: v-spin 8s linear infinite;
  /* 暂停＝停在当前角度（像真的转盘停下），所以用 play-state 而不是撤掉动画 */
  animation-play-state: paused;
}

.poster.is-playing .v-disc {
  animation-play-state: running;
}

/* 盘体：同一源色只做 Tone 漩涡（--vinyl-gradient 在 tokens.css 派生），那就是彩胶质感 */
.v-vinyl {
  position: absolute;
  inset: 0;
  background: var(--vinyl-gradient);
}

/* 大理石纹理：官方 shadow@2x，overlay 提亮 */
.v-texture {
  position: absolute;
  inset: 0;
  background: url("../../assets/vinyl/emboss.png") center / cover no-repeat;
  mix-blend-mode: overlay;
  opacity: 0.6;
}

/* 中心标签 = 真实封面（PRD：原型用取色渐变代替，M1 换 <img>） */
.v-label {
  position: absolute;
  inset: 21%;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background: radial-gradient(circle at 40% 36%, var(--cv1), var(--cv2) 78%);
  color: rgba(255, 255, 255, 0.7);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.5),
    0 0 0 3.5px color-mix(in oklab, var(--cover-deep) 20%, transparent),
    0 0 0 5px rgba(255, 255, 255, 0.34),
    0 8px 22px -8px color-mix(in oklab, var(--cover-deep) 50%, transparent);
}

.v-label img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.v-label__ph {
  width: 26%;
  height: 26%;
}

/* 固定光源高光：深反光 + 白纹槽两张**必须叠在同一元素上**做 overlay——
   两张各自的透明通道都太薄（α 中位仅 8~9/255），分开互相看不见，叠一起才凑出盘面光泽。
   不随盘旋转：光源是固定的。 */
.v-gloss {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: 50%;
  overflow: hidden;
  pointer-events: none;
  mix-blend-mode: overlay;
  background:
    url("../../assets/vinyl/base.png") center / cover no-repeat,
    url("../../assets/vinyl/grooves.png") center / cover no-repeat;
}

/* ---------- 版式 ----------
   本布局**不再自己加一层方向性遮罩**（原型有一层左实右虚的全页渐变）：
   ① 页面已有统一的薄雾保证文字可读（与双栏/居中同一套），再叠一层是把可读性理由用得过度；
   ② 那层渐变淡到 70% 位置，实测会把彩胶左侧掠掉一层白，看着像盘面疆了；
   ③ 彩胶最左的鼓包在右上角（它的圆心在画面外），与歌词列天然错开，不需要额外压暗。
   简约优先（v4.30）：能用一层说清的可读性，不加第二层。 */
.poster__col {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
  width: min(540px, 46vw);
  /* 与彩胶拉开层次（原型值） */
  margin-left: clamp(0px, 4vw, 64px);
  min-width: 0;
}

/* 歌词窗口：与其他布局一样给个固定高度，居中的位移才是可预期的 */
.ly {
  height: min(46vh, 420px);
}

@keyframes v-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes v-breathe {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.72;
  }
}

@media (prefers-reduced-motion: reduce) {
  .v-disc,
  .poster.is-playing .vinyl-assembly::before {
    animation: none;
  }
}

/* 窄屏（RT-08 的最小照顾）：彩胶退到右上角变小，歌词占据下方整宽 */
@media (max-width: 720px) {
  .poster {
    padding: 0 16px;
  }

  .poster__art {
    --vinyl-t: -18vh;
    --vinyl-r: -24vw;
    --vinyl-d: min(56vh, 76vw);
  }

  .poster__col {
    width: 100%;
    margin-left: 0;
    justify-content: flex-end;
    padding-bottom: 4px;
  }

  .ly {
    height: min(34vh, 280px);
  }
}
</style>
