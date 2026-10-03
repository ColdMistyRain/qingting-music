import { describe, expect, it } from "vitest";
import type { Playlist, PlaylistItem, Song, Track } from "@qingting/shared";
import { resolvePlaylist } from "./playlistEntries";
import { exportFileName, toExportJson, toM3U8 } from "./playlistExport";

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    title: "光辉岁月",
    artist: "BEYOND",
    album: "命运派对 - BEYOND",
    duration: 303,
    coverUrl: "/covers/a.jpg",
    originalName: "BEYOND-光辉岁月.mp3",
    storedName: "abc123.mp3",
    size: 1024,
    uploadedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

const cloudItem: PlaylistItem = {
  source: "server",
  refId: "song-1",
  title: "光辉岁月",
  artist: "BEYOND",
  duration: 303,
};
const localItem: PlaylistItem = {
  source: "local",
  refId: "林晚|夜行",
  title: "夜行",
  artist: "林晚",
  duration: 210,
};
const onlineItem: PlaylistItem = {
  source: "online",
  refId: "netease:1",
  title: "在线歌",
  artist: "某某",
};
const goneItem: PlaylistItem = { ...cloudItem, refId: "deleted", title: "被删的歌" };

function playlistOf(items: PlaylistItem[], name = "夜行歌单"): Playlist {
  return {
    id: "p1",
    name,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    items,
  };
}

const sources = { songs: [song()], queue: [] as Track[], onlineEnabled: false };

describe("toM3U8（PS-06：能播的写地址，不能播的写注释）", () => {
  it("首行是 #EXTM3U，带歌单名注释，云端曲目写绝对地址", () => {
    const entries = resolvePlaylist(playlistOf([cloudItem]), sources);
    const text = toM3U8("夜行歌单", entries, { origin: "https://music.local" });

    expect(text.startsWith("#EXTM3U\n# 夜行歌单\n")).toBe(true);
    expect(text).toContain("#EXTINF:303,BEYOND - 光辉岁月");
    expect(text).toContain("https://music.local/audio/abc123.mp3");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("不传 origin 时写相对路径（服务端自己也吃这个式子）", () => {
    const entries = resolvePlaylist(playlistOf([cloudItem]), sources);
    expect(toM3U8("夜行歌单", entries)).toContain("\n/audio/abc123.mp3");
  });

  it("不知道时长写 -1，不写 0 冒充", () => {
    const entries = resolvePlaylist(playlistOf([{ ...cloudItem, duration: undefined }]), sources);
    expect(toM3U8("x", entries)).toContain("#EXTINF:-1,BEYOND - 光辉岁月");
  });

  it("本地 / 在线 / 已被删的曲目：写成注释，不假装能播，但名字留住", () => {
    const entries = resolvePlaylist(playlistOf([localItem, onlineItem, goneItem]), sources);
    const text = toM3U8("混合", entries);

    expect(text).toContain("# 本地文件（导出时不带地址）：林晚 - 夜行");
    expect(text).toContain("# 在线音源（播放地址是临时的，只记下这首）：某某 - 在线歌");
    expect(text).toContain("# 已不在曲库：BEYOND - 被删的歌");
    expect(text).not.toContain("#EXTINF");
  });

  it("空歌单只剩头两行", () => {
    expect(toM3U8("空的", [])).toBe("#EXTM3U\n# 空的\n");
  });
});

describe("toExportJson（PS-06：自留一份备份）", () => {
  it("带上格式标记与版本，items 与歌单一致（可还原）", () => {
    const playlist = playlistOf([cloudItem, localItem]);
    const text = toExportJson(playlist, "2026-10-02T00:00:00.000Z");
    const parsed = JSON.parse(text);

    expect(parsed).toEqual({
      format: "qingting-playlist",
      version: 1,
      name: "夜行歌单",
      exportedAt: "2026-10-02T00:00:00.000Z",
      items: [cloudItem, localItem],
    });
    expect(text.endsWith("\n")).toBe(true);
  });

  it("拷出来的是副本：导出后改歌单不会回过头改到这份 JSON", () => {
    const playlist = playlistOf([cloudItem]);
    const text = toExportJson(playlist, "2026-10-02T00:00:00.000Z");
    playlist.items.push(localItem);

    expect(JSON.parse(text).items).toHaveLength(1);
  });
});

describe("exportFileName（文件名清洗）", () => {
  it("非法字符换下划线、空白折叠、带对扩展名", () => {
    expect(exportFileName("2026/10 夜行:歌单", "m3u8")).toBe("2026_10 夜行_歌单.m3u8");
    expect(exportFileName("  夜行  歌单  ", "json")).toBe("夜行 歌单.json");
  });

  it("全是非法字符或空名时给个兜底名，不留空文件名", () => {
    expect(exportFileName("///", "json")).toBe("___.json");
    expect(exportFileName("   ", "m3u8")).toBe("歌单.m3u8");
  });

  it("超长名字截到 80 字（Windows 的路径长度还有别的东西要占）", () => {
    const name = exportFileName("歌".repeat(120), "m3u8");
    expect(name).toBe(`${"歌".repeat(80)}.m3u8`);
  });
});
