import { afterEach, describe, expect, it, vi } from "vitest";
import { createQqProvider } from "../src/services/online/qq.js";
import { UpstreamError } from "../src/services/online/provider.js";

/** 桩 fetch：记录请求，按路径前缀回罐头响应（与 online.netease.test.ts 同一套） */
function stubFetch(
  routes: Record<string, { status?: number; body?: unknown; raw?: string }>,
) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    calls.push(path);
    const route = key === undefined ? undefined : routes[key];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body ?? null), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const BASE = "http://qq-service.test";

function makeProvider(
  routes: Record<string, { status?: number; body?: unknown }>,
) {
  const stub = stubFetch(routes);
  vi.stubGlobal("fetch", stub.impl);
  return { provider: createQqProvider({ baseUrl: BASE }), stub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QQ 音乐适配器 · 搜索（ON-06）", () => {
  it("把 client_search_cp 的字段映射成统一格式：interval 已是秒、fee===1 记为 VIP、albummid 拼封面", async () => {
    const { provider, stub } = makeProvider({
      "/getSearchByKey": {
        body: {
          code: 0,
          data: {
            list: [
              {
                songmid: "0039MnYb0qxYhV",
                songname: "晴天",
                singer: [{ name: "周杰伦" }],
                albumname: "叶惠美",
                album: { mid: "003DFRz92u3Scd" },
                interval: 269,
                fee: 0,
              },
              {
                songmid: "002bSWW92aov3m",
                songname: "VIP 专享",
                singer: [{ name: "某人" }, { name: "另一人" }],
                albumname: "",
                interval: 180,
                fee: 1,
              },
            ],
          },
        },
      },
    });

    const tracks = await provider.search("晴天");

    expect(stub.calls[0]).toBe(
      "/getSearchByKey?key=" + encodeURIComponent("晴天") + "&limit=30&page=1",
    );
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: "0039MnYb0qxYhV",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      duration: 269,
      cover: "https://y.gtimg.cn/music/photo_new/T002R500x500M000003DFRz92u3Scd.jpg",
      vipOnly: false,
    });
    expect(tracks[1]?.vipOnly).toBe(true);
    expect(tracks[1]?.artist).toBe("某人 / 另一人");
  });

  it("登录会话经 cookie query 传回（QQ 搜索必须带登录态，v6.57 实测）", async () => {
    const { provider, stub } = makeProvider({
      "/getSearchByKey": { body: { code: 0, data: { list: [] } } },
    });
    await provider.search("晴天", ["qqmusic_session=sealed-token; uin=o123"]);
    expect(stub.calls[0]).toContain(
      "&cookie=" + encodeURIComponent("qqmusic_session=sealed-token; uin=o123"),
    );
  });

  it("嵌套形状也接得住（data.body.song.list）", async () => {
    const { provider } = makeProvider({
      "/getSearchByKey": {
        body: { code: 0, data: { body: { song: { list: [{ songmid: "m1", songname: "歌", interval: 10 }] } } } },
      },
    });
    const tracks = await provider.search("歌");
    expect(tracks).toHaveLength(1);
    expect(tracks[0]?.id).toBe("m1");
  });
});

describe("QQ 音乐适配器 · 播放直链（ON-03）", () => {
  it("playUrl 里那条 songmid 的 url 原样带回", async () => {
    const { provider } = makeProvider({
      "/getMusicPlay": {
        body: {
          data: { playUrl: { "0039MnYb0qxYhV": { url: "https://isure.stream.qqmusic.qq.com/M500xxx.mp3" } } },
        },
      },
    });
    expect(await provider.getStreamUrl("0039MnYb0qxYhV")).toBe(
      "https://isure.stream.qqmusic.qq.com/M500xxx.mp3",
    );
  });

  it("空 url / 带 error（VIP 没拿到直链）→ 业务 null，不抛错", async () => {
    const { provider } = makeProvider({
      "/getMusicPlay": {
        body: { data: { playUrl: { "0039MnYb0qxYhV": { url: "", error: "暂无播放链接" } } } },
      },
    });
    expect(await provider.getStreamUrl("0039MnYb0qxYhV")).toBeNull();
  });

  it("playUrl 里根本没有这条 songmid → null", async () => {
    const { provider } = makeProvider({
      "/getMusicPlay": { body: { data: { playUrl: {} } } },
    });
    expect(await provider.getStreamUrl("nope")).toBeNull();
  });
});

