<script setup lang="ts">
import { ref } from "vue";
import IconMusicNotes from "~icons/ph/music-notes";
import ImTitle from "@/components/immersive/ImTitle.vue";
import LyricsView from "@/components/immersive/LyricsView.vue";
import { useBeat } from "@/composables/useBeat";
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

/** 节奏起伏（v5.90 / v5.91）：`--beat` 写在本布局根节点上，CSS 自己把它变成缩放与亮度 */
const posterEl = ref<HTMLElement | null>(null);
useBeat(() => posterEl.value);
</script>

<template>
  <div ref="posterEl" class="poster" :class="{ 'is-playing': playing }">
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
      <!-- 外圈柔光：.glow-pulse 只负责“跟着节奏起伏”（缩放 + 亮度，由 --beat 驱动），
           里面的 .vinyl-glow 管材质与自转 —— 分两层是因为内层的 transform / opacity
           分别被 8s 自转与呼吸动画占着，CSS 动画优先于普通声明，写在里面会被吃掉 -->
      <div class="glow-pulse">
        <div class="vinyl-glow"></div>
      </div>

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
   画布比盘大一圈（左右各 30% / 上下各 10% 盘径，**以盘为中心**）：上边留给配重
   （臂体从盘的 -6.5% 起），右边留给抬起时的针尖 —— 这条自 v5.88 要大得多：
   抬起 -26° 时针尖落在盘的 125% 处、唱头壳 132%（留 5% 余量）。参照图里抬起时针是
   **离开盘面**的，而 -15° 时唱头壳只有 96% 盘半径，等于坐在唱片上（需求方：
   “唱臂无法完全离开唱片”）。 */
.poster__art {
  /* 盘径：一条 vmin 驱动（宽高平滑跟随，不在两种模式间跳）；
     `34vw` 是给又宽又矮的窗口的安全网（v5.88 自 40vw 收到 34vw：盘与唱臂的摆动半径
     要同时放进一列里，盘大一圈就挤不出唱臂抬起的位置），`520px` 是给大屏的绝对上限。 */
  --vinyl-d: min(52vh, 34vw, 520px);
  /* 画布的留白**左右各一份、上下各一份**（不以盘为中心的话，盘会看着偏）：
     左右 0.3 盘径 —— 右边那份是唱臂抬起真的会用到的（-26° 时针尖到盘径 125%），
     左边那份纯粹是配重；上下 0.1 盘径 —— 上方那份给配重（臂体从盘的 -6.5% 起），
     下方那份同样只为了让盘纵向居中（v5.88 之前上下只留上方，盘就低了 15px）。 */
  --art-pad: calc(var(--vinyl-d) * 0.3);
  --art-pad-y: calc(var(--vinyl-d) * 0.1);
  position: relative;
  z-index: 0;
  width: calc(var(--vinyl-d) + var(--art-pad) * 2);
  height: calc(var(--vinyl-d) + var(--art-pad-y) * 2);
  /* 装饰层：别挡住歌词行的点击 seek（歌词在 z-2） */
  pointer-events: none;
}

/* 盘与唱臂对齐同一个方块的**正中**（左右各 --art-pad、上下各 --art-pad-y），
   两者同框同尺寸 —— 于是内层那些百分数全都是“盘径的百分比”，与参照的坐标一一对应。 */
.vinyl-assembly,
.tonearm-box {
  position: absolute;
  left: var(--art-pad);
  bottom: var(--art-pad-y);
  width: var(--vinyl-d);
  aspect-ratio: 1;
}

.vinyl-assembly {
  /* 混合模式只在这个壳里生效，不外溢到页面 */
  isolation: isolate;
}

/* 外圈柔光：**三团径向渐变叠出来**（没有图片、没有 mask）——
   v5.89 之前是 `glow.png` 当 mask 再填主题色：形状是**死的**，只能整团一起转；
   换成三团各自带偏移、大小、转速的柔光之后，合出来的形状一直在缓慢变形，
   而周期是 LCM(8, 13, 17) ≈ 30 分钟 —— 人眼看着就是不重复的。
   （PRD 3.9 当初那句“box-shadow 做不出这种不规则衰减”仍然成立：单团确实做不出；
     但**多团叠加**可以，而且比一张固定形状的图更“活”。）
   位置与尺寸全部从盘径与画布留白派生（与盘同源），比盘大 40%、以盘心为中心
   —— 改了留白却忘了这里，柔光就会跑偏（v5.88 踩到，看着像“盘发灰发虚”）。 */
.glow-pulse {
  position: absolute;
  left: calc(var(--art-pad) - var(--vinyl-d) * 0.2);
  bottom: calc(var(--art-pad-y) - var(--vinyl-d) * 0.2);
  width: calc(var(--vinyl-d) * 1.4);
  aspect-ratio: 1;
  /* 节奏起伏（v5.91，需求方：“光晕会随着音乐的节奏起伏就好了”）：只做“大一点、亮一点”，
     两个属性都在合成层上跑 —— 逐帧改 `--beat` 不会重绘渐层。
     **主脉是缩放**（1 → 1.11）：既明显又零代价；亮度只给 0.96 → 1（4%）——
     底不要压到 1 以下太多，否则暂停（--beat = 0）时光晕会比改前暗一截（v5.91 实测踩到）。
     为什么套在外层：里层的 transform 被 8s 自转占着、opacity 被呼吸动画占着，
     **CSS 动画优先于普通声明**，写在里层会被吃掉（同理 `--beat` 没注册成 `<number>`
     也没关系 —— 它只参与 calc，不需要可插值的过渡）。 */
  transform: scale(calc(1 + var(--beat, 0) * 0.11));
  opacity: calc(0.96 + var(--beat, 0) * 0.04);
}

