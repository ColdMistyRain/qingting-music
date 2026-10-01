import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadSongs, saveSongs } from "../src/services/storage.js";
import { mp3WithLyrics, tempDirs, testConfig, wavBuffer } from "./helpers.js";

async function setup(overrides: Record<string, unknown> = {}) {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs, ...overrides });
  return { app: createApp(config), config };
}

/** 传一个不带任何标签的 WAV：标题/歌手都只能靠文件名（正是需求方说的那种场景） */
async function uploadUntagged(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/api/songs/upload").attach("file", wavBuffer(1), "夜行.wav");
  return res.body.data as { id: string; title: string; artist: string; album: string };
}

describe("PUT /api/songs/:id（AD-02 编辑元信息）", () => {
  it("改歌名与歌手：返回更新后的曲目，索引里也真的变了", async () => {
    const { app, config } = await setup();
    const song = await uploadUntagged(app);

    const res = await request(app)
      .put(`/api/songs/${song.id}`)
      .send({ title: "夜行（现场版）", artist: "林晚" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: song.id,
      title: "夜行（现场版）",
      artist: "林晚",
      editedFields: ["title", "artist"],
    });
    const stored = (await loadSongs(config.dataDir))[0];
    expect(stored.title).toBe("夜行（现场版）");
    expect(stored.artist).toBe("林晚");
  });

  it("只改一个字段：别的字段保持不动，editedFields 只记这一个", async () => {
    const { app, config } = await setup();
    const song = await uploadUntagged(app);
    const before = (await loadSongs(config.dataDir))[0];

    await request(app).put(`/api/songs/${song.id}`).send({ album: "夜行 demo" });

    const after = (await loadSongs(config.dataDir))[0];
    expect(after.title).toBe(before.title);
    expect(after.artist).toBe(before.artist);
    expect(after.album).toBe("夜行 demo");
    expect(after.editedFields).toEqual(["album"]);
  });

  it("歌手/专辑可以清空（退到未知占位），但歌名不能为空", async () => {
    const { app, config } = await setup();
    const song = await uploadUntagged(app);

    const cleared = await request(app)
      .put(`/api/songs/${song.id}`)
      .send({ artist: "   ", album: "" });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.artist).toBe("未知歌手");
    expect(cleared.body.data.album).toBe("未知专辑");

    const emptyTitle = await request(app).put(`/api/songs/${song.id}`).send({ title: "  " });
    expect(emptyTitle.status).toBe(400);
    expect((await loadSongs(config.dataDir))[0].title).not.toBe("");
  });

  it("没带任何字段 / 字段类型不对 / 超长：400，且不改动存储", async () => {
    const { app, config } = await setup();
    const song = await uploadUntagged(app);
    const before = (await loadSongs(config.dataDir))[0];

    expect((await request(app).put(`/api/songs/${song.id}`).send({})).status).toBe(400);
    expect((await request(app).put(`/api/songs/${song.id}`).send({ title: 42 })).status).toBe(400);
    expect(
      (
        await request(app)
          .put(`/api/songs/${song.id}`)
          .send({ title: "a".repeat(121) })
      ).status,
    ).toBe(400);

    expect(await loadSongs(config.dataDir)).toEqual([before]);
  });

  it("曲目不存在：404；门禁打开时未登录 401（管理级）", async () => {
    const { app } = await setup({
      userPassword: "guest",
      adminPassword: "root",
      authEnabled: true,
    });

    const anonymous = await request(app).put("/api/songs/whatever").send({ title: "x" });
    expect(anonymous.status).toBe(401);
  });

  it("不存在的曲目（门禁关闭时）：404", async () => {
    const { app } = await setup();
    const res = await request(app).put("/api/songs/nope").send({ title: "x" });

    expect(res.status).toBe(404);
  });
});

describe("重建索引要保住手动改过的字段（LB-11 × AD-02）", () => {
  it("改过的字段保留，没改过的仍然按文件里的标签刷新", async () => {
    const { app, config } = await setup();
    // 这个文件有标签：标题来自文件名（Sea Wide Sky），歌手是未知
    const created = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics("[00:01.00]hi"), "Sea Wide Sky.mp3");
    const id = created.body.data.id;

    await request(app).put(`/api/songs/${id}`).send({ title: "海阔天空（手动）" });
    const beforeReindex = (await loadSongs(config.dataDir))[0];

    const res = await request(app).post("/api/songs/reindex");
    expect(res.status).toBe(200);

    const after = (await loadSongs(config.dataDir))[0];
    expect(after.title).toBe("海阔天空（手动）"); // 手动的被保住
    expect(after.artist).toBe("未知歌手"); // 没改过的照旧按标签来
    expect(after.editedFields).toEqual(["title"]);
    expect(beforeReindex.uploadedAt).toBe(after.uploadedAt); // 编辑不该动上传时间
  });

  it("没编辑过的曲目：重建后仍是标签解析的结果（不引入 editedFields）", async () => {
    const { app, config } = await setup();
    await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics("[00:01.00]hi"), "Sea Wide Sky.mp3");

    await request(app).post("/api/songs/reindex");

    const song = (await loadSongs(config.dataDir))[0];
    expect(song.editedFields).toBeUndefined();
  });

  it("手工把 editedFields 写坏（不是数组）时也不会崩：按“没编辑过”处理", async () => {
    const { app, config } = await setup();
    await request(app).post("/api/songs/upload").attach("file", wavBuffer(1), "夜行.wav");

    const songs = await loadSongs(config.dataDir);
    await saveSongs(config.dataDir, [{ ...songs[0], editedFields: "title" as never }]);

    const res = await request(app).post("/api/songs/reindex");
    expect(res.status).toBe(200);
  });
});