describe("QQ 音乐适配器 · 歌词（ON-05）", () => {
  it("明文 LRC 原样带回；翻译 trans 解码；roman 恒为 null", async () => {
    const lyric = "[ti:晴天]\n[00:00.00]晴天 - 周杰伦";
    const { provider } = makeProvider({
      "/getLyric": { body: { response: { lyric, trans: "[00:00.00]sunny" } } },
    });
    expect(await provider.getLyrics("0039MnYb0qxYhV")).toEqual({
      lyrics: lyric,
      translation: "[00:00.00]sunny",
      roman: null,
    });
  });

  it("base64 编码的歌词解码（上游旧接口是 base64）", async () => {
    const b64 = Buffer.from("[00:01.00]解码后的歌词", "utf-8").toString("base64");
    const { provider } = makeProvider({
      "/getLyric": { body: { response: { lyric: b64 } } },
    });
    expect((await provider.getLyrics("m1")).lyrics).toBe("[00:01.00]解码后的歌词");
  });

  it("没有歌词 → lyrics null（不造空串）", async () => {
    const { provider } = makeProvider({
      "/getLyric": { body: { response: {} } },
    });
    expect(await provider.getLyrics("m1")).toEqual({ lyrics: null, translation: null, roman: null });
  });
});

describe("QQ 音乐适配器 · 封面代理白名单", () => {
  it("只放行 QQ 自家 CDN（gtimg.cn）", () => {
    const { provider } = makeProvider({});
    expect(provider.canProxyCover("https://y.gtimg.cn/music/photo_new/x.jpg")).toBe(true);
    expect(provider.canProxyCover("https://evil.example.com/x.jpg")).toBe(false);
    expect(provider.canProxyCover("not a url")).toBe(false);
  });
});

describe("QQ 音乐适配器 · 账号（微信扫码，ON-06）", () => {
  it("createLogin：key + 二维码 data URL", async () => {
    const { provider } = makeProvider({
      "/login/qr/key": { body: { code: 200, data: { unikey: "abc123" } } },
      "/login/qr/create": { body: { code: 200, data: { qrimg: "data:image/png;base64,xxxx" } } },
    });
    expect(await provider.account!.createLogin()).toEqual({
      key: "abc123",
      qrDataUrl: "data:image/png;base64,xxxx",
    });
  });

  it("checkLogin：码值映射（801 等待 / 802 已扫 / 803 成功带会话 / 800 过期）", async () => {
    const make = (body: { code?: number; cookie?: string }) =>
      makeProvider({ "/login/qr/check": { body } }).provider;

    expect(await make({ code: 801 }).account!.checkLogin("k")).toEqual({ state: "waiting", cookie: [] });
    expect(await make({ code: 802 }).account!.checkLogin("k")).toEqual({ state: "scanned", cookie: [] });
    expect(await make({ code: 800 }).account!.checkLogin("k")).toEqual({ state: "expired", cookie: [] });
    expect(await make({ code: 803, cookie: "qqmusic_session=sealed; uin=o1" }).account!.checkLogin("k")).toEqual({
      state: "success",
      cookie: ["qqmusic_session=sealed; uin=o1"],
    });
  });

  it("getProfile：字段映射 + 形状不对返回 null", async () => {
    const ok = makeProvider({
      "/user/detail": { body: { data: { uin: 123, nickname: "某人", faceurl: "https://x.test/a.jpg", is_vip: 1 } } },
    }).provider;
    expect(await ok.account!.getProfile(["qqmusic_session=s"])).toEqual({
      userId: "123",
      nickname: "某人",
      avatarUrl: "https://x.test/a.jpg",
      vip: true,
    });

    const empty = makeProvider({ "/user/detail": { body: {} } }).provider;
    expect(await empty.account!.getProfile(["qqmusic_session=s"])).toBeNull();
  });

  it("上游 5xx → UpstreamError（路由层回 502）", async () => {
    const { provider } = makeProvider({
      "/getSearchByKey": { status: 500, body: { error: "boom" } },
    });
    await expect(provider.search("晴天")).rejects.toBeInstanceOf(UpstreamError);
  });
});
