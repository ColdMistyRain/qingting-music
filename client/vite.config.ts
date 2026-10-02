import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    vue(),
    // 图标构建期打包为 Vue 组件（Phosphor 单一图标集，PRD 5.1）；
    // autoInstall 关闭：图标集缺失时构建期报错而不是运行时联网拉取（PWA 离线要求）
    Icons({ compiler: "vue3", autoInstall: false }),
    // PWA（RT-07，选型表指定的 vite-plugin-pwa）：manifest + Service Worker。
    // 只预缓存**应用外壳与构建产物**（globPatterns 覆盖 dist/ 里的 js/css/html/图标/字体）；
    // 音频、封面、接口一律不进缓存 —— RT-07 明确写了“音频不缓存”，
    // 而且它们是后端挂在根路径下的路由，离线时应当直接失败，
    // 不能被 SPA 兜底成一份 index.html（开发代理漏配 /covers 就是同一个毛病，坑 11）。
    VitePWA({
      registerType: "autoUpdate",
      // 开发期不开 SW：HMR 与 Service Worker 抢请求是老坑，也会把改动盖住
      devOptions: { enabled: false },
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "轻听音乐",
        short_name: "轻听",
        description: "可私有部署的 Web 音乐播放器：本地文件 + 自建云端曲库 + 在线音源",
        lang: "zh-CN",
        start_url: "/",
        scope: "/",
        // 全屏运行（添加到主屏幕后没有浏览器地址栏，RT-07）
        display: "standalone",
        background_color: "#0a0c12",
        theme_color: "#0a0c12",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff,woff2}"],
        // 这三条根路径不归 SPA 路由管（后端的东西），离线时该失败就失败
        navigateFallbackDenylist: [/^\/api\//, /^\/audio\//, /^\/covers\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期把接口、音频流与封面代理到后端，避免跨域。
      // ⚠️ 后端挂在根路径下的媒体路由（/audio、/covers）**每加一个都要在这里补一条**：
      // 漏了不会报错，而是被 SPA 兜底成 index.html（200 text/html），
      // 表现是「音频/封面静默加载不出来」——v4.87 实测，封面一直没显示就是漏了 /covers。
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/audio": { target: "http://localhost:3000", changeOrigin: true },
      "/covers": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
