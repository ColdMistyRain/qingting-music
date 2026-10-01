<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import IconCaretDown from "~icons/ph/caret-down";
import IconMusicNotes from "~icons/ph/music-notes";
import ImControls from "@/components/immersive/ImControls.vue";
import ImLayoutCenter from "@/components/immersive/ImLayoutCenter.vue";
import ImLayoutDuo from "@/components/immersive/ImLayoutDuo.vue";
import ImLayoutPoster from "@/components/immersive/ImLayoutPoster.vue";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";
import { parseLyrics } from "@/utils/lyrics";

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
 * 来源优先级按 LR-02：先曲目自带（内嵌），再 store 的 lyricsText（在线 / 手动 .lrc 的落点）。
 * 非法行容错在解析器里，这里不做二次判断。
 */
const lyricsSource = computed(() => track.value?.lyrics ?? player.lyricsText);
const lines = computed(() => parseLyrics(lyricsSource.value).lines);

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

/** 关掉沉浸页：有来路就回退（保留用户的浏览位置），直接进本页时回首页 */
function close(): void {
  if (window.history.state?.back) router.back();
  else router.push({ name: "home" });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
  // 空格在主页由 PlayerLayout 接管；本页是独立路由，得自己接
  else if (event.code === "Space" && player.hasTrack && event.target === document.body) {
    event.preventDefault();
    player.toggle();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
});
</script>

<template>
  <div class="im" :style="ambientStyle">
    <header class="im-top">
      <button class="ctl" title="收起（Esc）" @click="close">
        <IconCaretDown class="icon" />
      </button>
      <span class="im-top__label">正在播放</span>
      <span class="im-top__pad" aria-hidden="true"></span>
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
  background:
    radial-gradient(120% 90% at 16% 0%, var(--im-glow-1), transparent 62%),
    radial-gradient(110% 80% at 88% 100%, var(--im-glow-2), transparent 58%), var(--bg-base);
  /* 海报布局的大彩胶要从右上角**伸出屏幕**：本页是固定的全屏页，
     裁在视口上就好，不能让它变成页面滚动区域 */
  overflow: hidden;
  animation: im-in 0.36s var(--ease-ios);
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

.im > * {
  position: relative;
}

@keyframes im-in {
  from {
    opacity: 0;
    transform: scale(0.985);
  }
}

.im-top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
}

.im-top__label {
  margin: 0 auto;
  font-size: 11px;
  letter-spacing: 0.34em;
  color: var(--text-3);
  text-transform: uppercase;
}

/* 与左侧关闭按钮等宽，label 才真的居中（不是靠 padding 凑） */
.im-top__pad {
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
  .im {
    animation: none;
  }
}
</style>
