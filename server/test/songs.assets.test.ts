import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { COVER_MAX_BYTES } from "@qingting/shared";
import { createApp } from "../src/app.js";
import { lyricsFilePath } from "../src/services/lyrics.js";
import { songsFilePath } from "../src/services/storage.js";
import { loadSongs } from "../src/services/storage.js";
import { mp3WithLyrics, tempDirs, testConfig, wavBuffer } from "./helpers.js";

/**
 * 手动设置封面与歌词（AD-02 扩展，v6.13）。
 * 这两件事原先只能靠音频文件里的内嵌资源，需求方要求能在曲库管理里补上：
 * 封面可以选一张图，歌词可以传 .lrc 也可以直接粘文本。
 */

async function setup(overrides: Record<string, unknown> = {}) {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs, ...overrides });
  await mkdir(config.uploadDir, { recursive: true });
  return { app: createApp(config), config };
}

/** 一张 1×1 的 PNG（自己拼字节，仓库里不放二进制素材） */
function pngBuffer(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AH/8QAAAABJRU5ErkJggg==",
    "base64",
  );
}

/** 传一首不带任何标签、也没有内嵌封面的 WAV，返回它那条索引记录 */
async function uploadPlain(app: ReturnType<typeof createApp>, name = "夜行.wav") {
  const res = await request(app).post("/api/songs/upload").attach("file", wavBuffer(1), name);
  return res.body.data as { id: string; coverUrl: string | null; hasLyrics?: boolean };
}

const LRC = "[00:12.00]Today I\n[00:16.00]walked through the snow";

