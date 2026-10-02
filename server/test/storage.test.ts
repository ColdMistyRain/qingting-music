import { readFile, readdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, type Song } from "@qingting/shared";
import {
  createSongId,
  createStoredName,
  loadSongs,
  saveSongs,
  songEditedFields,
  songsFilePath,
  toSongListResult,
  withSongMeta,
} from "../src/services/storage.js";
import { tempDirs } from "./helpers.js";

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: "s1",
    title: "晴天",
    artist: "周杰伦",
    album: "叶惠美",
    duration: 269,
    coverUrl: null,
    originalName: "周杰伦-晴天.mp3",
    storedName: "abc.mp3",
    size: 1024,
    uploadedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("loadSongs", () => {
  it("索引文件不存在时当空库处理（首次启动不该报错）", async () => {
    const { dataDir } = await tempDirs();
    await expect(loadSongs(dataDir)).resolves.toEqual([]);
  });

  it("索引内容是坏 JSON 或不是数组时当空库处理（宁可重建，也不要启动即崩）", async () => {
    const { dataDir } = await tempDirs();
    await saveSongs(dataDir, []);
    await writeFile(songsFilePath(dataDir), "{ 这不是 JSON", "utf8");
    await expect(loadSongs(dataDir)).resolves.toEqual([]);

    await writeFile(songsFilePath(dataDir), JSON.stringify({ songs: [] }), "utf8");
    await expect(loadSongs(dataDir)).resolves.toEqual([]);
  });

  it("过滤掉缺少必要字段的脏对象，不影响其余曲目", async () => {
    const { dataDir } = await tempDirs();
    await saveSongs(dataDir, []);
    await writeFile(
      songsFilePath(dataDir),
      JSON.stringify([song(), { id: "x" }, null, "nope"]),
      "utf8",
    );

    const songs = await loadSongs(dataDir);
    expect(songs).toHaveLength(1);
    expect(songs[0]?.id).toBe("s1");
  });
});

describe("saveSongs", () => {
  it("写入后能原样读回，并自动建目录", async () => {
    const { dataDir } = await tempDirs();
    const songs = [song(), song({ id: "s2", size: 2048 })];

    await saveSongs(dataDir, songs);

    await expect(loadSongs(dataDir)).resolves.toEqual(songs);
  });

  it("原子写入：不留 .tmp 残留（半路被杀也读不到半个 JSON）", async () => {
    const { dataDir } = await tempDirs();
    await saveSongs(dataDir, [song()]);

    const names = await readdir(dataDir);
    expect(names).toEqual(["songs.json"]);
  });

  it("内容是可读的 JSON 文本，方便手工排查（camelCase 落盘）", async () => {
    const { dataDir } = await tempDirs();
    await saveSongs(dataDir, [song()]);

    const raw = await readFile(songsFilePath(dataDir), "utf8");
    expect(raw).toContain('"storedName"');
    expect(raw).toContain('"uploadedAt"');
    expect(JSON.parse(raw)).toHaveLength(1);
  });
});

describe("createSongId / createStoredName", () => {
  it("id 与落盘名都是随机值，不会撞车", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createSongId()));
    expect(ids.size).toBe(50);
  });

  it("落盘名带扩展名；没有扩展名也不拼出多余的点", () => {
    expect(createStoredName("mp3")).toMatch(/^[A-Za-z0-9_-]+\.mp3$/);
    expect(createStoredName("")).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("songEditedFields / withSongMeta（AD-02）", () => {
  it("editedFields 一律过清单清洗：字符串、乱值、重复都不算", () => {
    // 手改坏的 json 里它可能是字符串，而 `"title".includes(...)` 恰好为真 ——
    // 不拦一下就会算出 ["t","i","t","l","e"] 这种脏值
    expect(songEditedFields(song({ editedFields: "title" as never }))).toEqual([]);
    expect(songEditedFields(song({ editedFields: ["artist", "nope"] as never }))).toEqual([
      "artist",
    ]);
    expect(songEditedFields(song({ editedFields: ["title", "title"] }))).toEqual(["title"]);
    expect(songEditedFields(song())).toEqual([]);
  });

  it("改过的字段按固定顺序记账，没改过的不动；上传时间不变", () => {
    const edited = withSongMeta(song(), { title: "新歌名" });
    expect(edited.title).toBe("新歌名");
    expect(edited.artist).toBe("周杰伦");
    expect(edited.editedFields).toEqual(["title"]);
    // 编辑不是重新上传： uploadedAt 不能动（否则“按上传时间”排序里会跳位置）
    expect(edited.uploadedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("歌手 / 专辑清空后退到“未知”，且原有记账不丢", () => {
    const edited = withSongMeta(song({ editedFields: ["title"] }), { artist: "", album: "" });
    expect(edited.artist).toBe(UNKNOWN_ARTIST);
    expect(edited.album).toBe(UNKNOWN_ALBUM);
    expect(edited.editedFields).toEqual(["title", "artist", "album"]);
  });
});

describe("toSongListResult", () => {
  it("总占用是各曲目大小之和（LB-10）", () => {
    const result = toSongListResult([song({ size: 1024 }), song({ id: "s2", size: 2048 })]);
    expect(result.totalSize).toBe(3072);
    expect(result.songs).toHaveLength(2);
  });

  it("空库时总占用为 0", () => {
    expect(toSongListResult([])).toEqual({ songs: [], totalSize: 0 });
  });
});
