import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, type OnlineTrack } from "@qingting/shared";
import { createRequire } from "node:module";
import { UpstreamError, type OnlineProvider } from "./provider.js";

/**
 * 网易云适配器（ON-02/03/05）。上游有两种接法，映射逻辑完全共用：
 *
 * 1. **内嵌库（默认，v6.29）**：直接以库形态调用 `@neteasecloudmusicapienhanced/api`
 *    （MIT，原 NeteaseCloudMusicApi 的活跃续作）—— 部署者**零配置**，`npm install` 即含音源，
 *    不用再单独起一个自部署服务。库的每个接口是一个函数
 *    `(params) => Promise<{ status, body }>`（请求层见它的 util/request.js）。
 * 2. **外接自部署服务（可选）**：配 `NETEASE_API_BASE` 指向一个已部署的
 *    NeteaseCloudMusicApi / api-enhanced HTTP 服务（签名、Cookie、匿名 token 那些事由它包掉），
 *    我们只做 "HTTP → 统一格式" 的映射。想换增强分支、想隔离版本时用这条。
 *
 * 依赖上游的哪些接口（都是匿名可用）：
 * - `cloudsearch`    搜索（比 /search 多给 `al.picUrl` 封面与 `ar[]` 歌手数组）
 * - `song_url_v1`    播放直链（`level=standard` 匿名可取；VIP/无版权返回 `url: null`）
 * - `lyric_new`      歌词（有逐字 yrc 时在 `yrc` 字段；旧版服务没有这个接口，回落 `lyric`）
 * - 封面：`https?://(p\d\.)?music\.126\.net/...`，客户端不直连（取色要 same-origin），
 *   走我们的 `/api/online/netease/cover` 转发，白名单在 `canProxyCover`。
 *
 * `fetchImpl` / `lib` 是注入点：单测用桩，不发真网络请求（PRD 11.2）。
 */

/** 上游请求超时：音源卡住时不能把我们的请求也挂着 */
const UPSTREAM_TIMEOUT_MS = 8000;
/** 单次搜索返回条数：整份当队列（与曲库页同一交互），一页 30 首够翻着听 */
const SEARCH_LIMIT = 30;

/** 上游的一手回应：status 是 HTTP 语义（内嵌库把它从 body.code 归一出来） */
export interface NeteaseUpstreamResponse {
  status: number;
  body: unknown;
}

/**
 * 传输层：给一个**模块名**（如 `cloudsearch` / `song_url_v1`）与参数，拿回回应。
 * HTTP 与内嵌两种接法都归一成这个形状，下面的映射代码对两者无感。
 */
export type NeteaseTransport = (
  moduleName: string,
  params: Record<string, unknown>,
) => Promise<NeteaseUpstreamResponse>;

/** 内嵌库的形状（只用得到这四个模块；`require` 拿到的远不止，收窄到我们用的） */
export interface NeteaseLib {
  [module: string]:
    | ((params: Record<string, unknown>) => Promise<{
        status: number;
        body: unknown;
        cookie?: unknown;
      }>)
    | undefined;
}

let cachedLib: NeteaseLib | null = null;

/** 测试注入点：塞一个桩库，内嵌模式就不会发真网络请求 */
export function setNeteaseLib(lib: NeteaseLib | null): void {
  cachedLib = lib;
}

/** 懒加载内嵌库（CJS 包在 ESM 里走 createRequire）；装坏了在调用时以 UpstreamError 暴露 */
function loadNeteaseLib(): NeteaseLib {
  if (cachedLib) return cachedLib;
  try {
    const require = createRequire(import.meta.url);
    cachedLib = require("@neteasecloudmusicapienhanced/api") as NeteaseLib;
    return cachedLib;
  } catch (cause) {
    throw new UpstreamError(`内嵌网易云音源没装好：${cause instanceof Error ? cause.message : cause}`);
  }
}

/** 外接自部署服务：模块名 → 路径（`song_url_v1` → `/song/url/v1`），参数进查询串 */
function createHttpTransport(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs: number;
}): NeteaseTransport {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs;

  return async (moduleName, params) => {
    if (typeof fetchImpl !== "function") {
      throw new UpstreamError("当前环境没有可用的 fetch");
    }
    const query = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/${moduleName.replace(/_/g, "/")}?${query}`, {
        signal: controller.signal,
      });
    } catch (cause) {
      throw new UpstreamError(`音源请求失败：${cause instanceof Error ? cause.message : cause}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new UpstreamError(`音源返回 HTTP ${res.status}`, res.status);
    }
    try {
      return { status: res.status, body: await res.json() };
    } catch {
      throw new UpstreamError("音源返回的不是 JSON", res.status);
    }
  };
}

