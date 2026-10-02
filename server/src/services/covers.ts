import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";

/**
 * 封面文件（内嵌封面落盘后的 `<曲目 id>.<扩展名>`）的一处实现（v6.8）。
 *
 * 音频与封面同住 `uploads/`，靠“随机名 + 扩展名”区分：这里只认图片扩展名，
 * 所以清理逻辑**不可能误删音频**（音频扩展名是 mp3/flac/wav/ogg/m4a/aac/opus）。
 *
 * 为什么需要它：封面名里带曲目 id，而 id 是**新建曲目时现生成**的（覆盖上传、重建索引
 * 都会换 id）。于是三种情况会留下孤儿封面文件：
 * ① 覆盖上传（旧 id 的封面没人再引用）；② 重建索引时解析出的扩展名变了（jpg ↔ png）；
 * ③ 删歌只删了索引里当前指向的那一个。歌词有 `pruneLyrics` 收尾，封面原先没有 —— 会一直涨。
 */

/** 封面扩展名 → MIME：落盘、清理、`GET /covers` 的扩展名白名单共用这一份 */
export const COVER_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** 封面文件名的形状：随机 id + 图片扩展名 */
const COVER_NAME = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;

/** 某个曲目名下可能存在的所有封面文件 */
function coverVariants(dir: string, id: string): string[] {
  return Object.keys(COVER_MIME_BY_EXTENSION).map((ext) => path.join(dir, `${id}.${ext}`));
}

async function removeQuietly(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // 文件不在、被占用都无所谓：清理是收尾工作，不该让调用方失败
  }
}

/**
 * 写新封面之前，先把这首歌名下的**其它扩展名**删掉。
 * 不删的话 `pictures.<jpg>` 与 `pictures.<png>` 会同时留着，而索引只指向其中一个。
 */
export async function removeCoverVariants(config: AppConfig, id: string): Promise<void> {
  await Promise.all(coverVariants(config.uploadDir, id).map(removeQuietly));
}

/**
 * 删掉索引里已经不用的封面文件（重建索引 / 覆盖上传的收尾）——与 `pruneLyrics` 对称。
 * `keepNames` 是索引里**还在引用**的封面文件名（`song.coverUrl` 的 basename）。
 * 返回删掉几个，供调用方打日志；数量不进接口响应（内部清理，用户不需要知道）。
 */
export async function pruneCovers(
  config: AppConfig,
  keepNames: readonly string[],
): Promise<number> {
  const keep = new Set(keepNames);
  const names = await readdir(config.uploadDir).catch(() => [] as string[]);
  const orphans = names.filter((name) => COVER_NAME.test(name) && !keep.has(name));
  await Promise.all(orphans.map((name) => removeQuietly(path.join(config.uploadDir, name))));
  return orphans.length;
}
