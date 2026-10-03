import {
  playlistItemKey,
  toPlaylistItem,
  type Playlist,
  type PlaylistItem,
  type Song,
  type Track,
} from "@qingting/shared";
import { songToTrackCached } from "./library";
import { parseOnlineTrackId } from "./onlineTracks";

/** 歌单里一条曲目的可播状态（PS-03；不可播时列表照常显示、只是点不动） */
export type PlaylistEntryState = "ready" | "missing-cloud" | "missing-local" | "online-off";

/** 解析歌单条目时的数据源（onlineEnabled：ON-04 的开关，决定在线引用是“能播”还是“没接”） */
export interface PlaylistSources {
  songs: readonly Song[];
  queue: readonly Track[];
  onlineEnabled: boolean;
}

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
  /** 显示用的封面（同样实时优先：换过封面 / 曲目被删之后，快照里的那个 URL 已经是 404） */
  cover: string | null;
}

/**
 * 显示用歌名/歌手：能对上实时曲目就用它的 —— 歌单里存的是**加入那一刻的快照**，
 * 曲目信息被手动改过（AD-02）或云端标签重抽过之后，快照就旧了，
 * 显示层必须优先用实时的，否则“曲库改了名、歌单里还是旧的”。
 *
 * **封面同理（v6.13）**：封面文件换了名字（手动换封面 = 新文件），
 * 而快照里存的是旧 URL —— 旧文件已经被删，直接拿它渲染就是一张破图。
 * 所以封面跟歌名/歌手走同一条规则，不为它开特例。
 */
function displayMeta(
  item: PlaylistItem,
  track: Track | null,
): { title: string; artist: string; cover: string | null } {
  return {
    title: track?.title ?? item.title,
    artist: track?.artist ?? item.artist,
    cover: track?.cover ?? item.cover ?? null,
  };
}

/** 解析歌单里的一条：能不能播、拿什么去播 */
export function resolvePlaylistEntry(
  item: PlaylistItem,
  sources: PlaylistSources,
): PlaylistEntry {
  const key = playlistItemKey(item);

  // 在线引用（ON-03 接入后可播）：track 的 url 留空，开播时由 player store 现解析直链。
  // 音源没配置（ON-04）或引用键形状不对时留住条目、说明原因，不静默消失。
  if (item.source === "online") {
    const refId = item.refId ?? "";
    if (!sources.onlineEnabled || !parseOnlineTrackId(refId)) {
      return {
        item,
        key,
        state: "online-off",
        track: null,
        reason: sources.onlineEnabled ? "这条在线引用没法识别" : "在线音源未配置",
        ...displayMeta(item, null),
      };
    }
    const track: Track = {
      id: refId,
      source: "online",
      url: "",
      title: item.title,
      artist: item.artist,
      album: "",
      cover: item.cover ?? null,
      duration: item.duration ?? null,
    };
    return { item, key, state: "ready", track, reason: "", ...displayMeta(item, track) };
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

  // 缓存版：同一个 Song 反复解析拿同一个 Track 对象，行组件浅比较才拦得住重渲染（v6.9）
  const track = songToTrackCached(song);
  return { item, key, state: "ready", track, reason: "", ...displayMeta(item, track) };
}

/** 整张歌单解析一遍（保持歌单自身的顺序） */
export function resolvePlaylist(
  playlist: Playlist,
  sources: PlaylistSources,
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
