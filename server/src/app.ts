import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import type { AppConfig } from "./config.js";
import { apiNotFound, errorHandler, sendOk } from "./http.js";
import { attachRole } from "./middleware/auth.js";
import { createAudioRouter, createCoversRouter } from "./routes/audio.js";
import { createAuthRouter } from "./routes/auth.js";
import { createConfigRouter } from "./routes/config.js";
import { createListeningRouter } from "./routes/listening.js";
import { createPlaylistsRouter } from "./routes/playlists.js";
import { createSongsRouter } from "./routes/songs.js";
import { createStatsRouter } from "./routes/stats.js";
import { attachStaticSite } from "./static.js";

/** GET /api/health 的返回体 */
export interface HealthInfo {
  status: "ok";
  uptimeSec: number;
  onlineEnabled: boolean;
}

/**
 * 装配 Express 应用（不含 listen，便于集成测试）。
 * 中间件顺序：JSON → Cookie → 角色解析 → 路由 → 404 → 错误兜底。
 */
export function createApp(config: AppConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  // 反向代理（Nginx）场景下 req.protocol 才能反映真实 HTTPS
  app.set("trust proxy", 1);

  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(attachRole(config));

  app.get("/api/health", (_req, res) => {
    const data: HealthInfo = {
      status: "ok",
      uptimeSec: Math.round(process.uptime()),
      onlineEnabled: config.onlineEnabled,
    };
    sendOk(res, data);
  });

  app.use("/api/config", createConfigRouter(config));
  app.use("/api/auth", createAuthRouter(config));
  app.use("/api/songs", createSongsRouter(config));
  app.use("/api/playlists", createPlaylistsRouter(config));
  app.use("/api/listening", createListeningRouter(config));
  app.use("/api/stats", createStatsRouter(config));
  // 音频流与封面走非 /api 前缀（PRD 5.6）：可直接当 <audio>/<img> 的 src
  app.use("/audio", createAudioRouter(config));
  app.use("/covers", createCoversRouter(config));

  app.use("/api", apiNotFound);

  // 前端静态产物（生产）：/api 已经处理完了，所以下面的兜底只会碰到页面路径。
  // 目录不在（开发期）时这个函数什么都不做，行为与以前完全一致。
  attachStaticSite(app, config.staticDir);

  app.use(errorHandler);

  return app;
}
