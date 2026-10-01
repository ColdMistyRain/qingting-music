import { Router } from "express";
import { validatePlaylistName } from "@qingting/shared";
import type { AppConfig } from "../config.js";
import { asyncHandler, sendFail, sendOk } from "../http.js";
import { requireAccess } from "../middleware/auth.js";
import {
  createPlaylist,
  loadPlaylists,
  renamePlaylist,
  savePlaylists,
  sanitizePlaylistItem,
  withPlaylistItems,
} from "../services/playlists.js";

/**
 * 歌单（PRD 3.6 / 5.6：`GET / POST / PUT / DELETE /api/playlists`）。
 *
 *   GET    /api/playlists            全部歌单（含曲目引用）
 *   POST   /api/playlists            新建 { name }
 *   PUT    /api/playlists/:id        改名 { name }
 *   PUT    /api/playlists/:id/items  整表替换曲目 { items }（PS-02 添加 / PS-04 移除与排序）
 *   DELETE /api/playlists/:id        删除
 *
 * 权限：AC-03 把歌单归在**访客级**（"访客级：音乐库列表/音频流/歌单/在线音源搜索播放"），
 * 所以这里的读写都是 `visitor` —— 别顺手改成 admin，那样登录的访客就用不了歌单。
 *
 * 曲目为什么是"整表替换"：歌单是有序列表，添加/移除/拖动排序本质都是"新的一份顺序"，
 * 客户端把结果整份发回来最简单，去重与顺序在服务端再做一次（前后端共用同一份规则）。
 */
export function createPlaylistsRouter(config: AppConfig): Router {
  const router = Router();

  router.get(
    "/",
    requireAccess("visitor"),
    asyncHandler(async (_req, res) => {
      sendOk(res, { playlists: await loadPlaylists(config.dataDir) });
    }),
  );

  router.post(
    "/",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const name = validatePlaylistName((req.body as { name?: unknown } | undefined)?.name);
      if (!name.ok) {
        sendFail(res, 400, name.message);
        return;
      }

      const playlists = await loadPlaylists(config.dataDir);
      const playlist = createPlaylist(name.name);
      await savePlaylists(config.dataDir, [...playlists, playlist]);
      sendOk(res, playlist, 201);
    }),
  );

  router.put(
    "/:id",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const playlists = await loadPlaylists(config.dataDir);
      const current = playlists.find((entry) => entry.id === id);
      if (!current) {
        sendFail(res, 404, "这个歌单不在了");
        return;
      }

      const name = validatePlaylistName((req.body as { name?: unknown } | undefined)?.name);
      if (!name.ok) {
        sendFail(res, 400, name.message);
        return;
      }

      const updated = renamePlaylist(current, name.name, new Date().toISOString());
      await savePlaylists(
        config.dataDir,
        playlists.map((entry) => (entry.id === id ? updated : entry)),
      );
      sendOk(res, updated);
    }),
  );

  router.put(
    "/:id/items",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const playlists = await loadPlaylists(config.dataDir);
      const current = playlists.find((entry) => entry.id === id);
      if (!current) {
        sendFail(res, 404, "这个歌单不在了");
        return;
      }

      const raw = (req.body as { items?: unknown } | undefined)?.items;
      if (!Array.isArray(raw)) {
        sendFail(res, 400, "items 必须是数组");
        return;
      }
      const items = raw.map(sanitizePlaylistItem);
      if (items.some((item) => item === null)) {
        sendFail(res, 400, "有条目缺 source / title / artist，没法存");
        return;
      }

      const updated = withPlaylistItems(
        current,
        items.filter((item) => item !== null),
        new Date().toISOString(),
      );
      await savePlaylists(
        config.dataDir,
        playlists.map((entry) => (entry.id === id ? updated : entry)),
      );
      sendOk(res, updated);
    }),
  );

  router.delete(
    "/:id",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const playlists = await loadPlaylists(config.dataDir);
      if (!playlists.some((entry) => entry.id === id)) {
        sendFail(res, 404, "这个歌单不在了");
        return;
      }

      await savePlaylists(
        config.dataDir,
        playlists.filter((entry) => entry.id !== id),
      );
      sendOk(res, { id });
    }),
  );

  return router;
}
