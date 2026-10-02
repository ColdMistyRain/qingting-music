import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  COVER_MIME_BY_EXTENSION,
  pruneCovers,
  removeCoverVariants,
} from "../src/services/covers.js";
import { tempDirs, testConfig, wavBuffer } from "./helpers.js";

async function setup() {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs });
  await mkdir(config.uploadDir, { recursive: true });
  return { app: createApp(config), config };
}

describe("removeCoverVariants（v6.8）", () => {
  it("删掉同一首歌名下所有扩展名的旧封面，但不动别人的文件", async () => {
    const { config } = await setup();
    await writeFile(path.join(config.uploadDir, "song1.jpg"), "old-jpg");
    await writeFile(path.join(config.uploadDir, "song1.png"), "older-png");
    await writeFile(path.join(config.uploadDir, "song2.png"), "别首歌的");

    await removeCoverVariants(config, "song1");

    const names = await readdir(config.uploadDir);
    expect(names).not.toContain("song1.jpg");
    expect(names).not.toContain("song1.png");
    expect(names).toContain("song2.png");
  });

  it("没有旧封面时也不报错（首次落盘就是这条路径）", async () => {
    const { config } = await setup();
    await expect(removeCoverVariants(config, "nobody")).resolves.toBeUndefined();
  });
});

describe("pruneCovers（v6.8）", () => {
  it("删掉索引不再引用的封面，保留在用的那些，且**绝不碰音频**", async () => {
    const { config } = await setup();
    await writeFile(path.join(config.uploadDir, "keep.png"), "留着");
    await writeFile(path.join(config.uploadDir, "orphan.jpg"), "没人引用");
    await writeFile(path.join(config.uploadDir, "song.mp3"), "音频");

    const removed = await pruneCovers(config, ["keep.png"]);

    expect(removed).toBe(1);
    const names = await readdir(config.uploadDir);
    expect(names).toEqual(expect.arrayContaining(["keep.png", "song.mp3"]));
    expect(names).not.toContain("orphan.jpg");
  });

  it("封面扩展名白名单是共享的（落盘 / 清理 / /covers 三处同一份）", async () => {
    expect(Object.keys(COVER_MIME_BY_EXTENSION).sort()).toEqual(["jpeg", "jpg", "png", "webp"]);
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
