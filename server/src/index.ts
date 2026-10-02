import { mkdirSync } from "node:fs";
import { createApp } from "./app.js";
import { describeAuthMode, loadConfig } from "./config.js";
import { loadOrCreateSecret } from "./services/auth.js";
import { hasStaticSite } from "./static.js";

const config = loadConfig(process.env);

// 运行时目录：data（曲库/歌单索引、auth-secret）与 uploads（音频 + 封面）
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.uploadDir, { recursive: true });

// AUTH_SECRET 未配置时自动生成并持久化，重启后会话不失效（AC-08）
if (!config.authSecret) config.authSecret = loadOrCreateSecret(config.dataDir);

const app = createApp(config);
const staticEnabled = hasStaticSite(config.staticDir);

const server = app.listen(config.port, () => {
  const mode = describeAuthMode(config.userPassword, config.adminPassword);
  console.log(`[server] 轻听音乐后端已启动：http://localhost:${config.port}`);
  console.log(`[server] 门禁模式：${mode}${mode === "closed" ? "（全功能开放）" : ""}`);
  console.log(
    `[server] 在线音源：${config.onlineEnabled ? config.neteaseApiBase : "未配置（功能隐藏）"}`,
  );
  console.log(`[server] 数据目录：${config.dataDir}`);
  console.log(`[server] 音频目录：${config.uploadDir}`);
  console.log(
    `[server] 静态托管：${staticEnabled ? config.staticDir : "未启用（开发期由 Vite 服务前端）"}`,
  );
});

// 优雅退出：容器/进程管理器发 SIGTERM 时先停止接受新连接
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] 收到 ${signal}，正在关闭…`);
    server.close(() => process.exit(0));
  });
}
