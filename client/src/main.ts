import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { usePlayerStore } from "./stores/player";
import { useThemeStore } from "./stores/theme";
import { syncScrollbarSize } from "./utils/scrollbar";
import "./styles/tokens.css";
import "./styles/global.css";
// 材质双模式（v4.55）：必须排在 global.css 之后，靠 `[data-material]` 覆盖外壳底色
import "./styles/material.css";

const app = createApp(App);

/**
 * 设备像素比 → CSS 变量 `--dpr`（v4.92）。
 * 1px 的 CSS 细线在 Windows 125% / 150% 缩放下是 1.25 / 1.5 个设备像素，
 * 浏览器凑整后「有的位置占 1 个、有的占 2 个」——表现为“有的细线粗有的细”（需求方实拍）。
 * CSS 里再用 `--px-scale: calc(1 / var(--dpr))` 把线缩回 1 个设备像素；
 * JS 只写这**一个原始值**，怎么用留在 CSS（与取色管线同一原则）。
 * 拖动窗口到不同缩放的显示器时 `resize` 会重新写。
 */
function syncPixelRatio(): void {
  document.documentElement.style.setProperty("--dpr", String(window.devicePixelRatio || 1));
}
syncPixelRatio();
window.addEventListener("resize", syncPixelRatio);

/**
 * 再实测一个“引擎给的值”：**滚动条宽度**。
 * Chromium 的 `::-webkit-scrollbar` 确实是令牌里的 10px，但 Firefox 只认 `scrollbar-width: thin`，
 * 宽度由引擎/平台给（Windows 上不是 10px）—— 而侧栏/页框/控制台都靠
 * `scrollbar-gutter: stable` + `margin-right: calc(var(--scrollbar-size) * -1)` 把滚动条槽
 * 挪进内边距，令牌一偏就对不齐（需求方对照截图：“侧边栏这里会有 bug”）。
 * 宽度不随窗口尺寸变，所以启动时量一次就够（换 OS 滚动条设置后刷新一次即可）。
 */
syncScrollbarSize();

app.use(createPinia());
// 主题需在挂载前落到 <html data-theme>，否则首屏会闪一下默认深色（VS-08）
useThemeStore().init();
// 播放存档（PL-04 音量 / PL-07 队列与进度）同样要在首屏前落到 store：
// 放这里而不是 PlayerLayout —— 直接落在 /now 时那个布局根本不挂载（刷新后恢复不了）
usePlayerStore().restore();
app.use(router);
app.mount("#app");
