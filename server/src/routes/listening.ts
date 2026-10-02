import { Router } from "express";
import type { AppConfig } from "../config.js";
import { asyncHandler, sendFail, sendOk } from "../http.js";
import { requireAccess } from "../middleware/auth.js";
import {
  loadListening,
  updateListening,
  withFavorite,
  withRecent,
  withoutFavorite,
} from "../services/listening.js";
import { sanitizePlaylistItem } from "../services/playlists.js";

/**
 * 收藏与最近播放（PRD 3.6 / PS-05）。
 *
 *   GET    /api/listening                 两份列表一起给（都很小）
 *   POST   /api/listening/favorites       收藏一条 { …PlaylistItem }（幂等）
 *   DELETE /api/listening/favorites/:key  取消收藏（key 是 encodeURIComponent 后的身份键，幂等）
 *   POST   /api/listening/recent          记一次播放 { …PlaylistItem }（去重 + 置顶 + 截到 100）
 *   DELETE /api/listening/recent          清空最近播放
 *
 * 权限按 AC-03 归**访客级**：这是“我的听歌数据”，不是管理操作 —— 登录的访客就该能用。
 * 引用口径与歌单完全一致（`playlistItemKey`：云端存 Song.id、在线存 provider:id、
 * 本地存“歌手|曲名”），改过元信息的曲目重记一次会自动覆盖旧的那一条。
 */
export function createListeningRouter(config: AppConfig): Router {
  const router = Router();

  router.get(
    "/",
    requireAccess("visitor"),
    asyncHandler(async (_req, res) => {
      sendOk(res, await loadListening(config.dataDir));
    }),
  );

  router.post(
    "/favorites",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const item = sanitizePlaylistItem(req.body);
      if (!item) {
        sendFail(res, 400, "曲目引用不完整");
        return;
      }
      // 幂等：已经在收藏里就不必再写一次盘（update 见到 mutator 原样返回同一个引用就跳过写）
      sendOk(res, await updateListening(config.dataDir, (current) => withFavorite(current, item)));
    }),
  );

  router.delete(
    "/favorites/:key",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const key = String(req.params.key);
      sendOk(
        res,
        await updateListening(config.dataDir, (current) => withoutFavorite(current, key)),
      );
    }),
  );

  router.post(
    "/recent",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const item = sanitizePlaylistItem(req.body);
      if (!item) {
        sendFail(res, 400, "曲目引用不完整");
        return;
      }
      const now = new Date().toISOString();
      sendOk(
        res,
        await updateListening(config.dataDir, (current) => withRecent(current, item, now)),
      );
    }),
  );

  router.delete(
    "/recent",
    requireAccess("visitor"),
    asyncHandler(async (_req, res) => {
      const next = await updateListening(config.dataDir, (current) =>
        // 已经是空的就不写盘
        current.recent.length === 0 ? current : { ...current, recent: [] },
      );
      sendOk(res, next);
    }),
  );

  return router;
}
