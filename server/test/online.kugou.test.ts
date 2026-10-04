import { afterEach, describe, expect, it, vi } from "vitest";
import { createKugouProvider, setKugouLib } from "../src/services/online/kugou.js";
import { UpstreamError } from "../src/services/online/provider.js";

/** 桩 fetch：按路径前缀回罐头响应，并记录请求头 */
function stubFetch(routes: Record<string, { status?: number; body?: unknown }>) {
  const impl = vi.fn(async (url: string | URL | Request) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    const route = key === undefined ? undefined : routes[key];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(route.body ?? null), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl };
}

function stubFetchAndCreate(routes: Record<string, { status?: number; body?: unknown }>) {
  const stub = stubFetch(routes);
  vi.stubGlobal("fetch", stub.impl);
  return { provider: createKugouProvider(), stub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("酷狗音乐适配器 · 匿名搜索（ON-08）", () => {
  it("走 complexsearch /v2/search/song：字段映射成统一格式", async () => {
    const { provider } = stubFetchAndCreate({
      "/v2/search/song": {
        body: {
          status: 0,
          data: {
            lists: [
              {
                hash: "B3A52A7A95",
                name: "晴天",
                SingerName: "周杰伦",
                AlbumName: "叶惠美",
                Image: "http://imge.kugou.com/stdmusic/{size}/20230317/20230317174606446996.jpg",
                Duration: 269,
              },
              {
                hash: "48C685F679",
                name: "VIP 专享",
                SingerName: "某人",
                Duration: 180,
              },
            ],
          },
        },
      },
    });

    const tracks = await provider.search("晴天");

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: "B3A52A7A95",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      duration: 269,
      cover: "http://imge.kugou.com/stdmusic/480/20230317/20230317174606446996.jpg",
    });
    expect(tracks[1]?.title).toBe("VIP 专享");
  });

  it("上游非 200 抛 UpstreamError（路由层回 502）", async () => {
    const { provider } = stubFetchAndCreate({
      "/v2/search/song": { status: 502, body: { status: 1 } },
    });
    await expect(provider.search("晴天")).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("酷狗音乐适配器 · 扫码登录（ON-08）", () => {
  /** 桩库：按模块名回罐头（包是编程式调用，直接注入模块表） */
  function stubLib(handlers: Record<string, (params: Record<string, unknown>) => unknown>) {
    const calls: { module: string; params: Record<string, unknown> }[] = [];
    setKugouLib(
      new Proxy(
        {},
        {
          get: (_target, prop) =>
            typeof prop === "string"
              ? (params: Record<string, unknown>) => {
                  calls.push({ module: prop, params });
                  const handler = handlers[prop];
                  if (!handler) throw new Error(`unexpected module: ${prop}`);
                  return Promise.resolve({ status: 200, body: handler(params) });
                }
              : undefined,
        },
      ) as never,
    );
    return { calls, provider: createKugouProvider() };
  }

  afterEach(() => {
    setKugouLib(null as never);
  });

  it("createLogin：key 接口直接给二维码 data URL", async () => {
    const { provider, calls } = stubLib({
      login_qr_key: () => ({ data: { qrcode: "abc123", qrcode_img: "data:image/png;base64,xxx" } }),
    });
    expect(await provider.account!.createLogin()).toEqual({
      key: "abc123",
      qrDataUrl: "data:image/png;base64,xxx",
    });
    expect(calls[0].module).toBe("login_qr_key");
  });

  it("checkLogin：酷狗状态码映射（0 过期 / 1 等待 / 2 待确认 / 4 成功带 token）", async () => {
    const make = (dataStatus: number, token?: string, userid?: string | number) =>
      stubLib({
        login_qr_check: () => ({ data: { status: dataStatus, token, userid } }),
      });

    expect(await make(1).provider.account!.checkLogin("k")).toEqual({ state: "waiting", cookie: [] });
    expect(await make(2).provider.account!.checkLogin("k")).toEqual({ state: "scanned", cookie: [] });
    expect(await make(0).provider.account!.checkLogin("k")).toEqual({ state: "expired", cookie: [] });
    expect(await make(4, "tok123", 777).provider.account!.checkLogin("k")).toEqual({
      state: "success",
      cookie: ["token=tok123", "userid=777"],
    });
  });

  it("getProfile：字段映射 + 空返回 null", async () => {
    const ok = stubLib({
      user_detail: () => ({ data: { userid: 910127843, nickname: "某人" } }),
    });
    expect(await ok.provider.account!.getProfile(["token=tok", "userid=910127843"])).toEqual({
      userId: "910127843",
      nickname: "某人",
      avatarUrl: null,
      vip: false,
    });

    const empty = stubLib({ user_detail: () => null });
    expect(await empty.provider.account!.getProfile(["token=tok"])).toBeNull();
  });
});

describe("酷狗音乐适配器 · 封面代理白名单", () => {
  it("只放行酷狗自家 CDN（kugou.com / kgimg.com）", () => {
    const { provider } = stubFetchAndCreate({});
    expect(provider.canProxyCover("https://imge.kugou.com/stdmusic/480/1.jpg")).toBe(true);
    expect(provider.canProxyCover("https://evil.example.com/x.jpg")).toBe(false);
  });
});
