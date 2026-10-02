import { readdir } from "node:fs/promises";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadSongs } from "../src/services/storage.js";
import { tempDirs, testConfig, wavBuffer } from "./helpers.js";

/**
 * 覆盖上传的**顺序契约**（v6.8）：
 * 索引先写、旧文件后删。反过来（先删旧文件再写索引）时，只要写索引失败，
 * 索引里就会留下一条指向已删文件的记录 —— 界面上是一排点不动的鬼影条目，
 * 而 reindex 只能捞孤儿文件、捞不回这种条目（AGENTS 坑 20 就是踩的这个）。
 *
 * 怎么注入失败：直接把存储模块的 updateSongs 换成"抛错"的版本（`vi.hoisted` 拿一个
 * 共享开关，默认透传给真实实现）。为什么不用"占住临时文件名"那招了 —— 随机临时名
 * （`<目标>.<随机>.tmp`）正是这次修的另一半，占位已经拦不住它。
 */
const controls = vi.hoisted(() => ({ failIndexWrite: false }));

vi.mock("../src/services/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/storage.js")>();
  return {
    ...actual,
    updateSongs: (dataDir: string, change: Parameters<typeof actual.updateSongs>[1]) => {
      if (controls.failIndexWrite) throw new Error("模拟写索引失败");
      return actual.updateSongs(dataDir, change);
    },
  };
});

async function setup() {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs });
  return { app: createApp(config), config };
}

beforeEach(() => {
  controls.failIndexWrite = false;
});

describe("覆盖上传的顺序（v6.8）", () => {
  it("索引写失败：旧曲目仍在索引里、旧音频文件也还在（不留鬼影）", async () => {
    const { app, config } = await setup();
    const first = await request(app)
      .post("/api/songs/upload")
      .attach("file", wavBuffer(1), "周杰伦-晴天.wav");
    const before = first.body.data as { id: string; storedName: string };

    controls.failIndexWrite = true;
    const res = await request(app)
      .post("/api/songs/upload?overwrite=1")
      .attach("file", wavBuffer(1), "周杰伦-晴天.wav");

    expect(res.status).toBe(500);
    // 索引没被改：还是那一条、还是原来的 id
    const songs = await loadSongs(config.dataDir);
    expect(songs).toHaveLength(1);
    expect(songs[0]?.id).toBe(before.id);
    // 旧文件没被提前删掉 —— 也就是没有"指向已删文件的条目"
    expect(await readdir(config.uploadDir)).toContain(before.storedName);
  });

  it("正常覆盖：索引只剩一条、指向新文件，旧文件被清掉（不留孤儿）", async () => {
    const { app, config } = await setup();
    const first = await request(app)
      .post("/api/songs/upload")
      .attach("file", wavBuffer(1), "周杰伦-晴天.wav");

    const res = await request(app)
      .post("/api/songs/upload?overwrite=1")
      .attach("file", wavBuffer(1), "周杰伦-晴天.wav");

    expect(res.status).toBe(201);
    const songs = await loadSongs(config.dataDir);
    expect(songs).toHaveLength(1);
    expect(songs[0]?.storedName).toBe(res.body.data.storedName);
    expect(await readdir(config.uploadDir)).not.toContain(first.body.data.storedName);
  });
});