.vinyl-glow {
  position: absolute;
  inset: 0;
  /* 颜色只在容器上取一次（跟随封面），三团都用 currentColor —— JS 依旧只写 --cover-src；
     上一行是不支持相对色语法时的退回值 */
  color: var(--cv1);
  color: oklch(from var(--cover-src) clamp(0.52, calc(l + 0.04), 0.68) clamp(0.07, c, 0.15) h);
  /* 主团：中心略偏左下（不偏的话就是同心圆，柔光不“活”） */
  background: radial-gradient(
    circle closest-side at 47% 53%,
    color-mix(in oklab, currentColor 52%, transparent) 0%,
    color-mix(in oklab, currentColor 38%, transparent) 55%,
    color-mix(in oklab, currentColor 17%, transparent) 78%,
    transparent 100%
  );
  animation: v-spin 8s linear infinite;
  /* 暂停＝停在当前角度（像真的转盘停下）——与 .v-disc 同一套语义 */
  animation-play-state: paused;
}

/* 第二、三团：偏移与转速都不同，叠上去让形状缓慢流动 */
.vinyl-glow::before,
.vinyl-glow::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
  animation-play-state: paused;
}

.vinyl-glow::before {
  background: radial-gradient(
    circle closest-side at 40% 42%,
    color-mix(in oklab, currentColor 40%, transparent) 0%,
    color-mix(in oklab, currentColor 22%, transparent) 50%,
    transparent 88%
  );
  animation: v-spin 13s linear infinite reverse;
}

.vinyl-glow::after {
  background: radial-gradient(
    circle closest-side at 58% 60%,
    color-mix(in oklab, currentColor 32%, transparent) 0%,
    color-mix(in oklab, currentColor 18%, transparent) 48%,
    transparent 86%
  );
  animation: v-spin 17s linear infinite;
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

/* 两团副光跟着播放一起转（暂停时冻结在当前角度，与盘同一套语义） */
.poster.is-playing .vinyl-glow::before,
.poster.is-playing .vinyl-glow::after {
  animation-play-state: running;
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
   角度：抬起 -26°（针完全在盘外——需求方：参照图里抬起时针是离开盘面的，
   v5.87 之前用的 -15° 只到 1.04 盘半径，等于贴着盘边；-26° 实测 ≈ 1.17 盘半径）；
   落针 -4°（针落在外圈纹槽上，够不到中间那张封面）；
   0.9s 与 cubic-bezier(0.34, 1.1, 0.4, 1) 也是参照实测的“过冲一点但很快稳”。 */
.tonearm {
  position: absolute;
  inset: 0;
  z-index: 5;
  transform-origin: 90% 5%;
  transform: rotate(-26deg);
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

/* 落针后随音乐轻摆（v5.87，参照实现的 arm-sway）：延迟 0.9s —— 等落针动画走完再开始；
   幅度只有 ±0.8°，首尾都回 0deg（循环不跳帧）。我 v5.85 把它当成“装饰不承载信息”
   砍掉了，那是判断错：这一下轻摆正是“唱片在转、针在纹槽里走”的体感，需求方按参照指出来了。 */
.poster.is-playing .tonearm__arm {
  animation: v-arm-sway 4.4s ease-in-out 0.9s infinite;
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

/* 唱臂左右摆动：幅度很小，只是“活的”的感觉；首尾都回 0deg，循环时不会跳帧 */
@keyframes v-arm-sway {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-0.8deg);
  }
  75% {
    transform: rotate(0.8deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .v-disc,
  .vinyl-glow,
  .poster.is-playing .vinyl-glow,
  /* 柔光的两团副光（v5.89） */
  .vinyl-glow::before,
  .vinyl-glow::after {
    animation: none;
  }

  /* 唱臂落下是**状态**（播放/暂停），不是循环动效，所以保留，只去掉那 0.9s 的过渡 */
  .tonearm {
    transition: none;
  }

  /* 轻摆是持续动效，减动效时关掉（落针/抬起那个状态切换保留） */
  .poster.is-playing .tonearm__arm {
    animation: none;
  }
}

/* 窄屏（RT-08 的最小照顾）：两列摆不下（字会被压成一条），改成上下两行 ——
   **盘在上、歌在下面**（v5.86 需求方：“移动端布局时把唱片放到歌词头上，唱片不能缩的太小了”）：
   ① 盘是这一页的主视觉，手机竖屏下先看到它才像“唱片机”；
   ② 盘要占够宽度才有尺寸 —— 原来那条 `34vmin` 在 390px 宽的手机上只剩 133px。
   尺寸取 `66vw`（竖屏主驱动；需求方看过 78vw 后：“也别太大了”，390px 手机上 257px）；
   `40vh` 与 `340px` 是横屏 / 大屏的安全网。 */
@media (max-width: 720px) {
  .poster {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    justify-items: center;
    gap: 16px;
    padding: 4px 16px 0;
  }

  /* 用行号把盘摆到第一行（DOM 里歌词列在前，这里不动 DOM 顺序） */
  .poster__art {
    grid-row: 1;
    /* 窄屏只改盘径：画布尺寸与所有偏移都是它的派生值，不用也不能再手写一份
       ——否则又是“三方各自漂移”的老毛病。
       56vw：把左右各 0.3 盘径的留白也算进去（盘居中，唱臂抬起仍不出屏）。
       画布以盘为中心，所以栅格直接居中的就是**盘**，不再需要补偿量 */
    --vinyl-d: min(56vw, 40vh, 300px);
  }

  .poster__col {
    grid-row: 2;
    width: 100%;
    max-width: none;
  }

  .ly {
    height: min(30vh, 260px);
  }
}
</style>
