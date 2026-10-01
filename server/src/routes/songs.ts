import { mkdirSync } from "node:fs";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { SONG_DUPLICATE_CODE, fileExtension, isAudioFileName, type Song } from "@qingting/shared";
import type { AppConfig } from "../config.js";
import { asyncHandler, sendFail, sendOk } from "../http.js";
import { requireAccess } from "../middleware/auth.js";
import { parseAudioFile, decodeUploadFileName } from "../services/metadata.js";
import {
  createSongId,
  createStoredName,
  loadSongs,
  saveSongs,
  toSongListResult,
} from "../services/storage.js";

/**
 * 云端曲库（PRD 3.4 / 3.12，接口见 5.6）。
 *   GET    /api/songs           列表（访客及以上，LB-04）
 *   POST   /api/songs/upload    上传（管理员，LB-01/02/03）
 *   DELETE /api/songs/:id       删除曲目与文件（管理员，LB-05）
 *   POST   /api/songs/reindex   扫 uploads 重建索引（管理员，LB-11 / AD-05）
 *
 * 索引每次现读现写（文件很小），不上内存缓存：省掉一整套缓存失效的坑。
 */

/** 扩展名不在白名单（LB-02）：交给下面的错误映射翻成 415 */
class UnsupportedAudioError extends Error {}

export function createSongsRouter(config: AppConfig): Router {
  const router = Router();
  // multer 的 destination 是个同步回调，这里先把上传目录准备好
  mkdirSync(config.uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, config.uploadDir),
      // 落盘名与 id 分开生成：随机名杜绝路径穿越，也避免同名文件互相覆盖
      filename: (_req, file, cb) => cb(null, createStoredName(fileExtension(file.originalname))),
    }),
    limits: { fileSize: config.maxUploadSize, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!isAudioFileName(file.originalname)) {
        cb(new UnsupportedAudioError("只支持 MP3 / FLAC / WAV / OGG / M4A / AAC / OPUS 音频"));
        return;
      }
      cb(null, true);
    },
  });

  router.get(
    "/",
    requireAccess("visitor"),
    asyncHandler(async (_req, res) => {
      sendOk(res, toSongListResult(await loadSongs(config.dataDir)));
    }),
  );

  router.post(
    "/upload",
    requireAccess("admin"),
    upload.single("file"),
    mapUploadError,
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) {
        sendFail(res, 400, "没有收到文件（字段名应为 file）");
        return;
      }

      const songs = await loadSongs(config.dataDir);
      const overwrite = readOverwrite(req.query.overwrite);
      // busboy 按 latin1 解 multipart 里的 filename，中文名会变成乱码，先转回来
      const originalName = decodeUploadFileName(file.originalname);
      // 重复判定：同名 + 同大小（LB-02）。文件已经落盘，此时才拿得到 size
      const duplicate = songs.find(
        (song) => song.originalName === originalName && song.size === file.size,
      );

      if (duplicate && !overwrite) {
        await removeQuietly(file.path);
        sendFail(res, 409, "已有同名同大小的曲目", SONG_DUPLICATE_CODE);
        return;
      }

      const parsed = await parseAudioFile(file.path, originalName);
      const id = createSongId();
      const coverName = await saveCover(config, id, parsed.cover);

      const song: Song = {
        id,
        title: parsed.title,
        artist: parsed.artist,
        album: parsed.album,
        duration: parsed.duration,
        coverUrl: coverName ? `/covers/${coverName}` : null,
        originalName,
        storedName: path.basename(file.path),
        size: file.size,
        uploadedAt: new Date().toISOString(),
      };

      // 覆盖：先把旧文件删掉再写索引（反过来的话，中途失败会留下指向已删文件的条目）
      if (duplicate) await removeSongFiles(config, duplicate);
      const kept = songs.filter((song) => song.id !== duplicate?.id);
      await saveSongs(config.dataDir, [...kept, song]);

      sendOk(res, song, 201);
    }),
  );

  router.delete(
    "/:id",
    requireAccess("admin"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const songs = await loadSongs(config.dataDir);
      const song = songs.find((entry) => entry.id === id);
      if (!song) {
        sendFail(res, 404, "这首曲目不在曲库里");
        return;
      }

      // 先写索引再删文件：万一删文件失败，最多留个孤儿文件（reindex 能捞回来），
      // 反过来则会留下指向已删文件的条目，界面上就是一排点不开的鬼影
      await saveSongs(
        config.dataDir,
        songs.filter((entry) => entry.id !== id),
      );
      await removeSongFiles(config, song);

      sendOk(res, { id });
    }),
  );

  router.post(
    "/reindex",
    requireAccess("admin"),
    asyncHandler(async (_req, res) => {
      const existing = await loadSongs(config.dataDir);
      const names = await readdir(config.uploadDir).catch(() => [] as string[]);
      const audioNames = names.filter(isAudioFileName);
      const known = new Map(existing.map((song) => [song.storedName, song]));

      const songs: Song[] = [];
      let added = 0;

      for (const name of audioNames) {
        const fullPath = path.join(config.uploadDir, name);
        const info = await stat(fullPath);
        const previous = known.get(name);
        // 重建时尽量保住 originalName：文件名回退解析（LB-03）靠它，
        // 只有索引也丢了才退化成用落盘随机名（此时至少还有标签）
        const originalName = previous?.originalName ?? name;
        const parsed = await parseAudioFile(fullPath, originalName);
        const id = previous?.id ?? createSongId();
        const coverName = await saveCover(config, id, parsed.cover);

        songs.push({
          id,
          title: parsed.title,
          artist: parsed.artist,
          album: parsed.album,
          duration: parsed.duration,
          coverUrl: coverName ? `/covers/${coverName}` : (previous?.coverUrl ?? null),
          originalName,
          storedName: name,
          size: info.size,
          uploadedAt: previous?.uploadedAt ?? info.mtime.toISOString(),
        });
        if (!previous) added += 1;
      }

      await saveSongs(config.dataDir, songs);

      sendOk(res, {
        scanned: audioNames.length,
        added,
        removed: existing.length - (audioNames.length - added),
        total: songs.length,
      });
    }),
  );

  return router;
}

