import { describe, expect, it } from "vitest";
import type { Song } from "@qingting/shared";
import { diffSongMeta } from "./songMeta";

const song: Pick<Song, "title" | "artist" | "album"> = {
  title: "海阔天空",
  artist: "BEYOND",
  album: "乐与怒",
};

const draft = (over: Partial<{ title: string; artist: string; album: string }> = {}) => ({
  title: song.title,
  artist: song.artist,
  album: song.album,
  ...over,
});

describe("diffSongMeta（AD-02：只把改过的字段算作手动编辑）", () => {
  it("什么都没改：返回 null（调用方当关闭处理，不跑接口）", () => {
    expect(diffSongMeta(song, draft())).toBeNull();
  });

  it("改歌名：只带 title", () => {
    expect(diffSongMeta(song, draft({ title: "海阔天空（现场版）" }))).toEqual({
      title: "海阔天空（现场版）",
    });
  });

  it("改歌手/专辑：各自单独带，互不牵连", () => {
    expect(diffSongMeta(song, draft({ artist: "BEYOND 1993" }))).toEqual({
      artist: "BEYOND 1993",
    });
    expect(diffSongMeta(song, draft({ album: "" }))).toEqual({ album: "" });
  });

  it("前后空格不算改动（trim 后再比）", () => {
    expect(diffSongMeta(song, draft({ title: " 海阔天空 ", artist: "BEYOND " }))).toBeNull();
    expect(diffSongMeta(song, draft({ title: " 夜行 " }))).toEqual({ title: "夜行" });
  });

  it("歌名清空：丢弃该字段（界面上保存键是禁用的，这里是兜底）", () => {
    expect(diffSongMeta(song, draft({ title: "   " }))).toBeNull();
    expect(diffSongMeta(song, draft({ title: " ", album: "新专辑" }))).toEqual({ album: "新专辑" });
  });

  it("原来就是未知占位、用户填上真名：算改动", () => {
    const untagged = { ...song, artist: "未知歌手", album: "未知专辑" };
    expect(diffSongMeta(untagged, draft({ artist: "林晚", album: "夜行" }))).toEqual({
      artist: "林晚",
      album: "夜行",
    });
  });
});
