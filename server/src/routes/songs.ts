import { mkdirSync } from "node:fs";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  SONG_DUPLICATE_CODE,
  fileExtension,
  isAudioFileName,
  validateSongMeta,
  type Song,
} from "@qingting/shared";
import type { AppConfig } from "../config.js";
import { asyncHandler, sendFail, sendOk } from "../http.js";
import { requireAccess } from "../middleware/auth.js";
import { parseAudioFile, decodeUploadFileName } from "../services/metadata.js";
import { pruneCovers, removeCoverVariants } from "../services/covers.js";
import { pruneLyrics, readLyrics, removeLyrics, saveLyrics } from "../services/lyrics.js";
import {
  createSongId,
  createStoredName,
  loadSongs,
  songEditedFields,
  toSongListResult,
  updateSongs,
  withSongMeta,
} from "../services/storage.js";

/**
 * 云端曲库（PRD 3.4 / 3.12，接口见 5.6）。
 *   GET    /api/songs           列表（访客及以上，LB-04）
 *   GET    /api/songs/:id/lyrics 内嵌歌词原文（访客及以上，LR-02）
 *   POST   /api/songs/upload    上传（管理员，LB-01/02/03）
 *   PUT    /api/songs/:id       改标题/歌手/专辑（管理员，AD-02）
 *   DELETE /api/songs/:id       删除曲目与文件（管理员，LB-05）
 *   POST   /api/songs/reindex   扫 uploads 重建索引（管理员，LB-11 / AD-05）
 *
 * 索引每次现读现写（文件很小），不上内存缓存：省掉一整套缓存失效的坑。
 * 内嵌歌词不走索引：正文存 `data/lyrics/<id>.lrc`，索引里只留 `hasLyrics` 标记
 * （列表接口每次都要整读索引，几 MB 的歌词文本不该拖着一起走）。
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

  // 内嵌歌词原文（LR-02）：正文按需取，不进列表响应。没有歌词时 lyrics 为 null（不是 404）
  router.get(
    "/:id/lyrics",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      const songs = await loadSongs(config.dataDir);
      if (!songs.some((song) => song.id === id)) {
        sendFail(res, 404, "这首曲目不在曲库里");
        return;
      }
      sendOk(res, { lyrics: await readLyrics(config.dataDir, id) });
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
        hasLyrics: parsed.lyrics !== null,
      };

      // 先清再写：新上传的这个文件完全可能没有歌词，留着旧的就是挂了一首别的内容的歌词
      await removeLyrics(config.dataDir, id);
      if (parsed.lyrics) await saveLyrics(config.dataDir, id, parsed.lyrics);

      // 索引：换掉旧那条、指向刚落的这个文件。
      // 走 update（读-改-写串行）：两个上传同时完成时，各写各的那份会把对方成果盖掉
      await updateSongs(config.dataDir, (current) => [
        ...current.filter((entry) => entry.id !== duplicate?.id),
        song,
      ]);

      // 覆盖时旧的文件与旧歌词**等索引写完再删** —— 与 DELETE 路由同一条纪律
      // （v6.8 对齐：原先这里是先删后写）：中途失败最多留个孤儿文件（reindex 能捞回来），
      // 反过来就是索引里一条指向已删文件的记录 —— 界面上是一排点不动的鬼影（坑 20）
      if (duplicate) {
        await removeSongFiles(config, duplicate);
        await removeLyrics(config.dataDir, duplicate.id);
      }

      sendOk(res, song, 201);
    }),
  );

  router.put(
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

      const patch = validateSongMeta(req.body);
      if (!patch.ok) {
        sendFail(res, 400, patch.message);
        return;
      }

      // 只改索引、不动文件里的标签：改写音频标签是另一件事（要重写容器，风险高），
      // 这里的语义是“曲库里显示的元信息”，而 editedFields 会保证重建索引不会把它冲掉
      const updated = withSongMeta(song, patch.value);
      await updateSongs(config.dataDir, (current) =>
        current.map((entry) => (entry.id === id ? updated : entry)),
      );
      sendOk(res, updated);
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
      await updateSongs(config.dataDir, (current) => current.filter((entry) => entry.id !== id));
      await removeSongFiles(config, song);
      await removeLyrics(config.dataDir, id);

      sendOk(res, { id });
    }),
  );

  router.post(
    "/reindex",
    requireAccess("admin"),
    asyncHandler(async (_req, res) => {
      const names = await readdir(config.uploadDir).catch(() => [] as string[]);
      const audioNames = names.filter(isAudioFileName);
      let added = 0;
      let before = 0;

      // 整段重建都跑在 update 里（读-改-写串行）：重建期间并发上传的那首歌不会被这次覆盖写掉
      const songs = await updateSongs(config.dataDir, async (existing) => {
        before = existing.length;
        const known = new Map(existing.map((song) => [song.storedName, song]));
        const next: Song[] = [];

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

          // 歌词跟着重建一起重抽：以前上传的曲目就是这样补上歌词的
          if (parsed.lyrics) await saveLyrics(config.dataDir, id, parsed.lyrics);
          else await removeLyrics(config.dataDir, id);

          // 手动改过的字段（AD-02）必须保住：重建索引是拿文件里的标签重抽的，
          // 不记账的话用户填的歌名/歌手会被一次 reindex 冲回原样
          const edited = previous ? songEditedFields(previous) : [];
          const keep = (field: "title" | "artist" | "album", parsedValue: string): string =>
            previous && edited.includes(field) ? previous[field] : parsedValue;

          next.push({
            id,
            title: keep("title", parsed.title),
            artist: keep("artist", parsed.artist),
            album: keep("album", parsed.album),
            duration: parsed.duration,
            coverUrl: coverName ? `/covers/${coverName}` : (previous?.coverUrl ?? null),
            originalName,
            storedName: name,
            size: info.size,
            uploadedAt: previous?.uploadedAt ?? info.mtime.toISOString(),
            hasLyrics: parsed.lyrics !== null,
            ...(edited.length > 0 ? { editedFields: [...edited] } : {}),
          });
          if (!previous) added += 1;
        }

        return next;
      });

      // 收尾：索引里已经没有的歌词文件一并清掉（只能是从前删歌时留下的余），
      // 不把数量报给前端：这是内部清理，用户不需要知道
      await pruneLyrics(
        config.dataDir,
        songs.map((song) => song.id),
      );
      // 封面同样收尾（v6.8）：封面名带曲目 id，覆盖上传与重建都会换 id，
      // 不清理的话孤儿封面只增不减（歌词早就有这一手了）
      await pruneCovers(
        config,
        songs.flatMap((song) => (song.coverUrl ? [path.basename(song.coverUrl)] : [])),
      );

      sendOk(res, {
        scanned: audioNames.length,
        added,
        removed: before - (audioNames.length - added),
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
  // 先清掉这首歌名下**其它扩展名**的旧封面（v6.8）：索引只指向/新写下的那个，
  // 不先清的话 jpg 与 png 会同时留着、没人再引用，只会在 uploads 里慢慢堆
  await removeCoverVariants(config, id);
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
