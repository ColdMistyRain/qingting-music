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
}

/** 解析歌单里的一条：能不能播、拿什么去播 */
export function resolvePlaylistEntry(
  item: PlaylistItem,
  sources: { songs: readonly Song[]; queue: readonly Track[] },
): PlaylistEntry {
  const key = playlistItemKey(item);

  // 在线音源还没接入（PRD 3.5）：先把引用留住，等接上了就能直接播
  if (item.source === "online") {
    return { item, key, state: "online-off", track: null, reason: "在线音源还没接上" };
  }

  // 本地曲目：refId 是“歌手|曲名”稳定键，拿当前队列里的实时 Track 来对（它带 Blob URL）
  if (item.source === "local") {
    const live = sources.queue.find(
      (track) => track.source === "local" && playlistItemKey(toPlaylistItem(track)) === key,
    );
    return live
      ? { item, key, state: "ready", track: live, reason: "" }
      : {
          item,
          key,
          state: "missing-local",
          track: null,
          reason: "本地文件不在当前列表里，重新拖进来就能播",
        };
  }

  const song = sources.songs.find((entry) => entry.id === item.refId);
  return song
    ? { item, key, state: "ready", track: songToTrack(song), reason: "" }
    : { item, key, state: "missing-cloud", track: null, reason: "已经不在曲库里了" };
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
