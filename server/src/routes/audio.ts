import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { fileExtension } from "@qingting/shared";
import type { AppConfig } from "../config.js";
import { asyncHandler, sendFail } from "../http.js";
import { requireAccess } from "../middleware/auth.js";
import { parseRangeHeader } from "../services/range.js";

/**
 * 媒体文件路由（PRD 5.6：音频流走 /audio，非 /api）。
 *   GET /audio/:storedName  音频流，支持 Range → 206（LB-06：边下边播、任意位置 seek）
 *   GET /covers/:name       封面图（内嵌封面落盘后的文件，LB-03/LB-05）
 *
 * 音频是访客级（AC-03 明确把“音频流”列入访客级）；封面不进 AC-03 的分类，
 * 但文件名是随机名（猜不到），且下面的白名单只放图片扩展名——
 * 不能顺手把 uploads 目录整个静态托管出去，那样音频就绕过门禁了。
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  opus: "audio/ogg",
};

const COVER_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** 只允许“随机名 + 扩展名”这种形状的文件名，杜绝路径穿越 */
const SAFE_NAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,5}$/;

export function createAudioRouter(config: AppConfig): Router {
  const router = Router();

  router.get(
    "/:storedName",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const name = String(req.params.storedName);
      const info = await resolveFile(config, name, MIME_BY_EXTENSION);
      if (!info) {
        sendFail(res, 404, "音频不存在");
        return;
      }

      const { fullPath, size, mime } = info;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", mime);
      // 让浏览器/代理知道可以按需缓存：文件内容永不改变（改名另存新文件）
      res.setHeader("Cache-Control", "private, max-age=86400");

      const parsed = parseRangeHeader(req.headers.range, size);
      if (parsed.kind === "unsatisfiable") {
        res.setHeader("Content-Range", `bytes */${size}`);
        sendFail(res, 416, "请求的区间超出文件范围");
        return;
      }

      if (parsed.kind === "partial") {
        const { start, end } = parsed.range;
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
        res.setHeader("Content-Length", String(end - start + 1));
        createReadStream(fullPath, { start, end }).pipe(res);
        return;
      }

      res.setHeader("Content-Length", String(size));
      createReadStream(fullPath).pipe(res);
    }),
  );

  return router;
}

export function createCoversRouter(config: AppConfig): Router {
  const router = Router();

  router.get(
    "/:name",
    asyncHandler(async (req, res) => {
      const name = String(req.params.name);
      const info = await resolveFile(config, name, COVER_MIME_BY_EXTENSION);
      if (!info) {
        sendFail(res, 404, "封面不存在");
        return;
      }

      res.setHeader("Content-Type", info.mime);
      res.setHeader("Content-Length", String(info.size));
      res.setHeader("Cache-Control", "private, max-age=86400");
      createReadStream(info.fullPath).pipe(res);
    }),
  );

  return router;
}

/**
 * 把 URL 上的名字解析成 uploads 目录里的真实文件。
 * 两道闸：文件名形状白名单（挡 ../ 之类）+ 扩展名必须在给定的 MIME 表里
 * （这就是“不能整个目录静态托管”的原因——否则 .mp3 也能从 /covers 直接取）。
 */
async function resolveFile(
  config: AppConfig,
  name: string,
  mimeTable: Record<string, string>,
): Promise<{ fullPath: string; size: number; mime: string } | null> {
  if (!SAFE_NAME.test(name)) return null;
  const mime = mimeTable[fileExtension(name)];
  if (!mime) return null;

  const fullPath = path.join(config.uploadDir, name);
  const info = await stat(fullPath).catch(() => null);
  if (!info || !info.isFile()) return null;
  return { fullPath, size: info.size, mime };
}
