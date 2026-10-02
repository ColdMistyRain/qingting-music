<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import IconCaretDown from "~icons/ph/caret-down";
import IconMusicNotes from "~icons/ph/music-notes";
import AppTooltip from "@/components/AppTooltip.vue";
import ImControls from "@/components/immersive/ImControls.vue";
import ImLayoutCenter from "@/components/immersive/ImLayoutCenter.vue";
import ImLayoutDuo from "@/components/immersive/ImLayoutDuo.vue";
import ImLayoutPoster from "@/components/immersive/ImLayoutPoster.vue";
import LyricsSourceMenu from "@/components/immersive/LyricsSourceMenu.vue";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";
import { parseLyrics } from "@/utils/lyrics";
import { isTouchTap } from "@/utils/pointer";
import { handleShortcut } from "@/utils/shortcuts";
import { isTopLayer, popTopLayer, pushTopLayer } from "@/utils/topLayer";

/**
 * 沉浸式播放页（VS-03 + 3.7 歌词）。
 *
 * 页面只做三件事：① 铺封面背景与进出场；② 把歌词原文解析成时间轴；③ 用 rAF 采样播放时间
 * 喂给共享子组件。版式在布局组件里（VS-09 三布局：本步只落地"经典双栏"）。
 *
 * 本页**不用玻璃面板**：背景本身就是一层平滑的封面渐变，玻璃后面没有可模糊的细节，
 * 加了只会得到"描边 + 投影"的假玻璃（v4.55 实测结论）。文字的可读性靠一层跟随主题的薄雾。
 */
const player = usePlayerStore();
const theme = useThemeStore();

/** 本页在“层”里的身份（utils/topLayer）：Esc 只关最上面那层，有抽屉/对话框时本页让位 */
let layerId: number | null = null;

/**
 * VS-09：布局是**组件切换**，不是同一套 DOM 换类名（原型那套类切换已证明会产生层叠逃逸）。
 *
 * 表里除了组件，还记着"这一布局要不要页面级的右下环境光"：海报布局下彩胶的有机光晕是
 * 画面唯一主光源，右下那束光与它同色却脱离光源孤立存在，读起来像**一块色渍**
 * （PRD v4.3 实测结论）。所以在这里关掉它——而不是让布局组件去盖一层不透明底，
 * 那样会在顶栏/底栏处留下一条接缝。
 */
const LAYOUTS = {
  duo: { component: ImLayoutDuo, ambient2: true },
  center: { component: ImLayoutCenter, ambient2: true },
  poster: { component: ImLayoutPoster, ambient2: false },
} as const;

const current = computed(() => LAYOUTS[theme.layout]);
const layoutComponent = computed(() => current.value.component);
/** 只有需要关光的布局才写内联变量，其余布局不写——让 CSS 里的令牌当唯一默认值 */
const ambientStyle = computed(() =>
  current.value.ambient2 ? undefined : { "--im-glow-2": "transparent" },
);
const router = useRouter();

/** PL-01 / PL-08：本页是独立路由（不挂主壳），快捷键自己接——但判定用共享的那一份 */
const shortcuts = {
  toggle: () => player.toggle(),
  seekBy: (seconds: number) => player.seekTo(player.progress + seconds),
  adjustVolume: (delta: number) => player.setVolume(player.volume + delta),
};

const track = computed(() => player.currentTrack);
const titleText = computed(() => track.value?.title ?? "");
const subtitleText = computed(() => {
  const t = track.value;
  if (!t) return "";
  return [t.artist, t.album].filter(Boolean).join(" · ");
});
const coverUrl = computed(() => track.value?.cover ?? null);

/**
 * LR-01/LR-02：歌词原文 → 时间轴。
 * 来源统一由 store 给（优先级：手动导入 > 曲目内嵌 > 在线，定在 `utils/lyricsLibrary`），
 * 页面不自己去找文件/接口——数据来源变了，页面不用动：
 * 之前这里是 `track.lyrics ?? player.lyricsText`，加上手动导入后这种就地判断会立刻缴不清。
 * 非法行容错在解析器里，这里不做二次判断。
 */
const lines = computed(() => parseLyrics(player.lyricsSource).lines);

/**
 * 时间采样：timeupdate 只有 ~4Hz，直接喂给逐字填充会一跳一跳。
 * 播放中用 rAF 每帧向 store 取一次"此刻真实时间"；暂停时用 store 的展示值兜住（拖进度条也能更新）。
 */
const now = ref(0);
let frame = 0;

function tick(): void {
  now.value = player.sampleTime();
  frame = requestAnimationFrame(tick);
}

watch(
  () => player.playing,
  (playing) => {
    if (playing) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  },
  { immediate: true },
);

watch(
  () => player.displaySeconds,
  (seconds) => {
    if (!player.playing) now.value = seconds;
  },
  { immediate: true },
);