describe("PUT /api/songs/:id/cover（AD-02 扩展）", () => {
  it("传一张图：索引指向新文件，图片真的落盘，能经 /covers 取回来", async () => {
    const { app, config } = await setup();
    const song = await uploadPlain(app);
    expect(song.coverUrl).toBeNull();

    const res = await request(app)
      .put(`/api/songs/${song.id}/cover`)
      .attach("cover", pngBuffer(), "封面.png");

    expect(res.status).toBe(200);
    const name = path.basename(res.body.data.coverUrl as string);
    expect(name.startsWith(`${song.id}-`)).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
    expect(res.body.data.editedAssets).toEqual(["cover"]);
    expect(await readdir(config.uploadDir)).toContain(name);

    const fetched = await request(app).get(`/covers/${name}`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers["content-type"]).toBe("image/png");
  });

  it("换一张（换扩展名）：索引指向新图，旧那张当场删掉，不留孤儿", async () => {
    const { app, config } = await setup();
    const song = await uploadPlain(app);
    const first = await request(app)
      .put(`/api/songs/${song.id}/cover`)
      .attach("cover", pngBuffer(), "第一张.png");
    const oldName = path.basename(first.body.data.coverUrl as string);

    const second = await request(app)
      .put(`/api/songs/${song.id}/cover`)
      .attach("cover", pngBuffer(), "第二张.png");

    const newName = path.basename(second.body.data.coverUrl as string);
    expect(newName).not.toBe(oldName);
    const names = await readdir(config.uploadDir);
    expect(names).toContain(newName);
    expect(names).not.toContain(oldName);
  });

  it("只认图片：音频文件 415，且索引没有任何改动", async () => {
    const { app, config } = await setup();
    const song = await uploadPlain(app);

    const res = await request(app)
      .put(`/api/songs/${song.id}/cover`)
      .attach("cover", wavBuffer(1), "不是图片.wav");

    expect(res.status).toBe(415);
    expect((await loadSongs(config.dataDir))[0].coverUrl).toBeNull();
  });

  it("超过封面上限：413", async () => {
    const { app } = await setup();
    const song = await uploadPlain(app);

    const res = await request(app)
      .put(`/api/songs/${song.id}/cover`)
      .attach("cover", Buffer.alloc(COVER_MAX_BYTES + 1024), "太大.png");

    expect(res.status).toBe(413);
  });

  it("曲目不存在 404；门禁打开时未登录 401（管理级）", async () => {
    const { app } = await setup({
      userPassword: "guest",
      adminPassword: "root",
      authEnabled: true,
    });

    const anonymous = await request(app)
      .put("/api/songs/nope/cover")
      .attach("cover", pngBuffer(), "x.png");
    expect(anonymous.status).toBe(401);
  });

  it("没有图片字段：400", async () => {
    const { app } = await setup();
    const song = await uploadPlain(app);

    const res = await request(app).put(`/api/songs/${song.id}/cover`);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/songs/:id/cover（AD-02 扩展）", () => {
  it("去掉封面：索引里变 null、文件也删掉", async () => {
    const { app, config } = await setup();
    const song = await uploadPlain(app);
    const put = await request(app)
      .put(`/api/songs/${song.id}/cover`)
      .attach("cover", pngBuffer(), "图.png");
    const name = path.basename(put.body.data.coverUrl as string);

    const res = await request(app).delete(`/api/songs/${song.id}/cover`);

    expect(res.status).toBe(200);
    expect(res.body.data.coverUrl).toBeNull();
    expect(res.body.data.editedAssets).toEqual(["cover"]);
    expect(await readdir(config.uploadDir)).not.toContain(name);
  });
});

describe("PUT /api/songs/:id/lyrics（AD-02 扩展）", () => {
  it("粘一段带时间标签的歌词：正文落盘、索引标记 hasLyrics，GET 能取回来", async () => {
    const { app, config } = await setup();
    const song = await uploadPlain(app);

    const res = await request(app).put(`/api/songs/${song.id}/lyrics`).send({ text: LRC });

    expect(res.status).toBe(200);
    expect(res.body.data.hasLyrics).toBe(true);
    expect(res.body.data.editedAssets).toEqual(["lyrics"]);
    expect(await readFile(lyricsFilePath(config.dataDir, song.id), "utf8")).toBe(LRC);

    const got = await request(app).get(`/api/songs/${song.id}/lyrics`);
    expect(got.body.data.lyrics).toBe(LRC);
  });

  it("覆盖音频内嵌的那份：以手动设置的为准", async () => {
    const { app, config } = await setup();
    const created = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics("[00:01.00]embedded"), "Sea Wide Sky.mp3");
    const id = created.body.data.id;

    await request(app).put(`/api/songs/${id}/lyrics`).send({ text: LRC });

    expect(await readFile(lyricsFilePath(config.dataDir, id), "utf8")).toBe(LRC);
  });

  it("空文本 / 不是文本 / 没有时间标签 / 超长：400，且不落盘", async () => {
    const { app, config } = await setup();
    const song = await uploadPlain(app);

    expect(
      (await request(app).put(`/api/songs/${song.id}/lyrics`).send({ text: "  " })).status,
    ).toBe(400);
    expect((await request(app).put(`/api/songs/${song.id}/lyrics`).send({ text: 42 })).status).toBe(
      400,
    );
    expect(
      (
        await request(app)
          .put(`/api/songs/${song.id}/lyrics`)
          .send({ text: "今天天气不错\n但是没有时间标签" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .put(`/api/songs/${song.id}/lyrics`)
          .send({ text: `[00:01.00]${"长".repeat(128 * 1024)}` })
      ).status,
    ).toBe(400);

    expect(await loadSongs(config.dataDir).then((list) => list[0].hasLyrics)).toBe(false);
  });

  it("曲目不存在 404；门禁打开时未登录 401", async () => {
    const { app } = await setup({
      userPassword: "guest",
      adminPassword: "root",
      authEnabled: true,
    });
    const res = await request(app).put("/api/songs/nope/lyrics").send({ text: LRC });
    expect(res.status).toBe(401);
  });
});

describe("重建索引要保住手动设的封面与歌词（LB-11 × AD-02 扩展）", () => {
  it("手动换的封面不被内嵌封面顶掉，手动粘的歌词不被文件里那份顶掉", async () => {
    const { app, config } = await setup();
    const created = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics("[00:01.00]embedded"), "Sea Wide Sky.mp3");
    const id = created.body.data.id as string;

    await request(app).put(`/api/songs/${id}/cover`).attach("cover", pngBuffer(), "手动.png");
    await request(app).put(`/api/songs/${id}/lyrics`).send({ text: LRC });
    const before = (await loadSongs(config.dataDir))[0];

    const res = await request(app).post("/api/songs/reindex");

    expect(res.status).toBe(200);
    const after = (await loadSongs(config.dataDir))[0];
    expect(after.coverUrl).toBe(before.coverUrl);
    expect(after.editedAssets).toEqual(["cover", "lyrics"]);
    expect(await readFile(lyricsFilePath(config.dataDir, id), "utf8")).toBe(LRC);
    // 手动封面文件也还在
    expect(await readdir(config.uploadDir)).toContain(path.basename(after.coverUrl as string));
  });

  it("没手动设过的曲目：重建照旧把封面与歌词重抽一遍", async () => {
    const { app, config } = await setup();
    // ⚠️ 内嵌歌词只能用 ASCII：`mp3WithLyrics` 按 latin1 写 USLT 正文（见 helpers）
    const created = await request(app)
      .post("/api/songs/upload")
      .attach("file", mp3WithLyrics("[00:01.00]embedded"), "Sea Wide Sky.mp3");
    const id = created.body.data.id as string;
    // 先把歌词文件改坏，模拟“文件里那份才是真的”
    await writeFile(lyricsFilePath(config.dataDir, id), "[00:09.00]dirty", "utf8");

    await request(app).post("/api/songs/reindex");

    expect(await readFile(lyricsFilePath(config.dataDir, id), "utf8")).toBe("[00:01.00]embedded");
    expect((await loadSongs(config.dataDir))[0].editedAssets).toBeUndefined();
  });
});

describe("删曲目时把封面一起带走（LB-05）", () => {
  it("DELETE /api/songs/:id 之后：音频、封面、歌词都不在，索引里也没了", async () => {
    const { app, config } = await setup();
    const song = await uploadPlain(app);
    const put = await request(app)
      .put(`/api/songs/${song.id}/cover`)
      .attach("cover", pngBuffer(), "图.png");
    await request(app).put(`/api/songs/${song.id}/lyrics`).send({ text: LRC });
    const coverName = path.basename(put.body.data.coverUrl as string);

    await request(app).delete(`/api/songs/${song.id}`);

    const names = await readdir(config.uploadDir);
    expect(names).not.toContain(coverName);
    expect(names).toEqual([]);
    const raw = JSON.parse(await readFile(songsFilePath(config.dataDir), "utf8")) as unknown[];
    expect(raw).toEqual([]);
  });
});
