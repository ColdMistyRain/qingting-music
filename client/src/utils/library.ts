import type { Song, Track } from "@qingting/shared";

/**
 * 曲库列表的过滤与排序（LB-04 / LB-07）。
 * 纯函数：页面只负责传参，规则集中在这里便于单测。
 */

export type SongSortKey = "title" | "artist" | "size" | "uploadedAt";
export type SortDirection = "asc" | "desc";

/** 关键词过滤（标题 / 歌手 / 专辑，忽略大小写）；空关键词返回全部 */
export function filterSongs(songs: readonly Song[], keyword: string): Song[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [...songs];

  return songs.filter((song) =>
    [song.title, song.artist, song.album].some((field) => field.toLowerCase().includes(needle)),
  );
}

/** 排序：文本按中文语序，数值按大小；返回新数组，不修改入参 */
export function sortSongs(
  songs: readonly Song[],
  key: SongSortKey,
  direction: SortDirection = "asc",
): Song[] {
  const factor = direction === "asc" ? 1 : -1;

  return [...songs].sort((a, b) => {
    if (key === "size") return (a.size - b.size) * factor;
    if (key === "uploadedAt") return a.uploadedAt.localeCompare(b.uploadedAt) * factor;
    return a[key].localeCompare(b[key], "zh-Hans-CN") * factor;
  });
}

/** 云端曲目 → 播放器曲目：URL 指向后端流式接口（LB-06），source 标记为 server */
export function songToTrack(song: Song): Track {
  return {
    id: song.id,
    source: "server",
    url: `/audio/${encodeURIComponent(song.storedName)}`,
    title: song.title,
    artist: song.artist,
    album: song.album,
    cover: song.coverUrl,
    duration: song.duration,
  };
}
