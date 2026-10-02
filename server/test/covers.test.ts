import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { COVER_MIME_BY_EXTENSION } from "@qingting/shared";
import { createApp } from "../src/app.js";
import {
  coverMime,
  coverNameOf,
  newCoverName,
  pruneCovers,
  removeCoverByName,
} from "../src/services/covers.js";
import { tempDirs, testConfig, wavBuffer } from "./helpers.js";

async function setup() {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs });
  await mkdir(config.uploadDir, { recursive: true });
  return { app: createApp(config), config };
}

describe("封面文件名（v6.13：新封面 = 新文件）", () => {
  it("每次生成的名字都不一样（否则同日替换会被 /covers 的一天缓存挡住）", () => {
    const first = newCoverName("song1", "jpg");
    const second = newCoverName("song1", "jpg");
    expect(first).not.toBe(second);
    expect(first.startsWith("song1-")).toBe(true);
    expect(first.endsWith(".jpg")).toBe(true);
  });

  it("从 coverUrl 里取文件名：兼容带查询串的值，路径成分与非法扩展名一律取不到", () => {
    expect(coverNameOf("/covers/abc-123.png")).toBe("abc-123.png");
    expect(coverNameOf("/covers/abc.jpg?v=2")).toBe("abc.jpg");
    expect(coverNameOf("/covers/../data/songs.json")).toBe("");
    expect(coverNameOf("/covers/abc.mp3")).toBe("");
    expect(coverNameOf(null)).toBe("");
  });

  it("扩展名白名单是共享的（落盘 / 清理 / /covers 三处同一份）", () => {
    expect(Object.keys(COVER_MIME_BY_EXTENSION).sort()).toEqual(["jpeg", "jpg", "png", "webp"]);
    expect(coverMime("a.webp")).toBe("image/webp");
    expect(coverMime("a.gif")).toBeNull();
  });
});

describe("removeCoverByName（按准确文件名删）", () => {
  it("只删指定的那一个，别人的封面不动", async () => {
    const { config } = await setup();
    await writeFile(path.join(config.uploadDir, "song1-old.jpg"), "旧图");
    await writeFile(path.join(config.uploadDir, "song1-new.png"), "新图");
    await writeFile(path.join(config.uploadDir, "song2.png"), "别首歌的");

    await removeCoverByName(config, "song1-old.jpg");

    const names = await readdir(config.uploadDir);
    expect(names).not.toContain("song1-old.jpg");
    expect(names).toEqual(expect.arrayContaining(["song1-new.png", "song2.png"]));
  });

  it("文件名不像封面（音频 / 带路径）时直接拒绡，不做任何删除", async () => {
    const { config } = await setup();
    await writeFile(path.join(config.uploadDir, "song1.mp3"), "音频");

    await removeCoverByName(config, "song1.mp3");
    await removeCoverByName(config, "../data/songs.json");

    expect(await readdir(config.uploadDir)).toContain("song1.mp3");
  });

  it("文件不在也不报错", async () => {
    const { config } = await setup();
    await expect(removeCoverByName(config, "nobody.jpg")).resolves.toBeUndefined();
  });
});

describe("pruneCovers（v6.8）", () => {
  it("删掉索引不再引用的封面，保留在用的那些，且**绝不碰音频**", async () => {
    const { config } = await setup();
    await writeFile(path.join(config.uploadDir, "keep.png"), "留着");
    await writeFile(path.join(config.uploadDir, "keep-2.jpg"), "新命名也认");
    await writeFile(path.join(config.uploadDir, "orphan.jpg"), "没人引用");
    await writeFile(path.join(config.uploadDir, "song.mp3"), "音频");

    const removed = await pruneCovers(config, ["keep.png", "keep-2.jpg"]);

    expect(removed).toBe(1);
    const names = await readdir(config.uploadDir);
    expect(names).toEqual(expect.arrayContaining(["keep.png", "keep-2.jpg", "song.mp3"]));
    expect(names).not.toContain("orphan.jpg");
  });
});

describe("POST /api/songs/reindex 的封面收尾", () => {
  it("重建索引顺手清掉孤儿封面（歌词早就有这一手，封面原先只增不减）", async () => {
    const { app, config } = await setup();
    await request(app).post("/api/songs/upload").attach("file", wavBuffer(1), "A-第一首.wav");
    // 造两个“没人引用”的封面文件（老 id 的、和被删歌留下的）
    await writeFile(path.join(config.uploadDir, "stale1.png"), "x");
    await writeFile(path.join(config.uploadDir, "stale2.jpg"), "x");

    const res = await request(app).post("/api/songs/reindex");

    expect(res.status).toBe(200);
    const names = await readdir(config.uploadDir);
    expect(names).not.toContain("stale1.png");
    expect(names).not.toContain("stale2.jpg");
    // 音频还在
    expect(names.some((name) => name.endsWith(".wav"))).toBe(true);
  });
});
