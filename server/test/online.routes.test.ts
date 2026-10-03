import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { setNeteaseLib } from "../src/services/online/netease.js";
import { tempDirs, testConfig } from "./helpers.js";

/**
 * 在线音源路由（PRD 3.5 / ON-01~05）。
 *
 * 适配器自己的映射规则在 `online.netease.test.ts`，这里只管**路由层**的事：
 * 未配置音源 404、参数校验 400、上游故障 502、封面代理的白名单与转发、权限分级。
 * 上游用 `vi.stubGlobal("fetch", …)` 桩掉 —— 从路由到网易云适配器走真实代码，
 * 只有最外层那一次 HTTP 是假的。
 */

/** 上游罐头：按路径前缀回应；不在表里的路径回 404 */
function stubUpstream(routes: UpstreamRoutes = {}) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    const route = key === undefined ? undefined : routes[key];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body ?? null), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const UPSTREAM_OK = {
  "/cloudsearch": { body: { result: { songs: [{ id: 186016, name: "夜曲", dt: 226000 }] } } },
  "/song/url/v1": { body: { data: [{ url: "http://m701.music.126.net/abc.mp3" }] } },
  "/lyric/new": { body: { lrc: { lyric: "[00:01.17]夜曲" } } },
};

type UpstreamRoutes = Record<string, { status?: number; body?: unknown }>;

async function setup(overrides: Record<string, unknown> = {}, upstream: UpstreamRoutes = UPSTREAM_OK) {
  const dirs = await tempDirs();
  const config = testConfig({
    ...dirs,
    neteaseApiBase: "http://ne-api.test",
    onlineEnabled: true,
    ...overrides,
  });
  const fetchMock = stubUpstream(upstream);
  return { app: createApp(config), config, fetchMock };
}

/** 内嵌库的桩：v6.29 起未配置外接地址时路由走内嵌库 —— 用桩避免真网络 */
const STUB_LIB = {
  cloudsearch: async (params: Record<string, unknown>) => ({
    status: 200,
    body: { result: { songs: [{ id: 186016, name: "夜曲", dt: 226000 }] } },
    params,
  }),
  song_url_v1: async () => ({
    status: 200,
    body: { data: [{ url: "http://m701.music.126.net/abc.mp3" }] },
  }),
  lyric_new: async () => ({ status: 200, body: { lrc: { lyric: "[00:01.17]夜曲" } } }),
};

beforeEach(() => setNeteaseLib(STUB_LIB));
afterEach(() => {
  setNeteaseLib(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("在线音源路由 · 搜索（ON-02）", () => {
  it("搜索返回统一格式；provider 与 keyword 原样带回", async () => {
    const { app, fetchMock } = await setup();
    const res = await request(app).get("/api/online/netease/search?keywords=夜曲");

    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("netease");
    expect(res.body.data.keyword).toBe("夜曲");
    expect(res.body.data.tracks[0]).toMatchObject({ id: "186016", title: "夜曲", duration: 226 });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/cloudsearch");
  });

  it("关键词为空 400；没这个音源 404", async () => {
    const { app } = await setup();
    expect((await request(app).get("/api/online/netease/search?keywords=%20%20")).status).toBe(400);
    expect((await request(app).get("/api/online/qq/search?keywords=x")).status).toBe(404);
  });

  it("未配置外接地址（ON-04）时走内嵌库：同样出结果，部署零配置（v6.29）", async () => {
    const { app } = await setup({ neteaseApiBase: null });
    const res = await request(app).get("/api/online/netease/search?keywords=夜曲");

    expect(res.status).toBe(200);
    expect(res.body.data.tracks[0]).toMatchObject({ id: "186016", title: "夜曲" });
  });

  it("上游故障 502（与「没有这个音源」的 404 分开）", async () => {
    const { app } = await setup({}, { "/cloudsearch": { status: 500, body: "boom" } });
    const res = await request(app).get("/api/online/netease/search?keywords=x");

    expect(res.status).toBe(502);
    expect(res.body.message).toBe("音源暂时连不上，稍后再试");
  });

  it("门禁开启时未登录 401（AC-03：在线音源归访客级）", async () => {
    const { app } = await setup({ userPassword: "guest-pass", authEnabled: true });
    expect((await request(app).get("/api/online/netease/search?keywords=x")).status).toBe(401);
  });
});

describe("在线音源路由 · 播放地址与歌词（ON-03 / ON-05）", () => {
  it("有地址给 { url }（并升到 https）；VIP/无版权给 { url: null }（200，是业务结果不是错误）", async () => {
    const { app } = await setup();

    const ok = await request(app).get("/api/online/netease/stream?id=186016");
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ url: "https://m701.music.126.net/abc.mp3" });

    const none = await setup({}, { "/song/url/v1": { body: { data: [{ url: null }] } } });
    const res = await request(none.app).get("/api/online/netease/stream?id=186016");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ url: null });
  });

  it("歌词返回原文；id 形状不合法 400（../ 这类别想顺进查询串）", async () => {
    const { app } = await setup();

    const res = await request(app).get("/api/online/netease/lyrics?id=186016");
    expect(res.body.data).toEqual({ lyrics: "[00:01.17]夜曲" });
    expect((await request(app).get("/api/online/netease/lyrics?id=../etc")).status).toBe(400);
    expect((await request(app).get("/api/online/netease/stream?id=")).status).toBe(400);
  });

  it("stream / lyrics 的上游故障同样 502", async () => {
    const { app } = await setup({}, { "/song/url/v1": { status: 500, body: "boom" } });
    expect((await request(app).get("/api/online/netease/stream?id=186016")).status).toBe(502);

    const brokenLyrics = await setup({}, { "/lyric/new": { status: 500, body: "boom" } });
    expect((await request(brokenLyrics.app).get("/api/online/netease/lyrics?id=186016")).status).toBe(
      502,
    );
  });
});

describe("在线音源路由 · 封面代理（VS-02 取色要走 same-origin）", () => {
  it("白名单内的图片转发：原样给 Content-Type，带一天缓存", async () => {
    const { app } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })),
    );

    const res = await request(app).get(
      "/api/online/netease/cover?url=" + encodeURIComponent("https://p1.music.126.net/x/1.jpg"),
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toBe("public, max-age=86400");
    expect(res.body).toEqual(Buffer.from([1, 2, 3]));
  });

  it("白名单外 403；上游取不到 502", async () => {
    const { app } = await setup();

    const forbidden = await request(app).get(
      "/api/online/netease/cover?url=" + encodeURIComponent("https://evil.com/a.jpg"),
    );
    expect(forbidden.status).toBe(403);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const bad = await request(app).get(
      "/api/online/netease/cover?url=" + encodeURIComponent("https://p1.music.126.net/x/1.jpg"),
    );
    expect(bad.status).toBe(502);
  });
});
