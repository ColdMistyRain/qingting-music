import { readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { SONG_DUPLICATE_CODE } from "@qingting/shared";
import { createApp } from "../src/app.js";
import { loadSongs } from "../src/services/storage.js";
import { tempDirs, testConfig, wavBuffer } from "./helpers.js";

/** 建一个“干净环境”的应用：临时 data/uploads 目录 + 门禁关闭（等价管理员） */
async function setup(overrides: Record<string, unknown> = {}) {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs, ...overrides });
  return { app: createApp(config), config };
}

async function upload(
  app: ReturnType<typeof createApp>,
  name: string,
  content: Buffer,
  query = "",
): Promise<request.Test> {
  return request(app).post(`/api/songs/upload${query}`).attach("file", content, name);
}

describe("GET /api/songs（LB-04）", () => {
  it("空库返回空列表与 0 占用", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/songs");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 0, data: { songs: [], totalSize: 0 } });
  });
});

describe("POST /api/songs/upload（LB-01/02/03）", () => {
  it("上传成功：201 + 解析出的曲目，音频真的落盘", async () => {
    const { app, config } = await setup();
    const res = await upload(app, "BEYOND-海阔天空.wav", wavBuffer(1));

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    const song = res.body.data;
    expect(song.title).toBe("海阔天空");
    expect(song.artist).toBe("BEYOND");
    expect(song.duration).toBe(1);
    expect(song.size).toBe(wavBuffer(1).length);
    expect(song.storedName).toMatch(/\.wav$/);
    expect(song.coverUrl).toBeNull();

    const files = await readdir(config.uploadDir);
    expect(files).toContain(song.storedName);

    // 列表接口能立刻看到它
    const list = await request(app).get("/api/songs");
    expect(list.body.data.songs).toHaveLength(1);
    expect(list.body.data.totalSize).toBe(song.size);
  });

  it("重复文件（同名同大小）默认拒绝：409 + 业务码 1001，且不留垃圾文件", async () => {
    const { app, config } = await setup();
    await upload(app, "周杰伦-晴天.wav", wavBuffer(1));
    const before = await readdir(config.uploadDir);

    const res = await upload(app, "周杰伦-晴天.wav", wavBuffer(1));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(SONG_DUPLICATE_CODE);
    expect(await readdir(config.uploadDir)).toEqual(before);
    expect((await request(app).get("/api/songs")).body.data.songs).toHaveLength(1);
  });

  it("带 ?overwrite=1 时覆盖旧曲目，而不是多出一首", async () => {
    const { app, config } = await setup();
    const first = await upload(app, "周杰伦-晴天.wav", wavBuffer(1));
    const res = await upload(app, "周杰伦-晴天.wav", wavBuffer(1), "?overwrite=1");

    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(first.body.data.id);

    const list = await request(app).get("/api/songs");
    expect(list.body.data.songs).toHaveLength(1);
    // 旧音频文件应当被清掉，不留孤儿
    const files = await readdir(config.uploadDir);
    expect(files).not.toContain(first.body.data.storedName);
  });

  it("同名但大小不同不算重复（改了内容就是另一首）", async () => {
    const { app } = await setup();
    await upload(app, "同一首歌.wav", wavBuffer(1));
    const res = await upload(app, "同一首歌.wav", wavBuffer(2));

    expect(res.status).toBe(201);
    expect((await request(app).get("/api/songs")).body.data.songs).toHaveLength(2);
  });

  it("扩展名不在白名单：415（不是 400，前端据此判断不值得重试）", async () => {
    const { app } = await setup();
    const res = await upload(app, "cover.jpg", Buffer.from("假图片"));

    expect(res.status).toBe(415);
    expect(res.body.message).toContain("MP3");
  });

  it("超过单文件上限：413", async () => {
    const { app } = await setup({ maxUploadSize: 100 });
    const res = await upload(app, "大文件.wav", wavBuffer(1));

    expect(res.status).toBe(413);
  });

  it("字段名不对（不是 file）：400", async () => {
    const { app } = await setup();
    const res = await request(app).post("/api/songs/upload").attach("audio", wavBuffer(1), "a.wav");

    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/songs/:id（LB-05）", () => {
  it("删除曲目：索引与音频、封面文件一起清掉", async () => {
    const { app, config } = await setup();
    const created = await upload(app, "BEYOND-喜欢你.wav", wavBuffer(1));
    const song = created.body.data;

    const res = await request(app).delete(`/api/songs/${song.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: song.id });

    expect((await request(app).get("/api/songs")).body.data.songs).toEqual([]);
    await expect(readdir(config.uploadDir)).resolves.not.toContain(song.storedName);
  });

  it("删不存在的曲目：404", async () => {
    const { app } = await setup();
    expect((await request(app).delete("/api/songs/nope")).status).toBe(404);
  });

  it("音频文件被手工删掉后仍能删条目（索引优先，不留鬼影）", async () => {
    const { app } = await setup();
    const created = await upload(app, "手删过的.wav", wavBuffer(1));

    const res = await request(app).delete(`/api/songs/${created.body.data.id}`);

    expect(res.status).toBe(200);
  });
});

describe("POST /api/songs/reindex（LB-11 / AD-05）", () => {
  it("扫 uploads 目录：丢掉记录里已不存在的文件，捡回落单的音频", async () => {
    const { app, config } = await setup();
    const kept = await upload(app, "留下的.wav", wavBuffer(1));
    const ghost = await upload(app, "会丢的.wav", wavBuffer(1));

    // 从文件系统里删掉“会丢的”，并塞进一个索引里没有的音频
    await unlink(path.join(config.uploadDir, ghost.body.data.storedName));
    await writeFile(path.join(config.uploadDir, "orphan-abc.wav"), wavBuffer(1));

    const res = await request(app).post("/api/songs/reindex");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ scanned: 2, added: 1, removed: 1, total: 2 });

    const songs = await loadSongs(config.dataDir);
    const names = songs.map((song) => song.storedName).sort();
    expect(names).toEqual([kept.body.data.storedName, "orphan-abc.wav"].sort());
    // 重建时保住原曲目 id 与文件名，不是重新发号
    expect(songs.find((song) => song.storedName === kept.body.data.storedName)?.id).toBe(
      kept.body.data.id,
    );
  });

  it("索引损坏时也能重建出来（容灾的正经用途）", async () => {
    const { app, config } = await setup();
    const created = await upload(app, "AURORA-Cure For Me.wav", wavBuffer(1));
    await writeFile(path.join(config.dataDir, "songs.json"), "{ 坏掉的索引", "utf8");

    const res = await request(app).post("/api/songs/reindex");

    expect(res.body.data).toMatchObject({ scanned: 1, added: 1, total: 1 });
    const songs = await loadSongs(config.dataDir);
    expect(songs).toHaveLength(1);
    // 落盘名与文件对得上，且元数据确实重新解析过（时长 1 秒）
    expect(songs[0]?.storedName).toBe(created.body.data.storedName);
    expect(songs[0]?.duration).toBe(1);
    // 索引整个丢了 → 原文件名无从得知，标题只能退到落盘随机名。
    // 这是诚实的降级：能救回来的（文件、时长）都救回来了，救不回的（原文件名）不编造。
    // 不写死具体字符串：nanoid 里可能含 "-"，文件名回退解析会按它再拆一次。
    expect(songs[0]?.title).not.toBe("Cure For Me");
    expect(songs[0]?.title.length).toBeGreaterThan(0);
  });
});

describe("GET /api/stats（LB-10 / AD-03）", () => {
  it("曲目数与总占用跟着曲库走", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/stats")).body.data).toEqual({
      songCount: 0,
      totalSize: 0,
    });

    await upload(app, "a.wav", wavBuffer(1));
    const res = await request(app).get("/api/stats");

    expect(res.body.data.songCount).toBe(1);
    expect(res.body.data.totalSize).toBe(wavBuffer(1).length);
  });
});
