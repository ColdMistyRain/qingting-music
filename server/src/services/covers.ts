import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { COVER_MIME_BY_EXTENSION } from "@qingting/shared";
import type { AppConfig } from "../config.js";

/**
 * 封面文件（`uploads/<曲目 id>-<随机串>.<扩展名>`）的一处实现（v6.8 / v6.13）。
 *
 * 音频与封面同住 `uploads/`，靠“随机名 + 扩展名”区分：这里只认图片扩展名，
 * 所以清理逻辑**不可能误删音频**（音频扩展名是 mp3/flac/wav/ogg/m4a/aac/opus）。
 *
 * ⚠ 为什么文件名里要带一段随机串（v6.13）：手动换封面是“**新文件**取代旧文件”，
 * 而不是同名的覆盖写。两个理由：
 * ① `GET /covers/:name` 的缓存是 `max-age=86400`（文件内容本来永不改变），
 *    同名覆盖会让换完封面的人最长一天看不到新图；
 * ② 与音频落盘同一条纪律 —— 名字不变、内容会变，是所有缓存与清理逻辑的噩梦。
 * 兼容早期那批只有 `<曲目 id>.<扩展名>` 的封面：它们照旧能取、能被 `pruneCovers` 收尾，
 * 只是不再新生成这种名字。
 *
 * 为什么不“按 id 前缀去删旧封面”：`nanoid()` 的字母表里就有 `-`，一个 id 完全可能是
 * 另一个 id 的前缀加横线 —— 前缀匹配会删到**别人**的封面。删旧封面一律按
 * **索引里那个准确的文件名**（`coverNameOf`）或 `pruneCovers` 的“引用集合”来做。
 */

/** 封面文件名的形状：随机 id + 图片扩展名（两种命名都匹配） */
const COVER_NAME = /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;

/** 从 `song.coverUrl`（`/covers/<name>`）取出文件名；没有有效封面返回空串 */
export function coverNameOf(coverUrl: string | null): string {
  if (!coverUrl) return "";
  // 按 URL 路径取值再取 basename：既兼容带查询串的值，也挡住任何路径成分
  const name = path.basename(coverUrl.split(/[?#]/)[0] ?? "");
  return COVER_NAME.test(name) ? name : "";
}

/** 新封面的落盘名：曲目 id + 随机串（见文件头注释） */
export function newCoverName(id: string, extension: string): string {
  return `${path.basename(id)}-${nanoid()}.${extension}`;
}

/** 封面文件名的 MIME；白名单里没有就是 null，调用方据此拒收 */
export function coverMime(name: string): string | null {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return COVER_MIME_BY_EXTENSION[extension] ?? null;
}

/** 落盘一张封面（先建目录，再写文件） */
export async function writeCover(config: AppConfig, name: string, data: Buffer): Promise<void> {
  await mkdir(config.uploadDir, { recursive: true });
  await writeFile(path.join(config.uploadDir, name), data);
}

/** 删一个封面文件（按准确文件名）；文件不在、被占用都无所谓 */
export async function removeCoverByName(config: AppConfig, name: string): Promise<void> {
  if (!COVER_NAME.test(name)) return;
  await removeQuietly(path.join(config.uploadDir, name));
}

async function removeQuietly(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // 文件不在、被占用都无所谓：清理是收尾工作，不该让调用方失败
  }
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
  await Promise.all(orphans.map((name) => removeCoverByName(config, name)));
  return orphans.length;
}
