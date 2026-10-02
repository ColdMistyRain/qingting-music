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
    <div class="poster__col">
      <ImTitle :title="title" :subtitle="subtitle" />
      <LyricsView class="ly" :lines="lines" :time="time" @seek="emit('seek', $event)" />
    </div>

    <!-- 彩胶：外壳（不转·不裁剪）> 旋转盘（转·圆形裁剪）> 盘体/纹理/标签，高光挂外壳内；
         光晕是装配的**兄弟节点** .vinyl-glow（比盘大 40%，要溢出盘外）——理由见下方样式。
         唱臂是第三个兄弟：它要盖在盘上（z-index），又不能跟着盘转。
         v5.85：彩胶从“右上角溢出的背景”改成**自己一列**（需求方：“改成左边歌词右边胶”）
         —— 唱臂的支点在盘外右上方，盘不完整就没地方放它。 -->
    <div class="poster__art" aria-hidden="true">
      <div class="vinyl-glow"></div>

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

      <!-- 唱臂：外层 .tonearm-box 与盘**同框**（都是 left/bottom 对齐的盘径方块），
           于是下面那些百分数全是“盘径的百分比”，与素材自带的坐标一一对应：
           支点 = 盘的 90% / 5%，臂长 = 盘径的 75%，落下 -4° / 抬起 -15°。
           底座 .arm-base 不随臂转（拧在盘外面），臂体 .tonearm__arm 只做摆动。 -->
      <div class="tonearm-box">
        <div class="tonearm">
          <img class="tonearm__arm" src="../../assets/vinyl/arm.png" alt="" />
        </div>
        <img class="arm-base" src="../../assets/vinyl/arm-base.png" alt="" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.poster {
  /* 左歌词 / 右彩胶（v5.85）：两列真的并排 —— 从前是“歌词 + 一张从右上角溢出去的背景盘”，
     盘被窗口裁掉一半，唱臂就没地方站（支点在盘外右上方）。 */
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: clamp(20px, 4vw, 64px);
  height: 100%;
  min-height: 0;
  padding: 0 clamp(16px, 2.6vw, 40px);
}

/* ---------- 彩胶装配 ----------
   DOM 对齐 PRD v4.2 定稿：外壳 .vinyl-assembly（不转、不裁剪——边缘环是它的 ::after）>
   旋转盘 .v-disc（转 + 圆形裁剪，纹理的 overlay 混合只在盘内生效）> 盘体/纹理/标签；
   高光 .v-gloss 挂外壳内、压在盘上，因为**光源固定**，它不跟着盘转。
   光晕 .vinyl-glow 与唱臂 .tonearm-box 都是装配的**兄弟节点**：光晕要溢出盘外 20%，
   唱臂要盖在盘上又不能跟着盘转 —— 塞进外壳里不是被裁就是跟着转。

   v5.85 把“右上角溢出”的定位整个删掉了：盘有自己的栅格列，位置由版式给，**不留任何
   按窗口百分比算的偏移** —— 也就不会再现 v4.75 那种“三个变量三种缩放率、缩放窗口时
   盘到处跑”的问题（那条修的是症状，这条去掉了病因）。
   画布比盘大一圈（右 8% / 上 10%）：上边留给配重（臂体从盘的 -6.5% 起），
   右边留给抬起时的针尖（-15° 时落在盘的 105% 处）。 */
.poster__art {
  /* 盘径：一条 vmin 驱动（宽高平滑跟随，不在两种模式间跳）；
     `40vw` 是给又宽又矮的窗口的安全网，`560px` 是给大屏的绝对上限（页面文字是定值 px）。 */
  --vinyl-d: min(56vh, 40vw, 560px);
  --art-top: calc(var(--vinyl-d) * 0.1);
  --art-right: calc(var(--vinyl-d) * 0.08);
  position: relative;
  width: calc(var(--vinyl-d) + var(--art-right));
  height: calc(var(--vinyl-d) + var(--art-top));
  z-index: 0;
  /* 装饰层：别挡住歌词行的点击 seek（歌词在 z-2） */
  pointer-events: none;
}

/* 盘与唱臂对齐同一个方块的**左下角**（盘在左，留白在上与右），两者同框同尺寸 ——
   于是内层那些百分数全都是“盘径的百分比”，与参照实现的坐标一一对应。 */
.vinyl-assembly,
.tonearm-box {
  position: absolute;
  left: 0;
  bottom: 0;
  width: var(--vinyl-d);
  aspect-ratio: 1;
}

.vinyl-assembly {
  /* 混合模式只在这个壳里生效，不外溢到页面 */
  isolation: isolate;
}

/* 外圈光晕。官方素材本身是浅灰的——灰色没有意义，有意义的是它的 alpha 分层：
   当 mask 用、再填色，才得到跟着封面配色走的**有机**柔光（box-shadow 做不出这种不规则衰减）。
   位置与尺寸全部从盘径派生（与外壳同源），比盘大 40% —— 它就是那个“要溢出”的东西。
   它**随盘旋转**（v5.24 按原型与 3.9 动效表补上漏掉的 disc-spin 那一半：素材形状不规则，
   转起来才看得出）。旋转与盘同频同向（8s/圈），所以两者相对关系不变，只是那团柔光自己在缓慢流动。 */
