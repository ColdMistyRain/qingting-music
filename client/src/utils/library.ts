import type { Song, Track } from "@qingting/shared";

/**
 * 曲库列表的过滤与排序（LB-04 / LB-07）。
 * 纯函数：页面只负责传参，规则集中在这里便于单测。
 */

export type SongSortKey = "title" | "artist" | "size" | "uploadedAt";
export type SortDirection = "asc" | "desc";

/** 关键词过滤（标题 / 歌手 / 专辑，忽略大小写）；空关键词返回全部 */
export function filterSongs<T extends { title: string; artist: string; album: string }>(
  songs: readonly T[],
  keyword: string,
): T[] {
  // 结构化约束而非 Song：在线歌单的曲目过滤（v6.35）用的是 Track，字段同形
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [...songs];

  return songs.filter((song) =>
    [song.title, song.artist, song.album].some((field) => field.toLowerCase().includes(needle)),
  );
}

/** 排序：文本按中文语序，数值按大小；返回新数组，不修改入参 */ export function sortSongs(
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
    // 有内嵌歌词时，播放器会在开播时去 /api/songs/:id/lyrics 拉一次（LR-02）
    hasLyrics: song.hasLyrics === true,
  };
}

/**
 * 带缓存的 `songToTrack`（v6.9）：列表页每次按键都会 `filter` + `map` 一遍（369 首 = 369 次
 * `encodeURIComponent`），而且**每次都会造一批新对象** —— 行组件的 props 因此次次都变，
 * 浅比较救不了，整个列表跟着重渲染。按 `Song` 对象缓存（`WeakMap`，不阻止回收）：
 * 同一条曲目只要还是同一个对象（曲库更新是**整体替换**该条对象的不可变写法），
 * 拿到的就是同一个 `Track`，没改的行不会被重渲染。
 * 纯函数版本 `songToTrack` 保留：需要“每次都新对象”的场景与单测仍用它。
 */
const trackCache = new WeakMap<Song, Track>();

export function songToTrackCached(song: Song): Track {
  const cached = trackCache.get(song);
  if (cached) return cached;
  const track = songToTrack(song);
  trackCache.set(song, track);
  return track;
}
