import { describe, expect, it } from "vitest";
import {
  PLAYLIST_NAME_MAX_LENGTH,
  dedupePlaylistItems,
  fileExtension,
  hasAccess,
  isAudioFileName,
  parseTrackFileName,
  playlistItemKey,
  toPlaylistItem,
  validatePlaylistName,
  type PlaylistItem,
  type Track,
} from "@qingting/shared";

describe("fileExtension", () => {
  it("取小写扩展名", () => {
    expect(fileExtension("song.MP3")).toBe("mp3");
    expect(fileExtension("a.b.flac")).toBe("flac");
  });

  it("无扩展名或点结尾返回空串", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension("noext.")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
  });
});

describe("isAudioFileName", () => {
  it("白名单内命中（LB-02 / LC-02）", () => {
    for (const name of ["a.mp3", "b.flac", "c.WAV", "d.ogg", "e.m4a", "f.aac", "g.opus"]) {
      expect(isAudioFileName(name)).toBe(true);
    }
  });

  it("非音频与伪装扩展名一律拒绝", () => {
    expect(isAudioFileName("cover.jpg")).toBe(false);
    expect(isAudioFileName("a.mp3.exe")).toBe(false);
    expect(isAudioFileName("song")).toBe(false);
  });
});

describe("parseTrackFileName（LB-03 / LC-03 共用同一套回退规则）", () => {
  it("按「歌手 - 歌名」拆分", () => {
    expect(parseTrackFileName("周杰伦 - 晴天.mp3")).toEqual({ title: "晴天", artist: "周杰伦" });
    expect(parseTrackFileName("林晚 - 夜行.flac")).toEqual({ title: "夜行", artist: "林晚" });
  });

  it("破折号与长破折号同样识别", () => {
    expect(parseTrackFileName("陈屿 – 夏日终结.mp3").artist).toBe("陈屿");
    expect(parseTrackFileName("星野 — 焰火.mp3").artist).toBe("星野");
  });

  it("剥掉曲序前缀再取歌手与歌名", () => {
    expect(parseTrackFileName("01. 周杰伦 - 晴天.mp3")).toEqual({
      title: "晴天",
      artist: "周杰伦",
    });
    expect(parseTrackFileName("12_ 蓝溪 - 深海信笺.wav")).toEqual({
      title: "深海信笺",
      artist: "蓝溪",
    });
  });

  it("识别不出歌手时整段作歌名、歌手记为未知", () => {
    expect(parseTrackFileName("夜行.mp3")).toEqual({ title: "夜行", artist: "未知歌手" });
    expect(parseTrackFileName("track01")).toEqual({ title: "track01", artist: "未知歌手" });
  });

  it("不吃掉名字里的连字符（A-Lin 这类）", () => {
    expect(parseTrackFileName("A-Lin.mp3")).toEqual({ title: "A-Lin", artist: "未知歌手" });
  });

  it("支持无空格连字符命名（真实曲库习惯：歌手-歌名.mp3）", () => {
    expect(parseTrackFileName("BEYOND-海阔天空.mp3")).toEqual({
      title: "海阔天空",
      artist: "BEYOND",
    });
    expect(parseTrackFileName("A-Lin-给我一个理由忘记.mp3")).toEqual({
      title: "给我一个理由忘记",
      artist: "A-Lin",
    });
    expect(parseTrackFileName("AURORA-Cure For Me.flac")).toEqual({
      title: "Cure For Me",
      artist: "AURORA",
    });
  });

  it("按最后一个连字符拆，保留歌手名里的连字符", () => {
    expect(parseTrackFileName("Jake Miller&HOYO-MiX-WHITE NIGHT.mp3")).toEqual({
      title: "WHITE NIGHT",
      artist: "Jake Miller&HOYO-MiX",
    });
  });

  it("空文件名不崩", () => {
    expect(parseTrackFileName("")).toEqual({ title: "", artist: "未知歌手" });
  });
});

