import { readFile, writeFile } from "node:fs/promises";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { RECENT_LIMIT, type ListeningData, type PlaylistItem } from "@qingting/shared";
import { createApp } from "../src/app.js";
import {
  loadListening,
  saveListening,
  withFavorite,
  withRecent,
  withoutFavorite,
} from "../src/services/listening.js";
import { tempDirs, testConfig } from "./helpers.js";

const cloud: PlaylistItem = {
  source: "server",
  refId: "song-1",
  title: "光辉岁月",
  artist: "BEYOND",
  duration: 303,
  cover: "/covers/a.jpg",
};
const local: PlaylistItem = { source: "local", refId: "林晚|夜行", title: "夜行", artist: "林晚" };
const other: PlaylistItem = { source: "server", refId: "song-2", title: "倒数", artist: "G.E.M." };

async function setup() {
  const dirs = await tempDirs();
  const config = testConfig(dirs);
  return { app: createApp(config), config };
}

describe("listening service（PS-05：收藏与最近播放）", () => {
  it("收藏是幂等的：重复收藏不重复、也不改顺序", () => {
    const once = withFavorite({ favorites: [], recent: [] }, cloud);
    const twice = withFavorite(once, cloud);

    expect(once.favorites).toHaveLength(1);
    expect(twice).toBe(once); // 内容没变就返回同一个对象，调用方据此跳过写盘
    const three = withFavorite(twice, local);
    expect(three.favorites.map((item) => item.title)).toEqual(["光辉岁月", "夜行"]);
  });

  it("取消收藏：按身份键定位（不看下标），不在里面也算成功", () => {
    const data: ListeningData = { favorites: [cloud, local], recent: [] };
    const cut = withoutFavorite(data, "server:song-1");

    expect(cut.favorites.map((item) => item.title)).toEqual(["夜行"]);
    expect(withoutFavorite(cut, "server:song-1")).toBe(cut);
  });

  it("最近播放：同一首只留一条并移到最前，信息用最新那份覆盖", () => {
    let data: ListeningData = { favorites: [], recent: [] };
    data = withRecent(data, cloud, "2026-10-02T00:00:00.000Z");
    data = withRecent(data, local, "2026-10-02T00:01:00.000Z");
    data = withRecent(data, { ...cloud, title: "光辉岁月（现场版）" }, "2026-10-02T00:02:00.000Z");

    expect(data.recent.map((entry) => entry.title)).toEqual(["光辉岁月（现场版）", "夜行"]);
    expect(data.recent[0].playedAt).toBe("2026-10-02T00:02:00.000Z");
  });

  it("最近播放截到 100 条：第 101 条进来时丢掉最末尾那条", () => {
    let data: ListeningData = { favorites: [], recent: [] };
    for (let i = 0; i < RECENT_LIMIT + 1; i += 1) {
      data = withRecent(data, { ...cloud, refId: `song-${i}`, title: `第 ${i} 首` }, "t");
    }

    expect(data.recent).toHaveLength(RECENT_LIMIT);
    expect(data.recent[0].title).toBe(`第 ${RECENT_LIMIT} 首`);
    expect(data.recent.at(-1)?.title).toBe("第 1 首");
  });

  it("读坏了当空、脏条目跳过（不崩、也不把好条目连坐）", async () => {
    const dirs = await tempDirs();
    await saveListening(dirs.dataDir, { favorites: [cloud], recent: [] });
    await writeFile(
      `${dirs.dataDir}/listening.json`,
      JSON.stringify({ favorites: [cloud, { source: "server" }, 42], recent: "nope" }),
      "utf8",
    );

    const data = await loadListening(dirs.dataDir);
    expect(data.favorites.map((item) => item.title)).toEqual(["光辉岁月"]);
    expect(data.recent).toEqual([]);
  });
});

describe("收藏 / 最近播放接口（访客级）", () => {
  it("空库返回两份空列表；收藏之后落盘", async () => {
    const { app, config } = await setup();

    const empty = await request(app).get("/api/listening");
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ favorites: [], recent: [] });

    const added = await request(app).post("/api/listening/favorites").send(cloud);
    expect(added.status).toBe(200);
    expect(added.body.data.favorites.map((item: PlaylistItem) => item.title)).toEqual(["光辉岁月"]);

    const onDisk = JSON.parse(await readFile(`${config.dataDir}/listening.json`, "utf8"));
    expect(onDisk.favorites).toHaveLength(1);
  });

  it("重复收藏不写第二次盘；取消收藏按身份键生效", async () => {
    const { app, config } = await setup();
    await request(app).post("/api/listening/favorites").send(cloud);
    const before = await readFile(`${config.dataDir}/listening.json`, "utf8");

    await request(app).post("/api/listening/favorites").send(cloud);
    expect(await readFile(`${config.dataDir}/listening.json`, "utf8")).toBe(before);

    const removed = await request(app).delete(
      `/api/listening/favorites/${encodeURIComponent("server:song-1")}`,
    );
    expect(removed.status).toBe(200);
    expect(removed.body.data.favorites).toEqual([]);

    // 再删一次也是 200（幂等），不该报错
    const again = await request(app).delete(
      `/api/listening/favorites/${encodeURIComponent("server:song-1")}`,
    );
    expect(again.status).toBe(200);
  });

  it("最近播放：最新的排最前，可以整份清空", async () => {
    const { app } = await setup();
    await request(app).post("/api/listening/recent").send(cloud);
    await request(app).post("/api/listening/recent").send(local);
    const listed = await request(app).post("/api/listening/recent").send(other);

    expect(listed.body.data.recent.map((entry: { title: string }) => entry.title)).toEqual([
      "倒数",
      "夜行",
      "光辉岁月",
    ]);

    const cleared = await request(app).delete("/api/listening/recent");
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.recent).toEqual([]);
    expect((await request(app).get("/api/listening")).body.data.recent).toEqual([]);
  });

  it("畸形的曲目引用：400，不写盘", async () => {
    const { app, config } = await setup();

    expect((await request(app).post("/api/listening/favorites").send({ title: "x" })).status).toBe(
      400,
    );
    expect((await request(app).post("/api/listening/recent").send({ source: "nope" })).status).toBe(
      400,
    );
    await expect(readFile(`${config.dataDir}/listening.json`, "utf8")).rejects.toThrow();
  });

  it("门禁打开且未登录：401（访客级，别写成 admin）", async () => {
    const dirs = await tempDirs();
    const app = createApp(testConfig({ ...dirs, userPassword: "guest", authEnabled: true }));

    expect((await request(app).get("/api/listening")).status).toBe(401);
    expect((await request(app).post("/api/listening/favorites").send(cloud)).status).toBe(401);
    expect((await request(app).delete("/api/listening/recent")).status).toBe(401);
  });
});
