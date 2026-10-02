import {
  playlistItemKey,
  toPlaylistItem,
  type Playlist,
  type PlaylistItem,
  type Song,
  type Track,
} from "@qingting/shared";
import { songToTrack } from "./library";

/** 歌单里一条曲目的可播状态（PS-03；不可播时列表照常显示、只是点不动） */
export type PlaylistEntryState = "ready" | "missing-cloud" | "missing-local" | "online-off";

export interface PlaylistEntry {
  item: PlaylistItem;
  /** 身份键（与去重、服务端同一套规则） */
  key: string;
  state: PlaylistEntryState;
  /** 能播时给出播放器曲目；不能播就是 null */
  track: Track | null;
  /** 不能播时给一句人话，列表上直接显示 */
  reason: string;
  /** 显示用的歌名（不是歌单里存的那份：详见 displayMeta） */
  title: string;
  /** 显示用的歌手 */
  artist: string;
}

/**
 * 显示用歌名/歌手：能对上实时曲目就用它的 —— 歌单里存的是**加入那一刻的快照**，
 * 曲目信息被手动改过（AD-02）或云端标签重抽过之后，快照就旧了，
 * 显示层必须优先用实时的，否则“曲库改了名、歌单里还是旧的”。
 */
function displayMeta(item: PlaylistItem, track: Track | null): { title: string; artist: string } {
  return { title: track?.title ?? item.title, artist: track?.artist ?? item.artist };
}

/** 解析歌单里的一条：能不能播、拿什么去播 */
export function resolvePlaylistEntry(
  item: PlaylistItem,
  sources: { songs: readonly Song[]; queue: readonly Track[] },
): PlaylistEntry {
  const key = playlistItemKey(item);

  // 在线音源还没接入（PRD 3.5）：先把引用留住，等接上了就能直接播
  if (item.source === "online") {
    return {
      item,
      key,
      state: "online-off",
      track: null,
      reason: "在线音源还没接上",
      ...displayMeta(item, null),
    };
  }

  // 本地曲目：refId 是“歌手|曲名”稳定键，拿当前队列里的实时 Track 来对（它带 Blob URL）
  if (item.source === "local") {
    const live = sources.queue.find(
      (track) => track.source === "local" && playlistItemKey(toPlaylistItem(track)) === key,
    );
    return live
      ? { item, key, state: "ready", track: live, reason: "", ...displayMeta(item, live) }
      : {
          item,
          key,
          state: "missing-local",
          track: null,
          reason: "本地文件不在当前列表里，重新拖进来就能播",
          ...displayMeta(item, null),
        };
  }

  const song = sources.songs.find((entry) => entry.id === item.refId);
  if (!song) {
    return {
      item,
      key,
      state: "missing-cloud",
      track: null,
      reason: "已经不在曲库里了",
      ...displayMeta(item, null),
    };
  }

  const track = songToTrack(song);
  return { item, key, state: "ready", track, reason: "", ...displayMeta(item, track) };
}

/** 整张歌单解析一遍（保持歌单自身的顺序） */
export function resolvePlaylist(
  playlist: Playlist,
  sources: { songs: readonly Song[]; queue: readonly Track[] },
): PlaylistEntry[] {
  return playlist.items.map((item) => resolvePlaylistEntry(item, sources));
}

/** 歌单总时长（秒）：只累加知道时长的那几条 */
export function playlistTotalDuration(items: readonly PlaylistItem[]): number {
  return items.reduce(
    (sum, item) => (typeof item.duration === "number" ? sum + item.duration : sum),
    0,
  );
}

/** 整单播放（PS-03）：只挑能播的，从 fromIndex（相对于**能播的那批**）开始 */
export function playableTracks(entries: readonly PlaylistEntry[]): Track[] {
  return entries.map((entry) => entry.track).filter((track): track is Track => track !== null);
}

/**
 * 把第 from 条挪到第 to 条的位置（PS-04 拖拽/键盘排序）。
 *
 * 语义是“**插在目标位置**”而不是“跟目标互换”：往下拖时把中间那几条整体前移一格、
 * 往上拖时整体后移一格 —— 拖拽交互的直觉就是这个，互换会让“拖到末尾”变成一件做不到的事。
 * 越界会夹到两端（拖到列表外也能落到头/尾）；from 本身越界或目标就是原位时，
 * 返回一份**同顺序**的副本（调用方可以不区分）。不改变入参（服务端那一份是唯一真相，
 * 本地列表随时会被它的响应回填）。
 */
export function movePlaylistItem(
  items: readonly PlaylistItem[],
  from: number,
  to: number,
): PlaylistItem[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;

  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;

  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}