describe("hasAccess", () => {
  it("访客级：visitor 与 admin 通过，未登录拒绝（AC-03）", () => {
    expect(hasAccess("visitor", "visitor")).toBe(true);
    expect(hasAccess("admin", "visitor")).toBe(true);
    expect(hasAccess("anonymous", "visitor")).toBe(false);
  });

  it("管理级：仅 admin 通过", () => {
    expect(hasAccess("admin", "admin")).toBe(true);
    expect(hasAccess("visitor", "admin")).toBe(false);
    expect(hasAccess("anonymous", "admin")).toBe(false);
  });
});

describe("validatePlaylistName（PS-01）", () => {
  it("去首尾空白后返回合法名字", () => {
    expect(validatePlaylistName("  夜行歌单  ")).toEqual({ ok: true, name: "夜行歌单" });
  });

  it("空名 / 全空白 / 非字符串都拒绝", () => {
    expect(validatePlaylistName("")).toMatchObject({ ok: false });
    expect(validatePlaylistName("   \n ")).toMatchObject({ ok: false });
    expect(validatePlaylistName(undefined)).toMatchObject({ ok: false });
    expect(validatePlaylistName(42)).toMatchObject({ ok: false });
  });

  it("超长名字拒绝（按去空白后的长度算，正好等于上限仍然通过）", () => {
    expect(validatePlaylistName("a".repeat(PLAYLIST_NAME_MAX_LENGTH))).toMatchObject({ ok: true });
    const tooLong = validatePlaylistName("a".repeat(PLAYLIST_NAME_MAX_LENGTH + 1));
    expect(tooLong).toMatchObject({ ok: false });
  });
});

describe("playlistItemKey / dedupePlaylistItems（PS-02）", () => {
  const serverItem: PlaylistItem = {
    source: "server",
    refId: "song-1",
    title: "海阔天空",
    artist: "BEYOND",
  };
  const localItem: PlaylistItem = { source: "local", title: "夜行", artist: "林晚" };

  it("有 refId 用 refId，没有就退到「来源 + 歌手|曲名」", () => {
    expect(playlistItemKey(serverItem)).toBe("server:song-1");
    expect(playlistItemKey(localItem)).toBe("local:林晚|夜行");
  });

  it("同一首歌重复加只留一条，保留先加的那条", () => {
    const first = { ...serverItem, cover: "/covers/a.jpg" };
    const again = { ...serverItem, cover: "其他" };
    expect(dedupePlaylistItems([first, again])).toEqual([first]);
  });

  it("本地曲目靠“歌手|曲名”去重（id 每次导入都变）", () => {
    expect(dedupePlaylistItems([localItem, { ...localItem, cover: "x" }])).toHaveLength(1);
  });

  it("不同来源/不同曲目不会被误合并，顺序保持", () => {
    const mixed = [serverItem, localItem, { ...localItem, source: "online" as const }];
    expect(dedupePlaylistItems(mixed)).toHaveLength(3);
  });
});

describe("toPlaylistItem（PS-02：任意来源的曲目都能进歌单）", () => {
  const base: Track = {
    id: "song-1",
    source: "server",
    url: "/audio/a.mp3",
    title: "海阔天空",
    artist: "BEYOND",
    album: "乐与怒",
    cover: "/covers/a.jpg",
    duration: 325,
  };

  it("云端曲目用 Song.id 作引用", () => {
    expect(toPlaylistItem(base)).toEqual({
      source: "server",
      refId: "song-1",
      title: "海阔天空",
      artist: "BEYOND",
      cover: "/covers/a.jpg",
      duration: 325,
    });
  });

  it("在线曲目用 provider:id 作引用（铁律 4）", () => {
    expect(toPlaylistItem({ ...base, source: "online", id: "netease:123" }).refId).toBe(
      "netease:123",
    );
  });

  it("本地曲目改用“歌手|曲名”（本地 id 每次导入都会重新生成）", () => {
    expect(toPlaylistItem({ ...base, source: "local", id: "blob-abc" }).refId).toBe(
      "BEYOND|海阔天空",
    );
  });
});