/** multer 的错误翻译成 HTTP 语义：超限 413、格式不符 415、其余 400（都是文件本身的问题） */
function mapUploadError(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (error instanceof UnsupportedAudioError) {
    sendFail(res, 415, error.message);
    return;
  }
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      sendFail(res, 413, "文件超过单文件大小上限");
      return;
    }
    sendFail(res, 400, "上传请求不合法");
    return;
  }
  next(error);
}

function readOverwrite(value: unknown): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "1" || first === "true";
}

/** 内嵌封面落盘（LB-03）：与音频同目录，文件名用曲目 id */
async function saveCover(
  config: AppConfig,
  id: string,
  cover: { data: Buffer; extension: string } | null,
): Promise<string | null> {
  if (!cover) return null;
  const name = `${id}.${cover.extension}`;
  mkdirSync(config.uploadDir, { recursive: true });
  await writeFile(path.join(config.uploadDir, name), cover.data);
  return name;
}

/** 删除一首曲目对应的音频与封面文件（LB-05） */
async function removeSongFiles(config: AppConfig, song: Song): Promise<void> {
  await removeQuietly(path.join(config.uploadDir, song.storedName));
  const coverName = song.coverUrl ? path.basename(song.coverUrl) : "";
  if (coverName) await removeQuietly(path.join(config.uploadDir, coverName));
}

/** 删文件失败不该让接口挂掉：文件不在、被占用都无所谓，用户要的是“列表里没了” */
async function removeQuietly(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // 忽略：404 与权限问题都不影响索引更新
  }
}
