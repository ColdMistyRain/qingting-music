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
      // 开发期把接口与音频流代理到后端，避免跨域
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/audio": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
