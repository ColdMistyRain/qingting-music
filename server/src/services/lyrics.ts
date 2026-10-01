import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 内嵌歌词的存储（LR-02 的第一优先级，云端曲目）。
 *
 * 一首歌一份文件：`data/lyrics/<songId>.lrc`。
 * **为什么不塞进 `songs.json`**：那个文件每次列表请求都要整读一遍（PRD 12 的索引），
 * 歌词文本一首几 KB，一千首就是几 MB 的解析开销；列表只需要知道「有没有」，
 * 所以索引里只留一个 `hasLyrics` 标记，正文按需取。
 *
 * 写入同样用「先写 .tmp 再 rename」的原子替换（与曲库索引一致）；
 * 读取失败一律当"没有歌词"，不让接口 500。
 */

export function lyricsDir(dataDir: string): string {
  return path.join(dataDir, "lyrics");
}

export function lyricsFilePath(dataDir: string, songId: string): string {
  // songId 是 nanoid，但仍然过一遍 basename：任何来自请求的字符串都不该直接拼进路径
  return path.join(lyricsDir(dataDir), `${path.basename(songId)}.lrc`);
}

/** 原子写入歌词原文 */
export async function saveLyrics(dataDir: string, songId: string, text: string): Promise<void> {
  await mkdir(lyricsDir(dataDir), { recursive: true });
  const target = lyricsFilePath(dataDir, songId);
  const temp = `${target}.tmp`;
  await writeFile(temp, text, "utf8");
  await rename(temp, target);
}

/** 读歌词；没有这个文件（或读不动）就返回 null */
export async function readLyrics(dataDir: string, songId: string): Promise<string | null> {
  try {
    const text = await readFile(lyricsFilePath(dataDir, songId), "utf8");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** 删歌词（删除曲目时调用）；文件本来就不在也算成功 */
export async function removeLyrics(dataDir: string, songId: string): Promise<void> {
  try {
    await unlink(lyricsFilePath(dataDir, songId));
  } catch {
    // ENOENT 等：没有就没有，调用方不需要知道
  }
}

/** 目录里现有的歌词对应的曲目 id（重建索引时用来清孤儿文件） */
export async function listLyricSongIds(dataDir: string): Promise<string[]> {
  try {
    const names = await readdir(lyricsDir(dataDir));
    return names.filter((name) => name.endsWith(".lrc")).map((name) => name.slice(0, -4));
  } catch {
    return [];
  }
}

/** 删掉索引里已经不存在的那批歌词文件（重建索引的收尾） */
export async function pruneLyrics(dataDir: string, keepIds: readonly string[]): Promise<number> {
  const keep = new Set(keepIds);
  const existing = await listLyricSongIds(dataDir);
  const orphans = existing.filter((id) => !keep.has(id));
  await Promise.all(orphans.map((id) => removeLyrics(dataDir, id)));
  return orphans.length;
}
