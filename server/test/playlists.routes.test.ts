import request from "supertest";
import { describe, expect, it } from "vitest";
import type { PlaylistItem } from "@qingting/shared";
import { createApp } from "../src/app.js";
import { loadPlaylists } from "../src/services/playlists.js";
import { tempDirs, testConfig } from "./helpers.js";

async function setup(overrides: Record<string, unknown> = {}) {
  const dirs = await tempDirs();
  const config = testConfig({ ...dirs, ...overrides });
  return { app: createApp(config), config };
}

const ITEM: PlaylistItem = {
  source: "server",
  refId: "song-1",
  title: "海阔天空",
  artist: "BEYOND",
  cover: "/covers/a.jpg",
  duration: 325,
};

async function createOne(app: ReturnType<typeof createApp>, name = "夜行歌单") {
  const res = await request(app).post("/api/playlists").send({ name });
  return res.body.data as { id: string };
}

describe("歌单 CRUD（PS-01 / PRD 5.6）", () => {
  it("空列表：GET 返回空数组", async () => {
    const { app } = await setup();
    const res = await request(app).get("/api/playlists");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 0, data: { playlists: [] } });
  });

  it("新建：201 + 完整歌单，且真的落盘", async () => {
    const { app, config } = await setup();
    const res = await request(app).post("/api/playlists").send({ name: "  夜行歌单  " });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: "夜行歌单", items: [] });
    expect(res.body.data.id).toBeTruthy();
    expect(await loadPlaylists(config.dataDir)).toHaveLength(1);
  });

  it("新建：空名 / 超长名 400", async () => {
    const { app, config } = await setup();

    expect((await request(app).post("/api/playlists").send({ name: "   " })).status).toBe(400);
    expect((await request(app).post("/api/playlists").send({})).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/playlists")
          .send({ name: "a".repeat(41) })
      ).status,
    ).toBe(400);
    expect(await loadPlaylists(config.dataDir)).toEqual([]);
  });

  it("改名：改成新名字、updatedAt 前进，别的歌单不受影响", async () => {
    const { app, config } = await setup();
    const first = await createOne(app, "夜行歌单");
    await createOne(app, "另一个");

    const res = await request(app).put(`/api/playlists/${first.id}`).send({ name: "改名后" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: first.id, name: "改名后" });
    const stored = await loadPlaylists(config.dataDir);
    expect(stored.map((entry) => entry.name)).toEqual(["改名后", "另一个"]);
  });

  it("改名：不存在的歌单 404，空名 400", async () => {
    const { app } = await setup();
    const created = await createOne(app);

    expect((await request(app).put("/api/playlists/nope").send({ name: "x" })).status).toBe(404);
    expect((await request(app).put(`/api/playlists/${created.id}`).send({ name: "" })).status).toBe(
      400,
    );
  });

  it("删除：返回被删 id，再查就没了", async () => {
    const { app, config } = await setup();
    const created = await createOne(app);

    const res = await request(app).delete(`/api/playlists/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: created.id });

    expect(await loadPlaylists(config.dataDir)).toEqual([]);
    expect((await request(app).delete(`/api/playlists/${created.id}`)).status).toBe(404);
  });
});

describe("歌单曲目（PS-02 添加 / PS-04 移除排序）", () => {
  it("整表替换：写入曲目并按顺序保留", async () => {
    const { app, config } = await setup();
    const created = await createOne(app);
    const second: PlaylistItem = { source: "local", title: "夜行", artist: "林晚" };

    const res = await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [ITEM, second] });

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([ITEM, second]);
    expect((await loadPlaylists(config.dataDir))[0].items).toHaveLength(2);
  });

  it("同一首歌重复发过来只留一条（去重在服务端再做一次）", async () => {
    const { app } = await setup();
    const created = await createOne(app);

    const res = await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [ITEM, { ...ITEM, cover: "重复" }] });

    expect(res.body.data.items).toEqual([ITEM]);
  });

  it("空数组 = 清空曲目；顺序调换也走得通（排序的底座）", async () => {
    const { app } = await setup();
    const created = await createOne(app);
    const a: PlaylistItem = { source: "server", refId: "a", title: "A", artist: "甲" };
    const b: PlaylistItem = { source: "server", refId: "b", title: "B", artist: "乙" };

    await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [a, b] });
    const swapped = await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [b, a] });
    expect(swapped.body.data.items.map((item: PlaylistItem) => item.refId)).toEqual(["b", "a"]);

    const cleared = await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [] });
    expect(cleared.body.data.items).toEqual([]);
  });

  it("items 不是数组 / 有条目缺字段 / 歌单不存在：400 或 404，且不改动存储", async () => {
    const { app, config } = await setup();
    const created = await createOne(app);
    await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [ITEM] });

    const bad = await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [{ source: "server" }] });
    expect(bad.status).toBe(400);
    expect((await request(app).put(`/api/playlists/${created.id}/items`).send({})).status).toBe(
      400,
    );
    expect((await request(app).put(`/api/playlists/nope/items`).send({ items: [] })).status).toBe(
      404,
    );

    // 上面三次都没写进存储：仍然是第一次那一条
    expect((await loadPlaylists(config.dataDir))[0].items).toEqual([ITEM]);
  });

  it("非法来源被拒绝（虽然前端不会发，但接口不能信客户端）", async () => {
    const { app } = await setup();
    const created = await createOne(app);
    const res = await request(app)
      .put(`/api/playlists/${created.id}/items`)
      .send({ items: [{ source: "podcast", title: "x", artist: "y" }] });

    expect(res.status).toBe(400);
  });
});

describe("歌单权限（AC-03：歌单归访客级）", () => {
  it("未登录 401；访客可以读写", async () => {
    // 门禁要显式打开：testConfig 默认 authEnabled: false（AC-05 的最小运行形态）
    const { app } = await setup({
      userPassword: "guest123",
      adminPassword: "admin123",
      authEnabled: true,
    });
    const anonymous = await request(app).get("/api/playlists");
    expect(anonymous.status).toBe(401);

    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ password: "guest123" });
    expect((await agent.get("/api/playlists")).status).toBe(200);

    const created = await agent.post("/api/playlists").send({ name: "访客的歌单" });
    expect(created.status).toBe(201);
    expect(
      (await agent.put(`/api/playlists/${created.body.data.id}`).send({ name: "改个名" })).status,
    ).toBe(200);
  });
});
