<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import IconCaretDown from "~icons/ph/caret-down";
import IconFileText from "~icons/ph/file-text";
import IconMusicNotes from "~icons/ph/music-notes";
import ImControls from "@/components/immersive/ImControls.vue";
import ImLayoutCenter from "@/components/immersive/ImLayoutCenter.vue";
import ImLayoutDuo from "@/components/immersive/ImLayoutDuo.vue";
import ImLayoutPoster from "@/components/immersive/ImLayoutPoster.vue";
import LyricsSourceMenu from "@/components/immersive/LyricsSourceMenu.vue";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";
import { parseLyrics } from "@/utils/lyrics";
import { handleShortcut } from "@/utils/shortcuts";

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

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    close();
    return;
  }
  // 空格：只在没聚焦任何元素时接管——聚焦在按钮上时空格该按那个按钮，
  // 否则会出现“既点了按钮又切了播放”的双动作。
  // 方向键：按钮不吃方向键，所以焦点在哪都接管（输入框里由共享判定拦掉）。
  if (event.target !== document.body && event.code === "Space") return;
  if (handleShortcut(event, shortcuts)) event.preventDefault();
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
      <!-- 歌词来源 / 导入 .lrc、.yrc（LR-02）：与左侧关闭按钮同尺寸，标题才真的居中 -->
      <LyricsSourceMenu>
        <template #trigger>
          <button class="ctl" title="歌词来源 / 导入歌词">
            <IconFileText class="icon" />
          </button>
        </template>
      </LyricsSourceMenu>
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

/* 深色主题用面板那套深投影（黑 + 更大一点），与 --panel-shadow 的口径一致 */
:root[data-theme="dark"] .im-sheet-enter-active,
:root[data-theme="dark"] .im-sheet-leave-active {
  box-shadow: 0 -20px 46px -16px rgba(0, 0, 0, 0.6);
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

/* 顶栏左右两个按钮等宽，label 才真的居中（不是靠 padding 凑） */
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
}
</style>
