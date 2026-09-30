import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  // shared 是源码形式的 workspace 包（无构建产物），必须打进产物
  noExternal: ["@qingting/shared"],
});
