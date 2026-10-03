import { UNKNOWN_ALBUM, UNKNOWN_ARTIST, type OnlineTrack } from "@qingting/shared";
import { UpstreamError, type OnlineProvider } from "./provider.js";

/**
 * 网易云适配器（ON-02/03/05）：对接**自部署**的 NeteaseCloudMusicApi。
 *
 * 为什么走自部署服务而不是直连网易云网页接口：PRD 5.1 选型表定的是
 * "后端透传代理：网易云（NeteaseCloudMusicApi / api-enhanced）"——
 * 签名、Cookie、匿名 token 那些事都由那个服务包掉，我们只做"HTTP → 统一格式"的映射。
 *
 * 依赖自部署服务的哪些接口（都是匿名可用）：
 * - `GET /cloudsearch`   搜索（比 /search 多给 `al.picUrl` 封面与 `ar[]` 歌手数组）
 * - `GET /song/url/v1`   播放直链（`level=standard` 匿名可取；VIP/无版权返回 `url: null`）
 * - `GET /lyric/new`     歌词（有逐字 yrc 时在 `yrc` 字段；旧版服务没有这个接口，回落 `/lyric`）
 * - 封面：`https?://(p\d\.)?music\.126\.net/...`，客户端不直连（取色要 same-origin），
 *   走我们的 `/api/online/netease/cover` 转发，白名单在 `canProxyCover`。
 *
 * `fetchImpl` 是注入点：单测用桩函数，不发真网络请求（PRD 11.2）。
 */

/** 上游请求超时：音源卡住时不能把我们的请求也挂着 */
const UPSTREAM_TIMEOUT_MS = 8000;
/** 单次搜索返回条数：整份当队列（与曲库页同一交互），一页 30 首够翻着听 */
const SEARCH_LIMIT = 30;

export interface NeteaseProviderOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
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

export function createNeteaseProvider(options: NeteaseProviderOptions): OnlineProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;

  /** 请求上游并解析 JSON；网络错 / 超时 / 非 2xx / 非 JSON 一律抛 UpstreamError */
  async function requestJson<T>(path: string): Promise<T> {
    if (typeof fetchImpl !== "function") {
      throw new UpstreamError("当前环境没有可用的 fetch");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { signal: controller.signal });
    } catch (cause) {
      throw new UpstreamError(`音源请求失败：${cause instanceof Error ? cause.message : cause}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new UpstreamError(`音源返回 HTTP ${res.status}`);
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new UpstreamError("音源返回的不是 JSON");
    }
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
      const payload = await requestJson<{
        result?: { songs?: NeteaseSearchSong[] } | undefined;
      }>(`/cloudsearch?keywords=${encodeURIComponent(keyword)}&type=1&limit=${SEARCH_LIMIT}`);
      const songs = payload.result?.songs ?? [];
      // 单条缺 id/名字就跳过那一行，别让一条脏数据把整个搜索搞挂
      return songs.map(mapSong).filter((track): track is OnlineTrack => track !== null);
    },

    async getStreamUrl(id) {
      // randomCNIP：部分受限曲目用国内 IP 形状请求成功率更高；https=true：让上游直接给
      // https 直链（参考 Folia 的接入实践）。旧的 API 分支不认这两个参数也无妨。
      const payload = await requestJson<{ data?: Array<{ url?: unknown }> | undefined }>(
        `/song/url/v1?id=${encodeURIComponent(id)}&level=standard&randomCNIP=true&https=true`,
      );
      const url = asString(payload.data?.[0]?.url).trim();
      if (!url) return null;
      // 上游仍给 http:// 时（旧版服务）本地再升一次 https：HTTPS 部署下浏览器会把
      // http 直链当混合内容拦掉，而这套 CDN 的签名路径在 https 下同样有效
      return url.replace(/^http:\/\//, "https://");
    },

    async getLyrics(id) {
      // /lyric/new 才带逐字 yrc（v6.25 留白清单里"待定"的 TTML 不在此列）；旧版服务没有它
      try {
        const payload = await requestJson<{ yrc?: { lyric?: unknown }; lrc?: { lyric?: unknown } }>(
          `/lyric/new?id=${encodeURIComponent(id)}`,
        );
        const text = asString(payload.yrc?.lyric).trim() || asString(payload.lrc?.lyric).trim();
        return text || null;
      } catch (error) {
        // 只有"这个接口不存在"才值得回落；上游真断了就让 502 说实话
        if (!(error instanceof UpstreamError && error.message.includes("HTTP 404"))) {
          throw error;
        }
      }
      const payload = await requestJson<{ lrc?: { lyric?: unknown } }>(
        `/lyric?id=${encodeURIComponent(id)}&lv=-1&kv=-1&tv=-1&rv=-1`,
      );
      const text = asString(payload.lrc?.lyric).trim();
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