.vinyl-glow {
  position: absolute;
  left: calc(var(--vinyl-d) * -0.2);
  bottom: calc(var(--vinyl-d) * -0.2);
  width: calc(var(--vinyl-d) * 1.4);
  aspect-ratio: 1;
  background: var(--cv1);
  background: oklch(from var(--cover-src) clamp(0.52, calc(l + 0.04), 0.68) clamp(0.07, c, 0.15) h);
  -webkit-mask: url("../../assets/vinyl/glow.png") center / contain no-repeat;
  mask: url("../../assets/vinyl/glow.png") center / contain no-repeat;
  animation: v-spin 8s linear infinite;
  /* 暂停＝停在当前角度（像真的转盘停下）——与 .v-disc 同一套语义 */
  animation-play-state: paused;
}

/* 呼吸只在播放时挂上：**暂停时没有呼吸动画 = opacity 回到 1（最亮帧）**。
   若把呼吸也改成 animation-play-state: paused，暂停会停在呼吸到一半的暗帧（PRD 3.9 动效表要求）。
   所以这里写两条 animation：旋转常驻（暂停时冻结），呼吸只随播放挂上。 */
.poster.is-playing .vinyl-glow {
  animation:
    v-spin 8s linear infinite,
    v-breathe 3.4s ease-in-out infinite;
  animation-play-state: running, running;
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

/* ---------- 唱臂（v5.85） ----------
   素材是需求方指定的那张（参照实现 `01-colorfull/assets/arm@2x.png` → `assets/vinyl/arm.png`，
   130×600；底座 `ArmBottom@2x.png` → `arm-base.png`，84×116）。
   几何全部对应素材自带的坐标（都是“盘径的百分比”）：支点在盘的 90% / 5%、
   臂体高 = 盘径的 75%、臂体自身的旋转轴心在图片的 61.9% / 15.3%（就是那张图里轴承圆心的
   位置）—— 两个 transform-origin 因此重合：“整臂绕支点转”与“臂体自己轻摆”用的是同一个点。
   角度：抬起 -15°（针在盘外）、落针 -4°（针落在外圈纹槽上，够不到中间那张封面）；
   0.9s 与 cubic-bezier(0.34, 1.1, 0.4, 1) 也是参照实测的“过冲一点但很快稳”。
   **不抄它的 arm-sway**（落针后持续轻摆）：那是装饰，不承载信息（简约优先）。 */
.tonearm {
  position: absolute;
  inset: 0;
  z-index: 5;
  transform-origin: 90% 5%;
  transform: rotate(-15deg);
  transition: transform 0.9s cubic-bezier(0.34, 1.1, 0.4, 1);
}

.poster.is-playing .tonearm {
  transform: rotate(-4deg);
}

.tonearm__arm {
  position: absolute;
  left: 79.9%;
  top: -6.5%;
  height: 75%;
  /* 只给高，宽交给图片自己的比例（130 / 600）—— 这样图片盒与素材坐标系严格同比，
     上面那个 61.9% / 15.3% 的轴心才真的落在支点上。 */
  width: auto;
  transform-origin: 61.9% 15.3%;
  filter: drop-shadow(0 8px 16px rgba(6, 10, 20, 0.5));
}

/* 底座：不随臂转，拧在盘外右上角（圆心 = 支点）。图是 84×116，所以宽 10.5% 时高 14.5%，
   `top: -2.25%` 就是“圆心落在支点上”（5% − 14.5% / 2）—— 与素材同一套数，别自己凑。 */
.arm-base {
  position: absolute;
  left: 84.75%;
  top: -2.25%;
  z-index: 4;
  width: 10.5%;
  height: auto;
}

/* ---------- 版式 ----------
   两列：歌词在左、彩胶在右（v5.85），两边都是真列 —— 从前是“歌词 + 一张从右上角溢出去的
   背景盘”。本布局**不再自己加一层方向性遮罩**（原型有一层左实右虚的全页渐变）：
   ① 页面已有统一的薄雾保证文字可读（与双栅/居中同一套），再叠一层是把可读性理由用得过度；
   ② 那层渐变淡到 70% 位置，实测会把彩胶左侧掠掉一层白，看着像盘面疆了；
   ③ 盘现在是完整一张、与歌词各占一边，更不需要额外压暗。
   简约优先（v4.30）：能用一层说清的可读性，不加第二层。 */
.poster__col {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 18px;
  width: 100%;
  /* 歌词不跟着窗口无限拉宽：留给彩胶的是栅格的 gap，不是把一行字拉成一条 */
  max-width: min(560px, 46vw);
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
  .vinyl-glow,
  .poster.is-playing .vinyl-glow {
    animation: none;
  }

  /* 唱臂落下是**状态**（播放/暂停），不是循环动效，所以保留，只去掉那 0.9s 的过渡 */
  .tonearm {
    transition: none;
  }
}

/* 窄屏（RT-08 的最小照顾）：两列摆不下（字会被压成一条），改成盘在上、歌词在下，
   盘仍然是完整的（唱臂也照旧工作）。 */
@media (max-width: 720px) {
  .poster {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    justify-items: center;
    gap: 12px;
    padding: 6px 16px 0;
  }

  .poster__art {
    /* 窄屏只改盘径：画布尺寸与所有偏移都是它的派生值，不用也不能再手写一份
       ——否则又是“三方各自漂移”的老毛病 */
    --vinyl-d: min(34vmin, 52vw, 260px);
  }

  .poster__col {
    width: 100%;
    max-width: none;
    justify-content: flex-start;
  }

  .ly {
    height: min(30vh, 260px);
  }
}
</style>
