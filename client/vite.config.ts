import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    vue(),
    // 图标构建期打包为 Vue 组件（Phosphor 单一图标集，PRD 5.1）；
    // autoInstall 关闭：图标集缺失时构建期报错而不是运行时联网拉取（PWA 离线要求）
    Icons({ compiler: "vue3", autoInstall: false }),
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
