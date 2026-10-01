import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { usePlayerStore } from "./stores/player";
import { useThemeStore } from "./stores/theme";
import "./styles/tokens.css";
import "./styles/global.css";
// 材质双模式（v4.55）：必须排在 global.css 之后，靠 `[data-material]` 覆盖外壳底色
import "./styles/material.css";

const app = createApp(App);

app.use(createPinia());
// 主题需在挂载前落到 <html data-theme>，否则首屏会闪一下默认深色（VS-08）
useThemeStore().init();
// 播放存档（PL-04 音量 / PL-07 队列与进度）同样要在首屏前落到 store：
// 放这里而不是 PlayerLayout —— 直接落在 /now 时那个布局根本不挂载（刷新后恢复不了）
usePlayerStore().restore();
app.use(router);
app.mount("#app");
