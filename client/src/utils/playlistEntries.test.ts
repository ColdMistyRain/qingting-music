import { describe, expect, it } from "vitest";
import type { Playlist, PlaylistItem, Song, Track } from "@qingting/shared";
import {
  playableTracks,
  playlistTotalDuration,
  resolvePlaylist,
  resolvePlaylistEntry,
} from "./playlistEntries";

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    title: "海阔天空",
    artist: "BEYOND",
    album: "乐与怒",
    duration: 325,
    coverUrl: "/covers/a.jpg",
    originalName: "BEYOND-海阔天空.mp3",
    storedName: "abc123.mp3",
    size: 1024,
    uploadedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function localTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "blob-1",
    source: "local",
    url: "blob:http://localhost/abc",
    title: "夜行",
    artist: "林晚",
    album: "未知专辑",
    cover: null,
    duration: 210,
    ...overrides,
  };
}

const cloudItem: PlaylistItem = {
  source: "server",
  refId: "song-1",
  title: "海阔天空",
  artist: "BEYOND",
  duration: 325,
};
const localItem: PlaylistItem = {
  source: "local",
  refId: "林晚|夜行",
  title: "夜行",
  artist: "林晚",
};

describe("resolvePlaylistEntry（PS-03：能不能播、拿什么播）", () => {
  it("云端曲目还在曲库：给出可播的 Track（走 /audio/ 流）", () => {
    const entry = resolvePlaylistEntry(cloudItem, { songs: [song()], queue: [] });

    expect(entry.state).toBe("ready");
    expect(entry.track).toMatchObject({ id: "song-1", source: "server", url: "/audio/abc123.mp3" });
    expect(entry.key).toBe("server:song-1");
  });

  it("云端曲目被删了：不假装能播，给出原因", () => {
    const entry = resolvePlaylistEntry(cloudItem, { songs: [], queue: [] });

    expect(entry.state).toBe("missing-cloud");
    expect(entry.track).toBeNull();
    expect(entry.reason).toContain("不在曲库");
  });

  it("本地曲目正在当前列表里：直接复用那条实时 Track（带 Blob URL）", () => {
    const live = localTrack();
    const entry = resolvePlaylistEntry(localItem, { songs: [], queue: [live] });

    expect(entry.state).toBe("ready");
    expect(entry.track).toBe(live);
  });

  it("本地曲目不在当前列表里（换了设备/刷新过）：标记本地缺失", () => {
    const entry = resolvePlaylistEntry(localItem, {
      songs: [],
      queue: [localTrack({ title: "别的" })],
    });

    expect(entry.state).toBe("missing-local");
    expect(entry.reason).toContain("重新拖进来");
  });

  it("本地曲目靠“歌手|曲名”匹配，不看每次都变的本地 id", () => {
    const entry = resolvePlaylistEntry(localItem, {
      songs: [],
      queue: [localTrack({ id: "另一个-blob-id" })],
    });

    expect(entry.state).toBe("ready");
  });

  it("在线曲目：留着引用，但说明音源还没接上（3.5）", () => {
    const entry = resolvePlaylistEntry(
      { source: "online", refId: "netease:123", title: "在线歌", artist: "某某" },
      { songs: [], queue: [] },
    );

    expect(entry.state).toBe("online-off");
    expect(entry.track).toBeNull();
  });
});

describe("resolvePlaylist / playableTracks / playlistTotalDuration", () => {
  const playlist: Playlist = {
    id: "p1",
    name: "夜行歌单",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    items: [
      cloudItem,
      localItem,
      { source: "online", refId: "netease:1", title: "在线", artist: "人" },
    ],
  };

  it("按歌单顺序逐条解析，条数一致", () => {
    const entries = resolvePlaylist(playlist, { songs: [song()], queue: [localTrack()] });

    expect(entries.map((entry) => entry.state)).toEqual(["ready", "ready", "online-off"]);
  });

  it("整单播放只挑能播的，顺序不变", () => {
    const entries = resolvePlaylist(playlist, { songs: [song()], queue: [localTrack()] });

    expect(playableTracks(entries).map((track) => track.id)).toEqual(["song-1", "blob-1"]);
    expect(playableTracks(resolvePlaylist(playlist, { songs: [], queue: [] }))).toEqual([]);
  });

  it("总时长只累加知道时长的那几条（未知的不算 0）", () => {
    expect(playlistTotalDuration([cloudItem, localItem])).toBe(325);
    expect(playlistTotalDuration([cloudItem, { ...cloudItem, duration: undefined }])).toBe(325);
    expect(playlistTotalDuration([])).toBe(0);
  });
});