/** 关掉沉浸页：有来路就回到来路（保留用户的浏览位置），直接进本页时回首页。
 *
 *  ⚠️ 用 `router.replace(来路)` 而不是 `router.back()`：`replace` 的副作用正是我们要的 ——
 *  `/now` 这条历史被来路替换（不再压一条），关掉之后按浏览器后退键回到的是
 *  **来沉浸页之前**那一页，不会又跳回沉浸页。 */
function close(): void {
  const back = window.history.state?.back as string | undefined;
  if (back) router.replace(back);
  else router.push({ name: "home" });
}

/* ---------- 手机手势（RT-05，按 Salt Player 的交互语言） ----------
   在“封面 / 背景区”上：左右滑 → 上一首 / 下一首；下滑 → 收起（与顶部收起同一个动作）；
   上滑 → 歌词铺满（封面让位，再来一次下滑回到常规）。
   三条规矩：
   ① 只认真实触摸（`pointerType === "touch"`）—— 桌面上拖一下不该切歌（桌面行为不变）；
   ② 起手位置必须在手势区：歌词区与控件区自己有滚动/点击语义，不能被抢（`inGestureZone`）；
   ③ 没到阈值或方向不明确（横竖相差不到 1.5 倍）就什么都不做，不要猜。 */
const SWIPE_MIN_PX = 40;
const lyricsFocus = ref(false);
const gesture = { x: 0, y: 0, active: false };

function inGestureZone(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !el.closest("header, .im-ctl, .ly, .ly-view");
}

function onGestureStart(event: PointerEvent): void {
  if (!isTouchTap(event.pointerType) || !inGestureZone(event.target)) return;
  gesture.active = true;
  gesture.x = event.clientX;
  gesture.y = event.clientY;
}

function onGestureEnd(event: PointerEvent): void {
  if (!gesture.active) return;
  gesture.active = false;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX >= SWIPE_MIN_PX && absX > absY * 1.5) {
    if (dx < 0) player.next();
    else player.prev();
    return;
  }

  if (absY >= SWIPE_MIN_PX && absY > absX * 1.5) {
    if (dy > 0) {
      // 下滑：先在“歌词铺满”里退回常规，常规下才是收起整页
      if (lyricsFocus.value) lyricsFocus.value = false;
      else close();
    } else {
      lyricsFocus.value = true;
    }
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    // 上面还有层（队列抽屉 / 确认对话框）时放行：Esc 只关最上面那层（utils/topLayer）
    if (layerId !== null && !isTopLayer(layerId)) return;
    close();
    return;
  }
  // 空格：只在没聚焦任何元素时接管——聚焦在按钮上时空格该按那个按钮，
  // 否则会出现“既点了按钮又切了播放”的双动作。
  // 方向键：按钮不吃方向键，所以焦点在哪都接管（输入框里由共享判定拦掉）。
  if (event.target !== document.body && event.code === "Space") return;
  if (handleShortcut(event, shortcuts)) event.preventDefault();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  // 沉浸页是“最下面那层”：整页开着时它算最上面，抽屉 / 对话框一开就让位（Esc 只关最上面那层）
  layerId = pushTopLayer();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (layerId !== null) popTopLayer(layerId);
  layerId = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
});
</script>

<template>
  <div
    class="im"
    :class="{ 'is-lyrics-focus': lyricsFocus }"
    :style="ambientStyle"
    @pointerdown="onGestureStart"
    @pointerup="onGestureEnd"
    @pointercancel="onGestureEnd"
  >
    <!-- 背景光晕图层（z-index: -1：在 .im 的底色之上、内容与薄雾之下）
         两层渐变各自缓慢漂移，不再是一块静态渐变 -->
    <div class="im-glow" aria-hidden="true" />

    <header class="im-top">
      <AppTooltip label="收起（Esc）">
        <button class="ctl" @click="close">
          <IconCaretDown class="icon" />
        </button>
      </AppTooltip>
      <!-- 这里原来有一句“正在播放”—— 需求方：“多此一举”（v5.84）：
           这一页满屏都是正在播的那首（封面 / 歌名 / 歌词 / 走带进度），一句话不说也知道；
           去掉后顶栏只剩两枚键，靠 space-between 分列两端。 -->
      <!-- 歌词来源 / 导入 .lrc、.yrc（LR-02） -->
      <LyricsSourceMenu label="歌词来源 / 导入歌词" />
    </header>

    <div v-if="!player.hasTrack" class="im-empty">
      <IconMusicNotes class="icon" />
      <b>还没有播放的曲目</b>
      <span>先到本地播放或音乐库选一首歌</span>
      <button class="btn" @click="close">返回</button>
    </div>

    <template v-else>
      <div class="im-body">
        <component
          :is="layoutComponent"
          :title="titleText"
          :subtitle="subtitleText"
          :cover-url="coverUrl"
          :lines="lines"
          :time="now"
          :playing="player.playing"
          @seek="player.seekTo($event)"
        />
      </div>

      <footer class="im-bottom">
        <ImControls />
      </footer>
    </template>
  </div>
