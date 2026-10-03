import { describe, expect, it, vi } from "vitest";
import { createNeteaseProvider } from "../src/services/online/netease.js";
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
});

describe("网易云适配器 · 歌词（ON-05）", () => {
  it("优先取逐字 yrc；没有 yrc 时退回行级 lrc", async () => {
    const withYrc = makeProvider({
      "/lyric/new": { body: { yrc: { lyric: "[1170,2900](1170,240,0)糖" }, lrc: { lyric: "[00:01.17]糖" } } },
    });
    expect(await withYrc.provider.getLyrics("1")).toBe("[1170,2900](1170,240,0)糖");

    const lineOnly = makeProvider({
      "/lyric/new": { body: { lrc: { lyric: "[00:01.17]糖" } } },
    });
    expect(await lineOnly.provider.getLyrics("1")).toBe("[00:01.17]糖");
  });

  it("旧版服务没有 /lyric/new（404）时回落 /lyric", async () => {
    const { provider, stub } = makeProvider({
      "/lyric/new": { status: 404, body: { msg: "未知接口" } },
      "/lyric": { body: { lrc: { lyric: "[00:01.17]糖" } } },
    });
    expect(await provider.getLyrics("1")).toBe("[00:01.17]糖");
    expect(stub.calls.some((path) => path.startsWith("/lyric?"))).toBe(true);
  });

  it("两边都是空歌词 → null；上游 5xx 抛 UpstreamError（不回落）", async () => {
    const blank = makeProvider({ "/lyric/new": { body: { lrc: { lyric: "" } } } });
    expect(await blank.provider.getLyrics("1")).toBeNull();

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
