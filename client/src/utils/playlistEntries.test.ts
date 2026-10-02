import { describe, expect, it } from "vitest";
import type { Playlist, PlaylistItem, Song, Track } from "@qingting/shared";
import {
  movePlaylistItem,
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

  it("显示用的歌名/歌手优先用实时曲目（AD-02：曲库改过名，歌单里不能还是旧的）", () => {
    const edited = song({ title: "海阔天空（现场版）", artist: "BEYOND 1993" });
    const entry = resolvePlaylistEntry(cloudItem, { songs: [edited], queue: [] });

    expect(entry.title).toBe("海阔天空（现场版）");
    expect(entry.artist).toBe("BEYOND 1993");
    expect(entry.item.title).toBe("海阔天空"); // 歌单里存的快照不动，只是不拿来显示
  });

  it("对不上实时曲目时退回歌单里存的快照（离线/被删时至少还有名字）", () => {
    const missing = resolvePlaylistEntry(cloudItem, { songs: [], queue: [] });
    expect(missing.title).toBe("海阔天空");
    expect(missing.artist).toBe("BEYOND");

    const local = resolvePlaylistEntry(localItem, { songs: [], queue: [] });
    expect(local.title).toBe("夜行");
    expect(local.artist).toBe("林晚");

    const online = resolvePlaylistEntry(
      { source: "online", refId: "netease:9", title: "在线歌", artist: "某某" },
      { songs: [], queue: [] },
    );
    expect(online.title).toBe("在线歌");
  });

  it("封面同样实时优先：手动换过封面之后，快照里那个旧 URL 已经是 404（v6.13）", () => {
    const replaced = song({ coverUrl: "/covers/-id-newName.png" });
    const entry = resolvePlaylistEntry(
      { ...cloudItem, cover: "/covers/-id-oldName.jpg" },
      { songs: [replaced], queue: [] },
    );

    expect(entry.cover).toBe("/covers/-id-newName.png");
    // 歌单里存的快照不动，只是不拿来渲染
    expect(entry.item.cover).toBe("/covers/-id-oldName.jpg");
  });

  it("实时曲目没有封面时也退回快照；两边都没有就是 null", () => {
    const withoutCover = song({ coverUrl: null });
    const fallback = resolvePlaylistEntry(
      { ...cloudItem, cover: "/covers/snapshot.jpg" },
      { songs: [withoutCover], queue: [] },
    );
    expect(fallback.cover).toBe("/covers/snapshot.jpg");

    const none = resolvePlaylistEntry(cloudItem, { songs: [withoutCover], queue: [] });
    expect(none.cover).toBeNull();
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

describe("movePlaylistItem（PS-04：拖拽/键盘排序）", () => {
  /** 用 refId 当身份，看得清哪一条挪到哪儿了 */
  const items: PlaylistItem[] = ["a", "b", "c", "d"].map((refId) => ({
    source: "server",
    refId,
    title: refId,
    artist: "人",
  }));
  const order = (list: readonly PlaylistItem[]) => list.map((item) => item.refId).join("");

  it("往下拖：中间那几条整体前移一格（是“插入”，不是互换）", () => {
    expect(order(movePlaylistItem(items, 0, 2))).toBe("bcad");
    expect(order(movePlaylistItem(items, 0, 3))).toBe("bcda");
  });

  it("往上拖：中间那几条整体后移一格", () => {
    expect(order(movePlaylistItem(items, 3, 1))).toBe("adbc");
    expect(order(movePlaylistItem(items, 2, 0))).toBe("cabd");
  });

  it("挪到原位（或 from 越界）：顺序不变，但给的是新数组", () => {
    expect(order(movePlaylistItem(items, 1, 1))).toBe("abcd");
    expect(order(movePlaylistItem(items, 9, 0))).toBe("abcd");
    expect(order(movePlaylistItem(items, -1, 2))).toBe("abcd");
    expect(movePlaylistItem(items, 1, 1)).not.toBe(items);
  });

  it("目标越界夹到两端：拖到列表外也能落到头/尾", () => {
    expect(order(movePlaylistItem(items, 0, 99))).toBe("bcda");
    expect(order(movePlaylistItem(items, 3, -5))).toBe("dabc");
  });

  it("不改动入参（本地列表随时会被服务端响应的那一份回填）", () => {
    const before = order(items);
    movePlaylistItem(items, 0, 3);
    expect(order(items)).toBe(before);
  });

  it("空歌单 / 只有一条：不报错", () => {
    expect(movePlaylistItem([], 0, 1)).toEqual([]);
    expect(order(movePlaylistItem([items[0]], 0, 5))).toBe("a");
  });
});