</template>

<style scoped>
.im {
  --ease-ios: cubic-bezier(0.32, 0.72, 0, 1);
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  color: var(--text-1);
  /* 页面级环境光：左上主光 + 右下副光，色源都来自封面（VS-02 的变量，暂用默认色源）；
     与列表页的 .bg-glow 是同一套取色管线，不在这里写死颜色。
     --im-glow-2 会被海报布局置为 transparent（理由见 LAYOUTS）。 */
  --im-glow-1: var(--cv1);
  --im-glow-2: var(--cv2);
  background: var(--bg-base);
  /* 海报布局的大彩胶要从右上角**伸出屏幕**：本页是固定的全屏页，
     裁在视口上就好，不能让它变成页面滚动区域 */
  overflow: hidden;
}

/* 沉浸页开合：从底部升起 / 反向沉下（v5.27，需求方指定）。
   过渡类由 App.vue 的 `<Transition name="im-sheet">` 挂在路由根元素上 —— 写在**本组件的
   scoped 样式**里，就只可能命中本页（主壳的 `.app` 拿不到这枚 scope id），所以两个方向
   都只有这张 sheet 在动；开与关用同一时长与曲线，看上去就是同一段动画反过来播。
   圆角与投影**只在飞行期间**存在：出发/终点是 18px 圆角（面板语言），升到铺满时收回直角 ——
   所以落地那一帧不会把圆角“啪”地弹平；投影用面板那套配方、方向朝上。 */
.im-sheet-enter-active,
.im-sheet-leave-active {
  transition:
    transform 0.42s var(--ease-ios),
    border-radius 0.42s var(--ease-ios);
  border-radius: 0;
  box-shadow: 0 -18px 44px -16px rgba(20, 28, 60, 0.34);
}

.im-sheet-enter-from,
.im-sheet-leave-to {
  transform: translateY(100%);
  border-radius: 18px 18px 0 0;
}

/* 上滑展开歌词（RT-05）：封面让位、歌词区占满。
   状态属于“页面”（一场手势同时改三套布局的版式），但**每套布局让位的方式不同**，
   所以响应写在本页、用 :deep 落到布局里 —— 布局组件不用为了一个共享状态各自加 prop。
   只有触摸设备可能置上这个类（手势只认 pointerType），桌面看不到这套版式。 */
.im.is-lyrics-focus :deep(.cover-wrap),
.im.is-lyrics-focus :deep(.poster__art) {
  display: none;
}

/* 封面藏掉后栅格只剩一列，否则会留一条空列（手机横屏时双栏布局会真的走两栏） */
.im.is-lyrics-focus :deep(.duo),
.im.is-lyrics-focus :deep(.poster) {
  grid-template-columns: minmax(0, 1fr);
}

.im.is-lyrics-focus :deep(.ly) {
  height: min(56vh, 520px);
}

.im.is-lyrics-focus :deep(.center) {
  gap: 10px;
}

/* 深色主题用面板那套深投影（黑 + 更大一点），与 --panel-shadow 的口径一致 */
:root[data-theme="dark"] .im-sheet-enter-active,
:root[data-theme="dark"] .im-sheet-leave-active {
  box-shadow: 0 -20px 46px -16px rgba(0, 0, 0, 0.6);
}

/* 背景光晕（VS-02 取色）：两层各自缓慢漂移。
   原来这两个 radial-gradient 直接写在 .im 的 background 上 —— 那是**静态**的，
   需求方：“背景的光晕能动起来吗，现在背景的光晕很死板”（v5.52）。
   为什么拆成独立图层：动画只走 transform / opacity（合成层，不用逐帧重绘整屏的渐变），
   两条周期取 34s / 46s 且**不成倍数**，所以看不出循环。
   ⚠️ 两个坑（v5.52 都踩过）：
   ① 图层要**比视口大一圈**（`inset: -12%`，四周各放大 12%）。图层和视口一样大时，
      位移会在边缘露出一条“没染上色”的硬边（靠近左上时那里颜色很浓，能看出来）。
      代价：图层内的百分比按 1.24 倍视口折算，所以下面写的是 96.8% / 22.6% 这类数 ——
      都是“视口比例 ÷ 1.24（再叠 12% 偏移）”算出来的，想让光晕回到原样改这几个数就行。
   ② 它必须是绝对定位，而下面那条 `.im > :not(.im-glow)`（给每个子元素建绘制层）与它
      特异性相同、又写在后面 —— 原本写成 `.im > *` 时会把它压成 `relative`，
      空 div 于是高度塔成 0、什么都不画（表面症状就是“光晕没了”）。
      **通配子选择器要给装饰层留例外。** */
