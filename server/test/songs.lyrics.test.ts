import { readFile } from "node:fs/promises";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { lyricsFilePath, removeLyrics, saveLyrics } from "../src/services/lyrics.js";
import { loadSongs, saveSongs } from "../src/services/storage.js";
import { mp3WithLyrics, tempDirs, testConfig, wavBuffer } from "./helpers.js";

/** 建一个"干净环境"的应用：临时 data/uploads 目录 + 门禁关闭（等价管理员） */
async function setup() {
  const dirs = await tempDirs();
  const config = testConfig(dirs);
  return { app: createApp(config), config };
}

const LRC = "[00:12.00]Today I\n[00:16.00]walked through the snow";

describe("上传时解析内嵌歌词（LR-02 第一优先级）", () => {
  it("带歌词的 MP3：上传后 hasLyrics 为 true，歌词落盘到 data/lyrics/<id>.lrc", async () => {
    const { app, config } = await setup();
    const res = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics(LRC), "sea-wide-sky.mp3");

    expect(res.status).toBe(201);
    const song = res.body.data;
    expect(song.hasLyrics).toBe(true);
    expect(await readFile(lyricsFilePath(config.dataDir, song.id), "utf8")).toBe(LRC);

    // 列表里带上标记（正文不进列表响应）
    const list = await request(app).get("/api/songs");
    expect(list.body.data.songs[0].hasLyrics).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain("walked through the snow");
  });

  it("没有歌词的 WAV：hasLyrics 为 false，也不留半份歌词文件", async () => {
    const { app, config } = await setup();
    const res = await request(app)
      .post("/api/songs/upload")
      .attach("file", wavBuffer(1), "纯音乐.wav");

    expect(res.status).toBe(201);
    expect(res.body.data.hasLyrics).toBe(false);
    await expect(readFile(lyricsFilePath(config.dataDir, res.body.data.id))).rejects.toThrow();
  });

  it("覆盖上传：旧歌词被清掉，换成新文件的那份", async () => {
    const { app, config } = await setup();
    const first = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics("[00:01.00]Old"), "same.mp3");
    const firstId = first.body.data.id;

    const again = await request(app)
      .post("/api/songs/upload?overwrite=1")
      .attach("file", mp3WithLyrics("[00:01.00]New"), "same.mp3");

    expect(again.status).toBe(201);
    expect(again.body.data.id).not.toBe(firstId);
    await expect(readFile(lyricsFilePath(config.dataDir, firstId))).rejects.toThrow();
    expect(await readFile(lyricsFilePath(config.dataDir, again.body.data.id), "utf8")).toBe(
      "[00:01.00]New",
    );
  });

  it("删除曲目：歌词文件一起删掉", async () => {
    const { app, config } = await setup();
    const res = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics(LRC), "song.mp3");
    const id = res.body.data.id;

    await request(app).delete(`/api/songs/${id}`);

    await expect(readFile(lyricsFilePath(config.dataDir, id))).rejects.toThrow();
  });
});

describe("GET /api/songs/:id/lyrics（按需取正文）", () => {
  it("有歌词：200 + 正文", async () => {
    const { app } = await setup();
    const created = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics(LRC), "song.mp3");

    const res = await request(app).get(`/api/songs/${created.body.data.id}/lyrics`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 0, data: { lyrics: LRC } });
  });

  it("曲目在但没歌词：200 + null（不是 404，前端据此静默）", async () => {
    const { app } = await setup();
    const created = await request(app)
      .post("/api/songs/upload")
      .attach("file", wavBuffer(1), "a.wav");

    const res = await request(app).get(`/api/songs/${created.body.data.id}/lyrics`);
    expect(res.status).toBe(200);
    expect(res.body.data.lyrics).toBeNull();
  });

  it("曲目不存在：404", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/songs/nope/lyrics");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 404 });
  });
});

describe("重建索引顺带补歌词（LB-11）", () => {
  it("老曲目（索引里 hasLyrics 缺失、也没有 .lrc）重建后补上歌词", async () => {
    const { app, config } = await setup();
    const created = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics(LRC), "song.mp3");
    const id = created.body.data.id;

    // 模拟"升级前上传的曲目"：索引里没有 hasLyrics，歌词文件也不在
    const songs = await loadSongs(config.dataDir);
    await saveSongs(
      config.dataDir,
      songs.map((song) => ({ ...song, hasLyrics: undefined })),
    );
    await removeLyrics(config.dataDir, id);
    const res = await request(app).post("/api/songs/reindex");
    expect(res.status).toBe(200);

    expect((await loadSongs(config.dataDir))[0].hasLyrics).toBe(true);
    expect(await readFile(lyricsFilePath(config.dataDir, id), "utf8")).toBe(LRC);
  });

  it("索引里已经没有的歌词文件会被清掉（删除残留的孤儿）", async () => {
    const { app, config } = await setup();
    const kept = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics(LRC), "kept.mp3");
    // 伪造一份孤儿：对应的音频不在 uploads 里，重建时自然进不了索引
    await saveLyrics(config.dataDir, "ghost", "[00:01.00]Ghost");

    await request(app).post("/api/songs/reindex");

    await expect(readFile(lyricsFilePath(config.dataDir, "ghost"))).rejects.toThrow();
    expect(await readFile(lyricsFilePath(config.dataDir, kept.body.data.id), "utf8")).toBe(LRC);
  });
});
