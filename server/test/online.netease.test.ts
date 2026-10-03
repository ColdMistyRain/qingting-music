import { afterEach, describe, expect, it, vi } from "vitest";
import { createNeteaseProvider, setNeteaseLib } from "../src/services/online/netease.js";
import { UpstreamError } from "../src/services/online/provider.js";

/** 桩 fetch：记录请求，按路径前缀回罐头响应 */
function stubFetch(
  routes: Record<string, { status?: number; body?: unknown; contentType?: string; raw?: string }>,
) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    calls.push(path);
    const route = key === undefined ? undefined : routes[key];
    if (!route) return new Response("not found", { status: 404 });
    const text = route.raw ?? JSON.stringify(route.body ?? null);
    return new Response(text, {
      status: route.status ?? 200,
      headers: { "Content-Type": route.contentType ?? "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const BASE = "http://ne-api.test";

function makeProvider(
  routes: Record<string, { status?: number; body?: unknown; raw?: string; contentType?: string }>,
) {
  const stub = stubFetch(routes);
  return { provider: createNeteaseProvider({ baseUrl: BASE, fetchImpl: stub.impl }), stub };
}

describe("网易云适配器 · 搜索（ON-02）", () => {
  it("把 cloudsearch 的字段映射成统一格式：毫秒转秒、歌手数组连接、fee===1 记为 VIP", async () => {
    const { provider, stub } = makeProvider({
      "/cloudsearch": {
        body: {
          result: {
            songs: [
              {
                id: 186016,
                name: "夜曲",
                fee: 8,
                dt: 226000,
                ar: [{ name: "周杰伦" }, { name: "林俊杰" }],
                al: { name: "十一月的萧邦", picUrl: "http://p1.music.126.net/x/1.jpg" },
              },
              { id: 999, name: "VIP 专享", fee: 1, dt: 180500, ar: [{ name: "某人" }], al: {} },
            ],
          },
        },
      },
    });

    const tracks = await provider.search("夜曲");

    expect(stub.calls[0]).toBe(
      "/cloudsearch?keywords=" + encodeURIComponent("夜曲") + "&type=1&limit=30",
    );
    expect(tracks).toEqual([
      {
        id: "186016",
        title: "夜曲",
        artist: "周杰伦 / 林俊杰",
        album: "十一月的萧邦",
        duration: 226,
        cover: "http://p1.music.126.net/x/1.jpg",
        vipOnly: false,
      },
      {
        id: "999",
        title: "VIP 专享",
        artist: "某人",
        album: "未知专辑",
        duration: 181,
        cover: null,
        vipOnly: true,
      },
    ]);
  });

  it("无版权曲目打 unavailable 标：noCopyrightRcmd 或 privileges.st<0 任一信号即可（v6.35 补 6）", async () => {
    const { provider } = makeProvider({
      "/cloudsearch": {
        body: {
          result: {
            songs: [
              { id: 1, name: "无版权的", fee: 0, noCopyrightRcmd: { type: 1, typeDesc: "无版权" } },
              { id: 2, name: "权限说不行", fee: 0 },
              { id: 3, name: "正常的", fee: 8 },
            ],
            privileges: [{ id: 2, st: -1 }, { id: 3, st: 0 }],
          },
        },
      },
    });

    const tracks = await provider.search("x");
    expect(tracks.map((t) => ({ title: t.title, unavailable: t.unavailable ?? null }))).toEqual([
      { title: "无版权的", unavailable: true },
      { title: "权限说不行", unavailable: true },
      { title: "正常的", unavailable: null },
    ]);
  });

  it("脏数据行（缺 id / 缺歌名）跳过，不炸整份结果；无结果返回空数组", async () => {
    const { provider } = makeProvider({
      "/cloudsearch": {
        body: {
          result: {
            songs: [{ name: "没有 id" }, { id: 1 }, { id: 2, name: "好歌", dt: 60000 }],
          },
        },
      },
    });
    expect(await provider.search("x")).toEqual([
      {
        id: "2",
        title: "好歌",
        artist: "未知歌手",
        album: "未知专辑",
        duration: 60,
        cover: null,
        vipOnly: false,
      },
    ]);

    const empty = makeProvider({ "/cloudsearch": { body: {} } });
    expect(await empty.provider.search("x")).toEqual([]);
  });
});

describe("网易云适配器 · 播放地址（ON-03）", () => {
  it("返回直链并升到 https（http 直链在 HTTPS 部署下会被当混合内容拦掉）", async () => {
    const { provider } = makeProvider({
      "/song/url/v1": { body: { data: [{ url: "http://m701.music.126.net/abc.mp3" }] } },
    });
    expect(await provider.getStreamUrl("186016")).toBe("https://m701.music.126.net/abc.mp3");
  });

  it("url 为 null / 空串 / 缺 data 都是没有可用音源（VIP / 无版权）→ null，不是抛错", async () => {
    const none = makeProvider({ "/song/url/v1": { body: { data: [{ url: null }] } } });
    expect(await none.provider.getStreamUrl("1")).toBeNull();

    const empty = makeProvider({ "/song/url/v1": { body: { data: [{ url: "" }] } } });
    expect(await empty.provider.getStreamUrl("1")).toBeNull();

    const broken = makeProvider({ "/song/url/v1": { body: {} } });
    expect(await broken.provider.getStreamUrl("1")).toBeNull();
  });

  it("上游应答带 freeTrialInfo = 这条直链只是试听片段 → 视同没有可用音源（放一半就断不如明说）", async () => {
    const trial = makeProvider({
      "/song/url/v1": {
        body: { data: [{ url: "http://m801.music.126.net/trial.mp3", freeTrialInfo: { end: 32 } }] },
      },
    });
    expect(await trial.provider.getStreamUrl("1")).toBeNull();

    const full = makeProvider({
      "/song/url/v1": { body: { data: [{ url: "http://m801.music.126.net/full.mp3", freeTrialInfo: null }] } },
    });
    expect(await full.provider.getStreamUrl("1")).toBe("https://m801.music.126.net/full.mp3");
  });
});

describe("网易云适配器 · 歌词（ON-05）", () => {
  it("优先取逐字 yrc；没有 yrc 时退回行级 lrc", async () => {
    const withYrc = makeProvider({
      "/lyric/new": { body: { yrc: { lyric: "[1170,2900](1170,240,0)糖" }, lrc: { lyric: "[00:01.17]糖" } } },
    });
    expect((await withYrc.provider.getLyrics("1"))?.lyrics).toBe("[1170,2900](1170,240,0)糖");

    const lineOnly = makeProvider({
      "/lyric/new": { body: { lrc: { lyric: "[00:01.17]糖" } } },
    });
    expect((await lineOnly.provider.getLyrics("1"))?.lyrics).toBe("[00:01.17]糖");
  });

  it("旧版服务没有 /lyric/new（404）时回落 /lyric", async () => {
    const { provider, stub } = makeProvider({
      "/lyric/new": { status: 404, body: { msg: "未知接口" } },
      "/lyric": { body: { lrc: { lyric: "[00:01.17]糖" } } },
    });
    expect((await provider.getLyrics("1"))?.lyrics).toBe("[00:01.17]糖");
    expect(stub.calls.some((path) => path.startsWith("/lyric?"))).toBe(true);
  });

  it("JSON 行与文本 yrc 混在同一个字段：JSON 行转行级 LRC，文本 yrc 原样保留（逐字不丢）", async () => {
    // 实测周深《起风了》：credits 是 JSON 行，唱词是真·文本 yrc，混在 yrc 字段里
    const mixed = [
      '{"t":0,"c":[{"tx":"作曲: "},{"tx":"高桥优"}]}',
      '{"t":1000,"c":[{"tx":"作词: "},{"tx":"米果"}]}',
      "[24810,3150](24810,630,0)这(25440,300,0)一(25740,390,0)路",
      "[27960,2820](27960,540,0)顺(28500,270,0)着",
    ].join("\n");
    const { provider } = makeProvider({ "/lyric/new": { body: { yrc: { lyric: mixed } } } });

    const { lyrics: text } = await provider.getLyrics("1");
    expect(text).toBe(
      "[00:00.00]作曲: 高桥优\n" +
        "[00:01.00]作词: 米果\n" +
        "[24810,3150](24810,630,0)这(25440,300,0)一(25740,390,0)路\n" +
        "[27960,2820](27960,540,0)顺(28500,270,0)着",
    );
  });

  it("纯 JSON 行歌词归一成行级 LRC；普通文本行原样保留（可能是 LRC/yrc 行，由解析器取舍），负起点夹到 0", async () => {
    const jsonLyric = [
      '{"t":0,"c":[{"tx":"作词: "},{"tx":"Lucky 小爱"}]}',
      '{"t":1000,"c":[{"tx":"第一句"}]}',
      "不是 JSON 的行会被跳过",
      '{"t":"不是数字"}',
      '{"t":2500,"c":[]}',
      '{"t":-500,"c":[{"tx":"预备行"}]}',
    ].join("\n");
    const { provider } = makeProvider({ "/lyric/new": { body: { lrc: { lyric: jsonLyric } } } });

    const { lyrics: text } = await provider.getLyrics("1");
    expect(text).toBe(
      "[00:00.00]作词: Lucky 小爱\n[00:01.00]第一句\n不是 JSON 的行会被跳过\n[00:00.00]预备行",
    );
  });

  it("翻译 tlyric 随正文带出（v6.40）；正文为空时不给孤立的翻译", async () => {
    const withTrans = makeProvider({
      "/lyric/new": {
        body: {
          lrc: { lyric: "[00:01.00]한국어 가사" },
          tlyric: { lyric: "[00:01.00]韩国歌词" },
        },
      },
    });
    expect(await withTrans.provider.getLyrics("1")).toEqual({
      lyrics: "[00:01.00]한국어 가사",
      translation: "[00:01.00]韩国歌词",
    });

    const noText = makeProvider({
      "/lyric/new": { body: { tlyric: { lyric: "[00:01.00]孤立的翻译" } } },
    });
    expect(await noText.provider.getLyrics("1")).toEqual({ lyrics: null, translation: null });
  });

  it("两边都是空歌词 → null；上游 5xx 抛 UpstreamError（不回落）", async () => {
    const blank = makeProvider({ "/lyric/new": { body: { lrc: { lyric: "" } } } });
    expect((await blank.provider.getLyrics("1"))?.lyrics).toBeNull();

    const down = makeProvider({ "/lyric/new": { status: 502, body: "bad gateway" } });
    await expect(down.provider.getLyrics("1")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("网易云适配器 · 封面白名单（cover 代理的 SSRF 防线）", () => {
  const provider = createNeteaseProvider({
    baseUrl: BASE,
    fetchImpl: (() => undefined) as unknown as typeof fetch,
  });

  it("放行网易云自家图片 CDN（http 与 https、带图片后缀的路径）", () => {
    expect(provider.canProxyCover("https://p1.music.126.net/abc/1.jpg")).toBe(true);
    expect(provider.canProxyCover("http://p2.music.126.net/abc/1.jpg?param=300y300")).toBe(true);
    expect(provider.canProxyCover("https://music.126.net/abc/1.jpg")).toBe(true);
  });

  it("别家的、伪造后缀的、非 http(s) 的、解析不出来的都不放行", () => {
    expect(provider.canProxyCover("https://evil.com/a.jpg")).toBe(false);
    expect(provider.canProxyCover("https://evil.com/?x= music.126.net")).toBe(false);
    expect(provider.canProxyCover("https://music.126.net.evil.com/a.jpg")).toBe(false);
    expect(provider.canProxyCover("file:///etc/passwd")).toBe(false);
    expect(provider.canProxyCover("javascript:alert(1)")).toBe(false);
    expect(provider.canProxyCover("不是地址")).toBe(false);
  });
});

describe("网易云适配器 · 上游故障", () => {
  it("上游非 2xx / 非 JSON / 超时都归为 UpstreamError", async () => {
    const fail500 = makeProvider({ "/cloudsearch": { status: 500, body: "boom" } });
    await expect(fail500.provider.search("x")).rejects.toBeInstanceOf(UpstreamError);

    const badJson = makeProvider({
      "/cloudsearch": { raw: "<html>网关错误页</html>", contentType: "text/html" },
    });
    await expect(badJson.provider.search("x")).rejects.toBeInstanceOf(UpstreamError);

    const slow = createNeteaseProvider({
      baseUrl: BASE,
      timeoutMs: 10,
      fetchImpl: ((_url: string | URL, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }) as unknown as typeof fetch,
    });
    await expect(slow.search("x")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("网易云适配器 · 内嵌库传输（v6.29 默认）", () => {
  afterEach(() => setNeteaseLib(null));

  /** createNeteaseProvider({}) = 内嵌模式：库从 setNeteaseLib 注入 */
  function makeEmbedded(lib: Record<string, unknown>) {
    setNeteaseLib(lib as never);
    return createNeteaseProvider({});
  }

  it("搜索走库的 cloudsearch 模块，映射规则与 HTTP 相同（含数字 id）", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const provider = makeEmbedded({
      cloudsearch: async (params: Record<string, unknown>) => {
        calls.push(["cloudsearch", params]);
        return {
          status: 200,
          body: {
            result: {
              songs: [{ id: 186016, name: "夜曲", fee: 8, dt: 226000, ar: [{ name: "周杰伦" }] }],
            },
          },
        };
      },
    });

    const tracks = await provider.search("夜曲");

    expect(calls[0]?.[0]).toBe("cloudsearch");
    expect(calls[0]?.[1]).toMatchObject({ keywords: "夜曲", type: 1, limit: 30 });
    expect(tracks).toEqual([
      {
        id: "186016",
        title: "夜曲",
        artist: "周杰伦",
        album: "未知专辑",
        duration: 226,
        cover: null,
        vipOnly: false,
      },
    ]);
  });

  it("直链与歌词同样走模块调用；status 非 2xx 按 UpstreamError 处理", async () => {
    const ok = makeEmbedded({
      song_url_v1: async () => ({
        status: 200,
        body: { data: [{ url: "http://m701.music.126.net/a.mp3" }] },
      }),
      lyric_new: async () => ({ status: 200, body: { lrc: { lyric: "[00:01.17]糖" } } }),
    });
    expect(await ok.getStreamUrl("186016")).toBe("https://m701.music.126.net/a.mp3");
    expect((await ok.getLyrics("186016"))?.lyrics).toBe("[00:01.17]糖");

    const err = makeEmbedded({
      song_url_v1: async () => ({ status: 502, body: { code: 502 } }),
    });
    await expect(err.getStreamUrl("1")).rejects.toMatchObject({
      name: "UpstreamError",
      status: 502,
    });
  });

  it("模块缺失归 UpstreamError（路由层回 502 说实话）", async () => {
    const missing = makeEmbedded({});
    await expect(missing.search("x")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("内嵌调用卡住时按超时收口（不把请求永远挂着）", async () => {
    setNeteaseLib({ cloudsearch: () => new Promise(() => undefined) } as never);
    const fast = createNeteaseProvider({ timeoutMs: 10 });
    await expect(fast.search("x")).rejects.toMatchObject({ name: "UpstreamError" });
  });
});

describe("网易云适配器 · 账号与收藏夹（ON-10）", () => {
  /** 注入式 transport 桩：按模块名回罐头，记录调用 */
  function makeTransport(routes: Record<string, (params: Record<string, unknown>, cookie?: string[]) => unknown>) {
    const calls: Array<{ module: string; params: Record<string, unknown>; cookie?: string[] }> = [];
    const provider = createNeteaseProvider({
      transport: async (module, params, cookie) => {
        calls.push({ module, params, cookie });
        const handler = routes[module];
        if (!handler) return { status: 404, body: {}, cookie: [] };
        const out = await handler(params, cookie);
        return { status: 200, body: out, cookie: [] };
      },
    });
    return { provider, calls };
  }

  it("扫码登录：先拿 key 再拿二维码；轮询把 801/802/800/803 归一成四种状态", async () => {
    const { provider, calls } = makeTransport({
      login_qr_key: () => ({ data: { unikey: "KEY-1" } }),
      login_qr_create: () => ({ data: { qrimg: "data:image/png;base64,xx" } }),
      login_qr_check: () => ({ code: 801 }),
    });

    expect(await provider.account!.createLogin()).toEqual({
      key: "KEY-1",
      qrDataUrl: "data:image/png;base64,xx",
    });

    const codes: Array<[number, string]> = [
      [801, "waiting"],
      [802, "scanned"],
      [800, "expired"],
    ];
    for (const [code, state] of codes) {
      calls.length = 0;
      const patch = makeTransport({ login_qr_check: () => ({ code }) });
      expect((await patch.provider.account!.checkLogin("k")).state).toBe(state);
    }

    const success = makeTransport({
      login_qr_check: () => ({ code: 803 }),
    });
    // 803 的会话在**响应的 Set-Cookie**里：这层由 transport 桩带不出来，单独用 lib 桩测（见 routes 测试）
    void success;
    expect(calls.length).toBe(0);
  });

  it("803 成功时把响应里的 Set-Cookie 作为会话带回", async () => {
    const provider = createNeteaseProvider({
      transport: async (module) => {
        if (module === "login_qr_check") return { status: 200, body: { code: 803 }, cookie: ["MUSIC_U=t", "__csrf_token=x"] };
        return { status: 404, body: {}, cookie: [] };
      },
    });
    const check = await provider.account!.checkLogin("k");
    expect(check.state).toBe("success");
    expect(check.cookie).toEqual(["MUSIC_U=t", "__csrf_token=x"]);
  });

  it("账号资料：登录有效时映射（数字 userId 转字符串、vipType>0 记为会员）；会话无效给 null", async () => {
    const ok = makeTransport({
      login_status: () => ({
        data: {
          code: 200,
          profile: {
            userId: 12345,
            nickname: "夜行客",
            avatarUrl: "https://p1.music.126.net/a.jpg",
            vipType: 11,
          },
        },
      }),
    });
    expect(await ok.provider.account!.getProfile(["MUSIC_U=t"])).toEqual({
      userId: "12345",
      nickname: "夜行客",
      avatarUrl: "https://p1.music.126.net/a.jpg",
      vip: true,
    });

    const bad = makeTransport({ login_status: () => ({ data: { code: 301 }, profile: null }) });
    expect(await bad.provider.account!.getProfile(["MUSIC_U=t"])).toBeNull();

    const nonVip = makeTransport({
      login_status: () => ({
        data: { code: 200, profile: { userId: 1, nickname: "a", vipType: 0 } },
      }),
    });
    expect((await nonVip.provider.account!.getProfile(["MUSIC_U=t"]))?.vip).toBe(false);
  });

  it("登录会话随请求进 transport（内嵌拼成 cookie 字符串），直链随之提档到 exhigh；exhigh 拿不到回落 standard", async () => {
    const cookie = ["MUSIC_U=t"];
    const { provider, calls } = makeTransport({
      song_url_v1: (params) => {
        // 第一档 exhigh 返回空 url，逼出 standard 兜底
        return { data: [{ url: params.level === "exhigh" ? null : "http://m801.music.126.net/a.mp3" }] };
      },
    });
    const url = await provider.getStreamUrl("186016", cookie);

    expect(calls.map((c) => c.params.level)).toEqual(["exhigh", "standard"]);
    expect(calls.every((c) => c.cookie === cookie)).toBe(true);
    expect(url).toBe("https://m801.music.126.net/a.mp3");
  });

  it("收藏夹：user_playlist 映射（数字 id、缺名字的行丢弃）；曲目分页拉全", async () => {
    const { provider, calls } = makeTransport({
      user_playlist: () => ({
        playlist: [
          { id: 100, name: "我喜欢的音乐", trackCount: 2, coverImgUrl: "https://p1.music.126.net/c.jpg" },
          { id: 201, name: "" },
          { name: "没有 id" },
        ],
      }),
      playlist_track_all: (params) =>
        Number(params.offset) === 0
          ? { songs: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `s${i}` })) }
          : { songs: [{ id: 186016, name: "夜曲", dt: 226000, fee: 1 }] },
    });

    const playlists = await provider.collections!.getPlaylists("77", ["MUSIC_U=t"]);
    expect(playlists).toEqual([
      { id: "100", name: "我喜欢的音乐", cover: "https://p1.music.126.net/c.jpg", trackCount: 2 },
    ]);

    const tracks = await provider.collections!.getPlaylistTracks("100", ["MUSIC_U=t"]);
    expect(tracks).toHaveLength(501);
    expect(tracks.at(-1)).toMatchObject({ id: "186016", vipOnly: true });
    expect(calls.filter((c) => c.module === "playlist_track_all").map((c) => c.params.offset)).toEqual([
      0, 500,
    ]);
  });
});