.im-glow {
  position: absolute;
  /* 四周各放大 12%：位移 + 缩放 + 倾斜任何组合下，边缘都不会露出底色 */
  inset: -12%;
  /* 负数层级：在 .im 底色之上、::before 的薄雾与内容之下 */
  z-index: -1;
  pointer-events: none;
}

.im-glow::before,
.im-glow::after {
  content: "";
  position: absolute;
  inset: 0;
  /* 换封面时颜色要跟着过渡（与原来挂在 .im background 上的那条同义） */
  transition: background 0.8s ease;
}

.im-glow::before {
  /* 折算自视口上的 `radial-gradient(120% 90% at 16% 0%)` */
  background: radial-gradient(96.8% 72.6% at 22.6% 9.7%, var(--im-glow-1), transparent 62%);
  animation: glow-drift-a 16s ease-in-out infinite alternate;
}

.im-glow::after {
  /* 折算自视口上的 `radial-gradient(110% 80% at 88% 100%)` */
  background: radial-gradient(88.7% 64.5% at 80.6% 90.3%, var(--im-glow-2), transparent 58%);
  animation: glow-drift-b 26s ease-in-out infinite alternate;
}

/* 漂移幅度按**图层自身**算（图层比视口大 12%，所以 ±7% ≈ 视口的 ±8.7%：手机 844 高的屏上约 73px）
   —— 十几秒走一个单向行程。四个属性各管一件事，合起来像呼吸：
   位移（位置滑动）+ 缩放（面积胀缩，最容易被看出来）+ 明暗（浓淡）+ 轻微倾斜（渐变是椭圆，转一下形状就变）。
   幅度全是实测定下来的，别凭感觉调小（v5.52 调了三轮）：
   ±2.5% / scale 1.08 端点像素差只有 3.4/255，把两张端点图摆一起都看不出区别（看着就是没动）；
   现在是 ±7% / scale 1→1.3 / opacity .65↔1 / 16s，才真的“看得出在动”。 */
@keyframes glow-drift-a {
  from {
    transform: translate3d(-7%, -5%, 0) scale(1) rotate(-3deg);
    opacity: 0.65;
  }

  to {
    transform: translate3d(7%, 5%, 0) scale(1.3) rotate(3deg);
    opacity: 1;
  }
}

@keyframes glow-drift-b {
  from {
    transform: translate3d(5%, 7%, 0) scale(1.3) rotate(3deg);
    opacity: 1;
  }

  to {
    transform: translate3d(-5%, -7%, 0) scale(1) rotate(-3deg);
    opacity: 0.65;
  }
}

/* 薄雾：封面颜色不可控，文字必须始终可读。用主题底色而不是写死黑/白，
   这样深色主题下是"压暗"、浅色主题下是"提亮"，符合 VS-08 的双主题要求。 */
.im::before {
  content: "";
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-base) 62%, transparent);
  pointer-events: none;
}

/* 每个子元素自成一个绘制层（薄雾在它们**下面**，所以内容必须在同层或更上）。
   ⚠️ 要排除背景光晕图层 `.im-glow`：它是绝对定位的底图，而这条与 `.im-glow` 的规则
   特异性相同、又写在后面 —— 实测它会把 `position: absolute` 盖成 `relative`，
   于是那个空 div 高度塔成 0，光晕什么都不画（v5.52 踩到）。 */
.im > :not(.im-glow) {
  position: relative;
}

.im-top {
  flex: none;
  display: flex;
  align-items: center;
  /* 只有两枚键（收起 / 歌词来源），分列两端 —— 从前中问那句标签靠 `margin: 0 auto`
     把右侧那个顶到边上，标签一去就得自己撑开（v5.84）。 */
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
}

/* 两枚键等宽：图标形状不一样（小箭头 vs 列表），等宽才看起来对称 */
.im-top .ctl {
  width: 21px;
}

.im-top .ctl {
  color: var(--text-2);
  display: grid;
  place-items: center;
}

.im-top .ctl:hover {
  color: var(--text-1);
}

.im-body {
  flex: 1;
  min-height: 0;
}

.im-bottom {
  flex: none;
  display: grid;
  place-items: center;
  padding: 0 20px 26px;
}

.im-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-3);
}

.im-empty .icon {
  width: 40px;
  height: 40px;
  margin-bottom: 6px;
}

.im-empty b {
  font-size: 15px;
  color: var(--text-1);
}

.im-empty span {
  font-size: 12.5px;
  margin-bottom: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .im,
  .im-sheet-enter-active,
  .im-sheet-leave-active {
    animation: none;
    transition: none;
  }

  .im-glow::before,
  .im-glow::after {
    animation: none;
  }
}
</style>
