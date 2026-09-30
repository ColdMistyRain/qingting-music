import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { useThemeStore } from "./stores/theme";
import "./styles/tokens.css";
import "./styles/global.css";

const app = createApp(App);

app.use(createPinia());
// 主题需在挂载前落到 <html data-theme>，否则首屏会闪一下默认深色（VS-08）
useThemeStore().init();
app.use(router);
app.mount("#app");
