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
  "/lyric/new": {
    body: { lrc: { lyric: "[00:01.17]夜曲" }, tlyric: { lyric: "[00:01.17]Night Song" } },
  },
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
  login_qr_key: async () => ({ status: 200, body: { data: { unikey: "KEY123" } } }),
  login_qr_create: async () => ({
    status: 200,
    body: { data: { qrimg: "data:image/png;base64,xx" } },
  }),
  login_qr_check: async () => ({
    status: 200,
    body: { code: 803 },
    cookie: ["MUSIC_U=from-qr"],
  }),
  login_status: async () => ({
    status: 200,
    body: {
      data: {
        code: 200,
        profile: { userId: 77, nickname: "夜行客", avatarUrl: "https://p1.music.126.net/a.jpg" },
      },
    },
  }),
  user_playlist: async () => ({
    status: 200,
    body: {
      playlist: [
        { id: 100, name: "我喜欢的音乐", trackCount: 1, coverImgUrl: "https://p1.music.126.net/c.jpg" },
      ],
    },
  }),
  playlist_track_all: async () => ({
    status: 200,
    body: { songs: [{ id: 186016, name: "夜曲", dt: 226000, fee: 1 }] },
  }),
  logout: async () => ({ status: 200, body: { code: 200 } }),
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

  it("歌词返回原文与翻译；id 形状不合法 400（../ 这类别想顺进查询串）", async () => {
    const { app } = await setup();

    const res = await request(app).get("/api/online/netease/lyrics?id=186016");
    expect(res.body.data).toEqual({
      lyrics: "[00:01.17]夜曲",
      translation: "[00:01.17]Night Song",
    });
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

describe("在线音源路由 · 账号与收藏夹（ON-10，会话存前端 v6.31）", () => {
  /** 会话经 X-Online-Auth 头随请求走；服务端不落盘 */
  const AUTH = { "X-Online-Auth": "MUSIC_U=from-qr; __csrf_token=x" };

  it("扫码全流程：取二维码 → 轮询 803 把会话**原样交给浏览器** → 带头可验真 → 退出注销", async () => {
    const { app } = await setup({ neteaseApiBase: null });

    const qr = await request(app).post("/api/online/netease/login/qr");
    expect(qr.status).toBe(200);
    expect(qr.body.data).toEqual({ key: "KEY123", qrDataUrl: "data:image/png;base64,xx" });

    // 轮询前：不带会话头就是未登录（且不打扰上游）
    expect((await request(app).get("/api/online/netease/login")).body.data).toEqual({
      loggedIn: false,
      profile: null,
    });

    const check = await request(app).get("/api/online/netease/login/check?key=KEY123");
    expect(check.status).toBe(200);
    // 会话在响应体里交给扫码的浏览器；服务端不留副本
    expect(check.body.data.cookie).toEqual(["MUSIC_U=from-qr"]);
    expect(check.body.data.profile).toEqual({
      userId: "77",
      nickname: "夜行客",
      avatarUrl: "https://p1.music.126.net/a.jpg",
      vip: false,
    });

    // 浏览器存下会话后带头来验：仍有效
    const after = await request(app).get("/api/online/netease/login").set(AUTH);
    expect(after.body.data.loggedIn).toBe(true);
    expect(after.body.data.profile?.nickname).toBe("夜行客");

    const logout = await request(app).delete("/api/online/netease/login").set(AUTH);
    expect(logout.status).toBe(200);
  });

  it("登录态校验：会话失效时音源说不算 → loggedIn false（客户端据此清掉本地会话）", async () => {
    // neteaseApiBase: null 走内嵌库路径 —— 失效场景改桩库的 login_status
    setNeteaseLib({
      ...STUB_LIB,
      login_status: async () => ({ status: 200, body: { data: { code: 301, profile: null } } }),
    });
    const { app } = await setup({ neteaseApiBase: null });
    const res = await request(app).get("/api/online/netease/login").set(AUTH);
    expect(res.body.data).toEqual({ loggedIn: false, profile: null });
  });

  it("收藏夹：不带会话 401；带着失效会话也 401；带有效会话给歌单与曲目", async () => {
    const { app } = await setup({ neteaseApiBase: null });
    expect((await request(app).get("/api/online/netease/collections")).status).toBe(401);

    // 失效会话（login_status 不认）→ 401，提示重新扫码
    setNeteaseLib({
      ...STUB_LIB,
      login_status: async () => ({ status: 200, body: { data: { code: 301, profile: null } } }),
    });
    const broken = await setup({ neteaseApiBase: null });
    expect(
      (await request(broken.app).get("/api/online/netease/collections").set(AUTH)).status,
    ).toBe(401);

    // 恢复有效桩再验“带有效会话”
    setNeteaseLib(STUB_LIB);
    const list = await request(app).get("/api/online/netease/collections").set(AUTH);
    expect(list.status).toBe(200);
    expect(list.body.data.playlists).toEqual([
      { id: "100", name: "我喜欢的音乐", cover: "https://p1.music.126.net/c.jpg", trackCount: 1 },
    ]);

    const tracks = await request(app).get("/api/online/netease/collections/100").set(AUTH);
    expect(tracks.status).toBe(200);
    expect(tracks.body.data.tracks).toEqual([
      {
        id: "186016",
        title: "夜曲",
        artist: "未知歌手",
        album: "未知专辑",
        duration: 226,
        cover: null,
        vipOnly: true,
      },
    ]);
    expect((await request(app).get("/api/online/netease/collections/..%2Fx")).status).toBe(400);
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
