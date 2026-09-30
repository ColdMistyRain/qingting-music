import { Router } from "express";
import type { AppConfig } from "../config.js";
import { asyncHandler, sendOk } from "../http.js";
import { requireAccess } from "../middleware/auth.js";
import { loadSongs } from "../services/storage.js";

/** GET /api/stats 的返回（LB-10 / AD-03）：概览页的存储统计 */
export interface StorageStats {
  songCount: number;
  totalSize: number;
}

/**
 * 存储统计（管理员）。M1 只给“曲目数 + 总占用”（AD-03 的图表随 M2 交付），
 * 数据直接从曲库索引算，不另存一份计数——两份数字早晚会不一致。
 */
export function createStatsRouter(config: AppConfig): Router {
  const router = Router();

  router.get(
    "/",
    requireAccess("admin"),
    asyncHandler(async (_req, res) => {
      const songs = await loadSongs(config.dataDir);
      const data: StorageStats = {
        songCount: songs.length,
        totalSize: songs.reduce((sum, song) => sum + song.size, 0),
      };
      sendOk(res, data);
    }),
  );

  return router;
}
