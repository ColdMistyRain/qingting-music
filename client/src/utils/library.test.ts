import { describe, expect, it } from "vitest";
import { UNKNOWN_ALBUM, type Song } from "@qingting/shared";
import { filterSongs, groupAlbums, songToTrack, sortSongs } from "./library";

function song(patch: Partial<Song> & { id: string }): Song {
  return {
    title: "标题",
    artist: "歌手",
    album: "专辑",
    duration: 200,
    coverUrl: null,
    originalName: "a.mp3",
    storedName: `${patch.id}.mp3`,
    size: 1024,
    uploadedAt: "2026-09-30T10:00:00.000Z",
    ...patch,
  };
}

const LIBRARY: Song[] = [
  song({
    id: "a",
    title: "晴天",
    artist: "周杰伦",
    album: "叶惠美",
    size: 300,
    uploadedAt: "2026-09-30T10:00:00.000Z",
  }),
  song({
    id: "b",
    title: "海阔天空",
    artist: "BEYOND",
    album: "乐与怒",
    size: 100,
    uploadedAt: "2026-09-30T12:00:00.000Z",
  }),
  song({
    id: "c",
    title: "Rolling in the Deep",
    artist: "Adele",
    album: "21",
    size: 200,
    uploadedAt: "2026-09-30T11:00:00.000Z",
  }),
];

describe("groupAlbums（VS-06 专辑网格）", () => {
  it("按专辑名聚组（trim + 小写归并同名）；封面取组内第一首有值的", () => {
    const groups = groupAlbums([
      song({ id: "1", album: " 叶惠美 ", coverUrl: null }),
      song({ id: "2", album: "叶惠美", coverUrl: "/covers/y.jpg" }),
      song({ id: "3", album: "乐与怒" }),
    ]);
    expect(groups).toHaveLength(2);
    const yehuimei = groups.find((g) => g.key === "叶惠美")!;
    expect(yehuimei.tracks.map((t) => t.id)).toEqual(["1", "2"]);
    expect(yehuimei.cover).toBe("/covers/y.jpg");
    expect(groups.find((g) => g.key === "乐与怒")?.cover).toBeNull();
  });

  it("未知专辑 / 空专辑名归并进「未知专辑」一组（真实曲库常态）", () => {
    const groups = groupAlbums([
      song({ id: "1", album: UNKNOWN_ALBUM }),
      song({ id: "2", album: "  " }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe(UNKNOWN_ALBUM);
    expect(groups[0]?.tracks).toHaveLength(2);
  });

  it("空曲库 → 空数组", () => {
    expect(groupAlbums([])).toEqual([]);
  });
});

describe("filterSongs（对 Track 同样适用：在线歌单的站内过滤，v6.35）", () => {
  it("按标题/歌手过滤曲目，忽略大小写", () => {
    const tracks = [
      { id: "netease:1", title: "夜曲", artist: "周杰伦", album: "十一月的萧邦" },
      { id: "netease:2", title: "Tik Tok", artist: "2PM", album: "Tik Tok" },
    ];
    expect(filterSongs(tracks, "夜曲").map((t) => t.id)).toEqual(["netease:1"]);
    expect(filterSongs(tracks, "tik").map((t) => t.id)).toEqual(["netease:2"]);
    expect(filterSongs(tracks, "  ")).toHaveLength(2);
  });
});

describe("filterSongs", () => {
  it("命中标题 / 歌手 / 专辑任一字段", () => {
    expect(filterSongs(LIBRARY, "晴天").map((s) => s.id)).toEqual(["a"]);
    expect(filterSongs(LIBRARY, "beyond").map((s) => s.id)).toEqual(["b"]);
    expect(filterSongs(LIBRARY, "21").map((s) => s.id)).toEqual(["c"]);
  });

  it("忽略大小写与首尾空格", () => {
    expect(filterSongs(LIBRARY, "  adele ").map((s) => s.id)).toEqual(["c"]);
  });

  it("空关键词返回全部，且返回的是新数组（不改动入参）", () => {
    const all = filterSongs(LIBRARY, "   ");
    expect(all).toHaveLength(LIBRARY.length);
    expect(all).not.toBe(LIBRARY);
  });

  it("无命中时返回空数组", () => {
    expect(filterSongs(LIBRARY, "不存在的关键词")).toEqual([]);
  });
});

describe("sortSongs", () => {
  it("按大小与上传时间排序（数值与 ISO 字符串都按真实先后）", () => {
    expect(sortSongs(LIBRARY, "size").map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(sortSongs(LIBRARY, "size", "desc").map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(sortSongs(LIBRARY, "uploadedAt").map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("按标题/歌手排序走中文语序（中文在前、同语言内按拼音/字母）", () => {
    expect(sortSongs(LIBRARY, "title").map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(sortSongs(LIBRARY, "artist").map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("返回新数组，不修改入参顺序", () => {
    const sorted = sortSongs(LIBRARY, "size");
    expect(sorted).not.toBe(LIBRARY);
    expect(LIBRARY.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });
});

describe("songToTrack", () => {
  it("映射为播放器曲目：来源标记 server，URL 指向流式接口", () => {
    const track = songToTrack(song({ id: "x", title: "测试", storedName: "abc123.mp3" }));
    expect(track).toMatchObject({
      id: "x",
      source: "server",
      url: "/audio/abc123.mp3",
      title: "测试",
      duration: 200,
    });
  });

  it("落盘名里的特殊字符会被转义，不会拼出坏 URL", () => {
    const track = songToTrack(song({ id: "y", storedName: "a b#c.mp3" }));
    expect(track.url).toBe("/audio/a%20b%23c.mp3");
  });
});
