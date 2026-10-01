import type { Song, SongMetaPatch } from "@qingting/shared";

/**
 * 算出“这次编辑真正改了哪些字段”（AD-02）。
 *
 * 为什么只提交改过的：服务端把提交上来的字段记成“手动编辑过”，重建索引时保住它们。
 * 如果每次都把三个字段一起发（哪怕没动过），一次编辑就会让这首歌的歌手/专辑
 * **永久脱离音频标签** —— 将来补了标签也不会自动刷新。只发改过的，记账才是准的。
 *
 * 规则：
 * - 前后都 trim 再比（用户多打一个空格不算改）；
 * - 歌名为空视为无效，丢弃该字段（界面上保存键此时是禁用的，这里是兜底）；
 * - 什么都没改 → 返回 null，调用方直接当关闭处理，不白跑一趟接口。
 */
export function diffSongMeta(
  song: Pick<Song, "title" | "artist" | "album">,
  draft: { title: string; artist: string; album: string },
): SongMetaPatch | null {
  const title = draft.title.trim();
  const artist = draft.artist.trim();
  const album = draft.album.trim();

  const patch: SongMetaPatch = {};
  if (title && title !== song.title) patch.title = title;
  if (artist !== song.artist) patch.artist = artist;
  if (album !== song.album) patch.album = album;

  return Object.keys(patch).length > 0 ? patch : null;
}