/** 内嵌库：直接函数调用；没有的模块 / 非 2xx 一律按上游故障处理（与 HTTP 同一口径） */
function createEmbeddedTransport(options: { timeoutMs: number }): NeteaseTransport {
  return async (moduleName, params) => {
    const lib = loadNeteaseLib();
    const fn = lib[moduleName];
    if (typeof fn !== "function") {
      throw new UpstreamError(`内嵌网易云音源没有 ${moduleName} 这个模块`);
    }
    let result: { status: number; body: unknown };
    try {
      result = await withTimeout(
        Promise.resolve().then(() => fn(params)),
        options.timeoutMs,
        "内嵌网易云音源请求超时",
      );
    } catch (cause) {
      if (cause instanceof UpstreamError) throw cause;
      throw new UpstreamError(`音源请求失败：${cause instanceof Error ? cause.message : cause}`);
    }
    if (!Number.isInteger(result.status) || result.status < 200 || result.status > 299) {
      throw new UpstreamError(`音源返回 HTTP ${result.status}`, result.status);
    }
    return { status: result.status, body: result.body };
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpstreamError(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/** cloudsearch 的一条结果里我们关心的字段（其余忽略） */
interface NeteaseSearchSong {
  id?: unknown;
  name?: unknown;
  fee?: unknown;
  /** 时长（毫秒） */
  dt?: unknown;
  ar?: unknown;
  al?: { name?: unknown; picUrl?: unknown } | undefined;
}

/** 是字符串就返回它自己，否则返回兜底值 */
function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * 曲目 id：网易云的 JSON 里是**数字**（序列化后无损），但引用键 `provider:id` 要字符串。
 * 只认 string / number，别的（对象、null）算缺失。
 */
function asId(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** 歌手数组 → "A / B"；缺失时退到共享的"未知歌手" */
function joinArtists(value: unknown): string {
  if (!Array.isArray(value)) return UNKNOWN_ARTIST;
  const names = value
    .map((entry) => (entry && typeof entry === "object" ? asString((entry as { name?: unknown }).name) : ""))
    .filter((name) => name.trim());
  return names.length > 0 ? names.join(" / ") : UNKNOWN_ARTIST;
}

/** 网易云的毫秒时长 → 秒；解析不出给 null（别编 0，0 会画成"00:00"） */
function durationSeconds(dt: unknown): number | null {
  if (typeof dt !== "number" || !Number.isFinite(dt) || dt <= 0) return null;
  return Math.round(dt / 1000);
}

/** fee === 1 是网易云的"VIP 专享"标记（0/4/8 匿名多数能听，1 基本拿不到地址） */
function isVipOnly(fee: unknown): boolean {
  return fee === 1;
}

export interface NeteaseProviderOptions {
  /** 外接自部署服务的地址；不传就走内嵌库（默认） */
  baseUrl?: string;
  /** 直接注入传输层（单测用）；优先于 baseUrl / 内嵌 */
  transport?: NeteaseTransport;
  /** baseUrl 模式下的 fetch 注入点（单测用） */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createNeteaseProvider(options: NeteaseProviderOptions): OnlineProvider {
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const transport: NeteaseTransport =
    options.transport ??
    (options.baseUrl
      ? createHttpTransport({ baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, timeoutMs })
      : createEmbeddedTransport({ timeoutMs }));

  /** 调一个上游模块并把 body 归一成对象（HTTP 那条已在 transport 里解析过 JSON） */
  async function call(moduleName: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { body } = await transport(moduleName, params);
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  }

  function mapSong(raw: NeteaseSearchSong): OnlineTrack | null {
    const id = asId(raw.id);
    const title = asString(raw.name).trim();
    if (!id || !title) return null;
    const album = raw.al && typeof raw.al === "object" ? raw.al : undefined;
    const cover = asString(album?.picUrl).trim();
    return {
      id,
      title,
      artist: joinArtists(raw.ar),
      album: asString(album?.name).trim() || UNKNOWN_ALBUM,
      duration: durationSeconds(raw.dt),
      cover: cover || null,
      vipOnly: isVipOnly(raw.fee),
    };
  }

  return {
    id: "netease",

    async search(keyword) {
      const payload = await call("cloudsearch", {
        keywords: keyword,
        type: 1,
        limit: SEARCH_LIMIT,
      });
      const result = payload.result as { songs?: NeteaseSearchSong[] } | undefined;
      const songs = result?.songs ?? [];
      // 单条缺 id/名字就跳过那一行，别让一条脏数据把整个搜索搞挂
      return songs.map(mapSong).filter((track): track is OnlineTrack => track !== null);
    },

    async getStreamUrl(id) {
      // randomCNIP：部分受限曲目用国内 IP 形状请求成功率更高；https=true：让上游直接给
      // https 直链（参考 Folia 的接入实践）。旧的 API 分支不认这两个参数也无妨。
      const payload = await call("song_url_v1", { id, level: "standard", randomCNIP: true, https: true });
      const data = payload.data as Array<{ url?: unknown }> | undefined;
      const url = asString(data?.[0]?.url).trim();
      if (!url) return null;
      // 上游仍给 http:// 时（旧版服务）本地再升一次 https：HTTPS 部署下浏览器会把
      // http 直链当混合内容拦掉，而这套 CDN 的签名路径在 https 下同样有效
      return url.replace(/^http:\/\//, "https://");
    },

    async getLyrics(id) {
      // lyric_new 才带逐字 yrc；旧版服务没有它（404）就回落 lyric
      try {
        const payload = await call("lyric_new", { id });
        const yrc = payload.yrc as { lyric?: unknown } | undefined;
        const lrc = payload.lrc as { lyric?: unknown } | undefined;
        const text = asString(yrc?.lyric).trim() || asString(lrc?.lyric).trim();
        return text || null;
      } catch (error) {
        // 只有"这个接口不存在"才值得回落；上游真断了就让 502 说实话
        if (!(error instanceof UpstreamError && error.status === 404)) {
          throw error;
        }
      }
      const payload = await call("lyric", { id, lv: -1, kv: -1, tv: -1, rv: -1 });
      const lrc = payload.lrc as { lyric?: unknown } | undefined;
      const text = asString(lrc?.lyric).trim();
      return text || null;
    },

    canProxyCover(url) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return false;
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
      // 只放行网易云自家图片 CDN：p1.music.126.net / music.126.net …
      return parsed.hostname === "music.126.net" || parsed.hostname.endsWith(".music.126.net");
    },
  };
}
