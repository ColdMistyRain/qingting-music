import {
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  type OnlinePlaylistInfo,
  type OnlineTrack,
} from "@qingting/shared";
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
  /** 上游随响应下发的 Set-Cookie（登录扫码成功的会话就在这里） */
  cookie: string[];
}

/**
 * 传输层：给一个**模块名**（如 `cloudsearch` / `song_url_v1`）、参数与会话 Cookie，拿回回应。
 * HTTP 与内嵌两种接法都归一成这个形状，下面的映射代码对两者无感。
 * cookie 由 provider 方法按需传入（未登录为 undefined）：内嵌库吃 `k=v; k=v` 字符串，
 * HTTP 侧转成 Cookie 头 —— 两种接法都不让它进 URL。
 */
export type NeteaseTransport = (
  moduleName: string,
  params: Record<string, unknown>,
  cookie?: string[],
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

  return async (moduleName, params, cookie) => {
    if (typeof fetchImpl !== "function") {
      throw new UpstreamError("当前环境没有可用的 fetch");
    }
    const query = new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ).toString();
    const headers: Record<string, string> = {};
    // 会话 Cookie 走头、不进 URL（查询串会进日志与代理日志）
    if (cookie && cookie.length > 0) headers.Cookie = cookie.join("; ");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/${moduleName.replace(/_/g, "/")}?${query}`, {
        signal: controller.signal,
        headers,
      });
    } catch (cause) {
      throw new UpstreamError(`音源请求失败：${cause instanceof Error ? cause.message : cause}`);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new UpstreamError(`音源返回 HTTP ${res.status}`, res.status);
    }
    let setCookies: string[] = [];
    try {
      setCookies = res.headers.getSetCookie();
    } catch {
      // 老运行时没有 getSetCookie：登录流程走内嵌模式，这里不致命
    }
    try {
      return { status: res.status, body: await res.json(), cookie: setCookies };
    } catch {
      throw new UpstreamError("音源返回的不是 JSON", res.status);
    }
  };
}

/** 内嵌库：直接函数调用；没有的模块 / 非 2xx 一律按上游故障处理（与 HTTP 同一口径） */
function createEmbeddedTransport(options: { timeoutMs: number }): NeteaseTransport {
  return async (moduleName, params, cookie) => {
    const lib = loadNeteaseLib();
    const fn = lib[moduleName];
    if (typeof fn !== "function") {
      throw new UpstreamError(`内嵌网易云音源没有 ${moduleName} 这个模块`);
    }
    let result: { status: number; body: unknown; cookie?: unknown };
    try {
      result = await withTimeout(
        Promise.resolve().then(() => fn({ ...params, cookie: cookie?.join("; ") ?? "" })),
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
    return {
      status: result.status,
      body: result.body,
      cookie: Array.isArray(result.cookie)
        ? result.cookie.filter((item): item is string => typeof item === "string")
        : [],
    };
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
  /** 非空 = 网易标注**无版权 / 不可播**（typeDesc 通常是「无版权」，v6.35 补 6） */
  noCopyrightRcmd?: unknown;
}

/** 与 songs 平行的权限记录（cloudsearch 的 result.privileges）：st < 0 = 不可播 */
interface NeteasePrivilege {
  id?: unknown;
  st?: unknown;
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

/** 毫秒 → LRC 时间标签 `[mm:ss.xx]`；负起点（网易给的预备时间）夹到 0 */
function lrcTime(ms: number): string {
  const clamped = Math.max(0, ms);
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const hundredths = Math.floor((clamped % 1000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/** 单条 JSON 歌词行 → 行级 LRC 行；认不出（t 缺失 / c 为空）返回 null */
function jsonLineToLrc(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as { t?: unknown; c?: Array<{ tx?: unknown }> };
    const ms = Number(parsed.t);
    if (!Number.isFinite(ms)) return null;
    const words = Array.isArray(parsed.c)
      ? parsed.c
          .map((chunk) => (chunk && typeof chunk === "object" ? String(chunk.tx ?? "") : ""))
          .join("")
      : "";
    if (!words.trim()) return null;
    return `[${lrcTime(ms)}]${words}`;
  } catch {
    return null;
  }
}

/**
 * 网易云歌词的归一化（**逐行甄别，混合格式共存**）。
 *
 * 实测（2026-10）：yrc / lrc 字段里会出现两种行**混在同一个字段**的情况 ——
 * - credits 等行是 JSON：`{"t":<毫秒>,"c":[{"tx":"作词: "},{"tx":"周杰伦",...}]}`，
 *   块里只有文本与歌手图/链接元数据，**没有逐字时间**；
 * - 唱词行是**真·文本 yrc**：`[24810,3150](24810,630,0)这(25440,300,0)一…`（周深《起风了》实测）。
 *
 * 所以绝不能按"整段是不是 JSON"分流（那样会把唱词逐字整段丢掉），而是逐行处理：
 * JSON 行转成行级 LRC（它本来就没有逐字时间可保，v6.20 定调不做假逐字）；
 * **文本 yrc 行原样保留** —— 逐字能力完整交给客户端解析器（它能同时消费两种行）。
 */
function normalizeNeteaseLyric(text: string): string {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{")) {
      const converted = jsonLineToLrc(trimmed);
      if (converted) out.push(converted);
      continue;
    }
    // 文本 yrc / LRC / 其余行：原样保留（客户端解析器认不出的自己会跳）
    out.push(trimmed);
  }
  return out.join("\n");
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

  /** 调一个上游模块；body 归一成对象，cookie 原样带回（登录扫码要用） */
  async function call(
    moduleName: string,
    params: Record<string, unknown>,
    cookie?: string[],
  ): Promise<{ body: Record<string, unknown>; cookie: string[] }> {
    const res = await transport(moduleName, params, cookie);
    return {
      body: res.body && typeof res.body === "object" ? (res.body as Record<string, unknown>) : {},
      cookie: res.cookie,
    };
  }

  function mapSong(raw: NeteaseSearchSong, privilege?: NeteasePrivilege): OnlineTrack | null {
    const id = asId(raw.id);
    const title = asString(raw.name).trim();
    if (!id || !title) return null;
    const album = raw.al && typeof raw.al === "object" ? raw.al : undefined;
    const cover = asString(album?.picUrl).trim();
    // 无版权 / 不可播（v6.35 补 6）：网易的 noCopyrightRcmd 对象（推荐替换版），
    // 或平行 privileges 里 st < 0。两个信号任一即标；没有就带 undefined。
    const st = Number(privilege?.st);
    const unavailable =
      (raw.noCopyrightRcmd != null && typeof raw.noCopyrightRcmd === "object") ||
      (Number.isFinite(st) && st < 0) ||
      undefined;
    return {
      id,
      title,
      artist: joinArtists(raw.ar),
      album: asString(album?.name).trim() || UNKNOWN_ALBUM,
      duration: durationSeconds(raw.dt),
      cover: cover || null,
      vipOnly: isVipOnly(raw.fee),
      unavailable,
    };
  }

  return {
    id: "netease",

    async search(keyword, cookie) {
      const { body } = await call("cloudsearch", { keywords: keyword, type: 1, limit: SEARCH_LIMIT }, cookie);
      const result = body.result as
        | { songs?: NeteaseSearchSong[]; privileges?: NeteasePrivilege[] }
        | undefined;
      const songs = result?.songs ?? [];
      // privileges 与 songs 平行（按 id 对上）：st < 0 是"不可播"的第二信号
      const privileges = Array.isArray(result?.privileges) ? result!.privileges! : [];
      const privilegeById = new Map(
        privileges.map((entry) => [asId(entry.id), entry as NeteasePrivilege]),
      );
      // 单条缺 id/名字就跳过那一行，别让一条脏数据把整个搜索搞挂
      return songs
        .map((raw) => mapSong(raw, privilegeById.get(asId(raw.id))))
        .filter((track): track is OnlineTrack => track !== null);
    },

    async getStreamUrl(id, cookie) {
      const loggedIn = Boolean(cookie && cookie.length > 0);
      // 登录后提档到 exhigh（320k，VIP 会员的曲目才有完整试听）；匿名保持 standard。
      // 拿不到时（免费账号对 VIP 曲目等）再用 standard 兜底试一次。
      // randomCNIP：部分受限曲目用国内 IP 形状请求成功率更高；https=true：让上游直接给
      // https 直链（参考 Folia 的接入实践）。旧的 API 分支不认这两个参数也无妨。
      interface SongUrlItem {
        url?: unknown;
        /** 非空 = 这条直链只是**试听片段**（账号没有该曲的完整权益） */
        freeTrialInfo?: unknown;
      }
      const requestUrl = async (level: string) => {
        const { body } = await call("song_url_v1", { id, level, randomCNIP: true, https: true }, cookie);
        const data = body.data as SongUrlItem[] | undefined;
        const item = data?.[0];
        const url = asString(item?.url).trim();
        if (!url) return null;
        // 上游应答带 freeTrialInfo 时，直链只覆盖试听片段（实测 30~50 秒）——
        // 把它当"没有可用音源"处理：放一半就断比明确说"这首歌要会员"更糟
        return item && item.freeTrialInfo ? null : url;
      };
      let url = await requestUrl(loggedIn ? "exhigh" : "standard");
      if (!url && loggedIn) url = await requestUrl("standard");
      if (!url) return null;
      // 上游仍给 http:// 时（旧版服务）本地再升一次 https：HTTPS 部署下浏览器会把
      // http 直链当混合内容拦掉，而这套 CDN 的签名路径在 https 下同样有效
      return url.replace(/^http:\/\//, "https://");
    },

    async getLyrics(id, cookie) {
      // lyric_new 才带逐字 yrc 与翻译 tlyric；旧版服务没有它（404）就回落 lyric
      try {
        const { body } = await call("lyric_new", { id }, cookie);
        const yrc = body.yrc as { lyric?: unknown } | undefined;
        const lrc = body.lrc as { lyric?: unknown } | undefined;
        const tlyric = body.tlyric as { lyric?: unknown } | undefined;
        const romalrc = body.romalrc as { lyric?: unknown } | undefined;
        const text =
          normalizeNeteaseLyric(asString(yrc?.lyric).trim()) ||
          normalizeNeteaseLyric(asString(lrc?.lyric).trim());
        // 翻译（tlyric）与音译（romalrc），LRC 格式、与原文同时间轴：有正文才带
        const translation =
          normalizeNeteaseLyric(asString(tlyric?.lyric).trim()) || null;
        const roman = normalizeNeteaseLyric(asString(romalrc?.lyric).trim()) || null;
        return {
          lyrics: text || null,
          translation: text ? translation : null,
          roman: text ? roman : null,
        };
      } catch (error) {
        // 只有"这个接口不存在"才值得回落；上游真断了就让 502 说实话
        if (!(error instanceof UpstreamError && error.status === 404)) {
          throw error;
        }
      }
      const { body } = await call("lyric", { id, lv: -1, kv: -1, tv: -1, rv: -1 }, cookie);
      const lrc = body.lrc as { lyric?: unknown } | undefined;
      const tlyric = body.tlyric as { lyric?: unknown } | undefined;
      const romalrc = body.romalrc as { lyric?: unknown } | undefined;
      const text = normalizeNeteaseLyric(asString(lrc?.lyric).trim());
      const translation = normalizeNeteaseLyric(asString(tlyric?.lyric).trim());
      const roman = normalizeNeteaseLyric(asString(romalrc?.lyric).trim());
      return {
        lyrics: text || null,
        translation: text ? translation || null : null,
        roman: text ? roman || null : null,
      };
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

    /* ---------- 账号（ON-10，v6.30：扫码登录）---------- */

    account: {
      async createLogin() {
        const keyRes = await call("login_qr_key", {});
        const keyData = keyRes.body.data as { unikey?: unknown } | undefined;
        const key = asId(keyData?.unikey) || asString(keyData?.unikey).trim();
        const qrRes = await call("login_qr_create", { key, qrimg: true });
        const qrData = qrRes.body.data as { qrimg?: unknown } | undefined;
        const qrDataUrl = asString(qrData?.qrimg).trim();
        if (!key || !qrDataUrl) throw new UpstreamError("拿不到登录二维码");
        return { key, qrDataUrl };
      },

      async checkLogin(key) {
        const res = await call("login_qr_check", { key });
        // code：801 等待扫码 / 802 已扫待确认 / 803 成功（会话在响应的 Set-Cookie 里）/ 800 过期
        const code = Number(res.body.code);
        if (code === 803) return { state: "success" as const, cookie: res.cookie };
        if (code === 802) return { state: "scanned" as const, cookie: [] };
        if (code === 800) return { state: "expired" as const, cookie: [] };
        return { state: "waiting" as const, cookie: [] };
      },

      async getProfile(cookie) {
        const { body } = await call("login_status", {}, cookie);
        const data = body.data as
          | { code?: unknown; profile?: Record<string, unknown> }
          | undefined;
        if (!data || Number(data.code) !== 200 || !data.profile) return null;
        const profile = data.profile;
        const userId = asId(profile.userId) || asString(profile.userId).trim();
        const nickname = asString(profile.nickname).trim();
        if (!userId || !nickname) return null;
        // vipType > 0 = 会员（决定 VIP 曲目的行内标语义：能完整播，标「VIP」而非「试听」）
        const vipType = Number(profile.vipType);
        return {
          userId,
          nickname,
          avatarUrl: asString(profile.avatarUrl).trim() || null,
          vip: Number.isFinite(vipType) && vipType > 0,
        };
      },

      async logout(cookie) {
        // 尽力而为：让上游注销这个会话；本地的凭据由路由层负责清
        await call("logout", {}, cookie).catch(() => undefined);
      },
    },

    /* ---------- 收藏夹（登录后听自己在音源收的歌）---------- */

    collections: {
      async getPlaylists(userId, cookie) {
        const { body } = await call("user_playlist", { uid: userId, limit: 1000 }, cookie);
        const raw = body.playlist as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(raw)) return [];
        return raw
          .map((entry): OnlinePlaylistInfo | null => {
            const id = asId(entry.id) || asString(entry.id).trim();
            const name = asString(entry.name).trim();
            if (!id || !name) return null;
            return {
              id,
              name,
              cover: asString(entry.coverImgUrl).trim() || null,
              trackCount: Number(entry.trackCount) || 0,
            };
          })
          .filter((entry): entry is OnlinePlaylistInfo => entry !== null);
      },

      async getPlaylistTracks(playlistId, cookie) {
        // 分页拉全（一页 500，防特别大的收藏夹）；单曲形状与搜索结果一致，走同一个 mapSong
        const tracks: OnlineTrack[] = [];
        const PAGE = 500;
        for (let offset = 0; offset < 2000; offset += PAGE) {
          const { body } = await call(
            "playlist_track_all",
            { id: playlistId, limit: PAGE, offset },
            cookie,
          );
          const songs = body.songs as NeteaseSearchSong[] | undefined;
          const page = Array.isArray(songs) ? songs : [];
          for (const raw of page) {
            const track = mapSong(raw);
            if (track) tracks.push(track);
          }
          if (page.length < PAGE) break;
        }
        return tracks;
      },
    },
  };
}
