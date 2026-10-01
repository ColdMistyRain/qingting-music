import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Playlist, PlaylistItem } from "@qingting/shared";
import {
  createPlaylist,
  loadPlaylists,
  playlistsFilePath,
  renamePlaylist,
  sanitizePlaylistItem,
  savePlaylists,
  withPlaylistItems,
} from "../src/services/playlists.js";
import { tempDirs } from "./helpers.js";

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-10-01T13:30:00.000Z";

const ITEM: PlaylistItem = {
  source: "server",
  refId: "song-1",
  title: "海阔天空",
  artist: "BEYOND",
  cover: "/covers/a.jpg",
  duration: 325,
};

describe("歌单存储（PS-01：歌单存在服务器端）", () => {
  it("写入后再读回：内容一致，且落盘的是 playlists.json", async () => {
    const { dataDir } = await tempDirs();
    const playlist = { ...createPlaylist("夜行歌单", NOW), items: [ITEM] };

    await savePlaylists(dataDir, [playlist]);

    expect(await loadPlaylists(dataDir)).toEqual([playlist]);
    const raw = JSON.parse(await readFile(playlistsFilePath(dataDir), "utf8"));
    expect(raw).toHaveLength(1);
  });

  it("文件不存在 / 内容损坏 / 顶层不是数组：都当空列表，不让接口崩", async () => {
    const { dataDir } = await tempDirs();
    expect(await loadPlaylists(dataDir)).toEqual([]);

    await savePlaylists(dataDir, []);
    await writeFile(playlistsFilePath(dataDir), "{ 这不是 JSON", "utf8");
    expect(await loadPlaylists(dataDir)).toEqual([]);

    await writeFile(playlistsFilePath(dataDir), JSON.stringify({ nope: true }), "utf8");
    expect(await loadPlaylists(dataDir)).toEqual([]);
  });

  it("脏条目跳过、脏曲目丢掉、缺时间戳用 epoch 兑底（手工改坏的 JSON 也能读）", async () => {
    const { dataDir } = await tempDirs();
    // tempDirs 只建根目录，data/ 要自己先有（正常路径下 savePlaylists 会 mkdir）
    await savePlaylists(dataDir, []);
    await writeFile(
      playlistsFilePath(dataDir),
      JSON.stringify([
        null,
        { name: "没有 id" },
        { id: "keep", name: "能读的", items: [ITEM, { source: "天外来源" }, 42], createdAt: NOW },
      ]),
      "utf8",
    );

    const loaded = await loadPlaylists(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("keep");
    expect(loaded[0].items).toEqual([ITEM]);
    expect(loaded[0].updatedAt).toBe(new Date(0).toISOString());
  });

  it("保存会覆盖旧文件（原子替换，不留 .tmp）", async () => {
    const { dataDir } = await tempDirs();
    await savePlaylists(dataDir, [createPlaylist("旧的", NOW)]);
    await savePlaylists(dataDir, [createPlaylist("新的", LATER)]);

    const loaded = await loadPlaylists(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("新的");
  });
});

describe("歌单纯函数（PS-01 / PS-02 / PS-04）", () => {
  it("新建：空曲目、创建与更新时间一致、id 每次不同", () => {
    const first = createPlaylist("夜行歌单", NOW);
    const second = createPlaylist("夜行歌单", NOW);

    expect(first).toMatchObject({ name: "夜行歌单", items: [], createdAt: NOW, updatedAt: NOW });
    expect(first.id).not.toBe(second.id);
  });

  it("改名：只动 name 与 updatedAt", () => {
    const playlist: Playlist = { ...createPlaylist("旧名", NOW), items: [ITEM] };
    const renamed = renamePlaylist(playlist, "新名", LATER);

    expect(renamed).toMatchObject({
      id: playlist.id,
      name: "新名",
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(renamed.items).toEqual([ITEM]);
  });

  it("整表替换曲目：去重（同一首只留一条）+ 更新时间", () => {
    const playlist = createPlaylist("夜行歌单", NOW);
    const updated = withPlaylistItems(playlist, [ITEM, { ...ITEM, cover: "重复" }], LATER);

    expect(updated.items).toHaveLength(1);
    expect(updated.items[0].cover).toBe("/covers/a.jpg");
    expect(updated.updatedAt).toBe(LATER);
    expect(updated.createdAt).toBe(NOW);
  });

  it("空数组 = 清空歌单曲目（不是“别动”），时间照样更新", () => {
    const playlist = { ...createPlaylist("夜行歌单", NOW), items: [ITEM] };
    const cleared = withPlaylistItems(playlist, [], LATER);

    expect(cleared.items).toEqual([]);
    expect(cleared.updatedAt).toBe(LATER);
  });
});

describe("sanitizePlaylistItem（畸形请求体不该把接口带崩）", () => {
  it("合法曲目原样保留", () => {
    expect(sanitizePlaylistItem(ITEM)).toEqual(ITEM);
  });

  it("来源非法 / 缺标题 / 非对象都拒绝", () => {
    expect(sanitizePlaylistItem({ ...ITEM, source: "podcast" })).toBeNull();
    expect(sanitizePlaylistItem({ ...ITEM, title: 42 })).toBeNull();
    expect(sanitizePlaylistItem("海阔天空")).toBeNull();
    expect(sanitizePlaylistItem(null)).toBeNull();
  });

  it("可选字段缺失或类型不对时丢掉，不影响整条", () => {
    const item = sanitizePlaylistItem({
      source: "local",
      title: "夜行",
      artist: "林晚",
      refId: "",
      cover: 7,
      duration: Number.NaN,
    });

    expect(item).toEqual({ source: "local", title: "夜行", artist: "林晚" });
  });
});
