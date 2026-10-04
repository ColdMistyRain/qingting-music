import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { OnlinePlaylistInfo, OnlineTrack } from "@qingting/shared";
import { UpstreamError, type OnlineProvider } from "./provider.js";

/**
 * 酷狗音乐适配器（ON-08，v6.59）。
 *
 * 依赖 `kugoumusicapi`（MakcRe/KuGouMusicApi v1.6.0，**MIT**；Folia 同款包）。
 * 与 QQ 包不同，它有**编程式调用入口**（main.js 导出模块函数，不起 HTTP 服务）——
 * 直接 `api.search(params)` 这种形状，嵌入面更干净。
 *
 * 能力分层（实测）：
 * - **匿名搜索可用**：包的 search 模块走 AndroidFilter 加密要登录会话，匿名报
 *   Parameter Error —— 匿名搜索用自有实现（complexsearch.kugou.com /v2/search/song，
 *   参数签名 = md5(盐 + 排序参数 + 盐)，盐与请求头为该接口的公开事实）。
 * - **播放直链 / 歌词 / 歌单要登录**（accesskey 体系）：扫码成功后 check 给
 *   `token` / `userid` 两个 Cookie，authed 调用把这对值作为 cookie 对象传给包。
 * - 登录走**酷狗 App 扫码**（login_qr_key 一步直接给二维码 data URL，比 QQ 还省）。
 *
 * 会话模型与网易云/QQ 同槽（v6.31）：密封凭据只存扫码的浏览器（localStorage
 * `qt-online-session:kugou`），每次请求经 `X-Online-Auth` 带回，服务端不落盘。
 */

const SIGN_SALT = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA";

const md5 = (value: string): string => createHash("md5").update(value, "utf8").digest("hex");

/** 匿名搜索返回的一首（字段族与包的映射目标一致） */
interface KgSong {
  hash?: string;
  FileHash?: string;
  name?: string;
  SongName?: string;
  singer?: { name?: string }[];
  SingerName?: string;
  album_name?: string;
  AlbumName?: string;
  album_id?: string | number;
  AlbumID?: string | number;
  duration?: number;
  Duration?: number;
  cover?: string;
}

/** 包编程式调用返回的信封（status/body） */
interface KgEnvelope<T = Record<string, unknown>> {
  status?: number;
  body?: T;
}

/** cookie 数组（`token=xxx`）→ 包 authed 调用要的对象 */
function cookieObject(cookie?: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const entry of cookie ?? []) {
    const at = entry.indexOf("=");
    if (at > 0) obj[entry.slice(0, at).trim()] = entry.slice(at + 1).trim();
  }
  return obj;
}

/** 测试缝：注入桩库替代真包（包用 axios，vi.stubGlobal 拦不住） */
let libOverride: Record<string, (params: Record<string, unknown>) => Promise<KgEnvelope>> | null = null;
export function setKugouLib(
  mock: Record<string, (params: Record<string, unknown>) => Promise<KgEnvelope>>,
): void {
  libOverride = mock;
}

export function createKugouProvider(): OnlineProvider {
  const lib = libOverride ?? requireKugouLib();

  function requireKugouLib(): Record<string, (params: Record<string, unknown>) => Promise<KgEnvelope>> {
    try {
      const require = createRequire(import.meta.url);
      return require("kugoumusicapi") as unknown as Record<
        string,
        (params: Record<string, unknown>) => Promise<KgEnvelope>
      >;
    } catch (error) {
      throw new UpstreamError(`酷狗音乐库加载失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function callModule(name: string, params: Record<string, unknown>): Promise<KgEnvelope> {
    const fn = lib[name];
    if (typeof fn !== "function") throw new UpstreamError(`酷狗音乐接口不存在：${name}`);
    try {
      return (await fn(params)) as KgEnvelope;
    } catch (error) {
      // 包把上游业务错（含 502/400）以对象形式抛出：归一成 UpstreamError
      throw new UpstreamError(
        `酷狗音乐接口出错：${JSON.stringify(error).slice(0, 200)}`,
        (error as { status?: number }).status,
      );
    }
  }

  function mapSong(song: KgSong): OnlineTrack | null {
    const id = song.hash ?? song.FileHash;
    const title = song.name ?? song.SongName;
    if (!id || !title) return null;
    const albumId = song.album_id ?? song.AlbumID;
    return {
      id,
      title,
      artist: song.singer
        ? song.singer.map((s) => s.name ?? "").filter(Boolean).join(" / ")
        : (song.SingerName ?? ""),
      album: song.album_name ?? song.AlbumName ?? "",
      // 酷狗的 duration 本来就是秒
      duration:
        typeof song.duration === "number" && song.duration > 0
          ? song.duration
          : typeof song.Duration === "number" && song.Duration > 0
            ? song.Duration
            : null,
      cover: song.cover ?? (albumId ? `https://imge.kugou.com/stdmusic/480/${albumId}.jpg` : null),
      vipOnly: false, // 酷狗的付费标记来自 authed privilege（未登录搜索拿不到，播放时由直链结果说话）
    };
  }

  /** 匿名搜索（自有实现）：complexsearch /v2/search/song，参数签名 = md5(盐 + 排序参数 + 盐) */
  async function anonymousSearch(keyword: string, pagesize: number): Promise<KgSong[]> {
    const clientTimeMs = Date.now();
    const params: Record<string, string | number> = {
      sorttype: "0",
      keyword,
      pagesize,
      page: 1,
      userid: "0",
      appid: "3116",
      token: "",
      clienttime: Math.floor(clientTimeMs / 1000),
      iscorrection: "1",
      uuid: "-",
      mid: md5(String(clientTimeMs)),
      dfid: "-",
      clientver: "11070",
      platform: "AndroidFilter",
    };
    const signatureSource = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("");
    params.signature = md5(`${SIGN_SALT}${signatureSource}${SIGN_SALT}`);
    const url = new URL("http://complexsearch.kugou.com/v2/search/song");
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          "User-Agent": "Android14-1070-11070-201-0-SearchSong-wifi",
          "KG-Rec": "1",
          "KG-RC": "1",
          "KG-CLIENTTIMEMS": String(clientTimeMs),
          mid: String(params.mid),
          "x-router": "complexsearch.kugou.com",
        },
      });
    } catch (error) {
      throw new UpstreamError(`酷狗音乐搜索连不上：${error instanceof Error ? error.message : String(error)}`);
    }
    const body = (await response.json().catch(() => null)) as {
      data?: { lists?: KgSong[] };
    } | null;
    if (!response.ok || !body) throw new UpstreamError("酷狗音乐搜索回了不成形的响应", response.status);
    return body.data?.lists ?? [];
  }

  return {
    id: "kugou",

    async search(keyword) {
      const songs = await anonymousSearch(keyword, 30);
      return songs.map(mapSong).filter((track): track is OnlineTrack => track !== null);
    },

    async getStreamUrl(id, cookie) {
      const body = await callModule("song_url", {
        hash: id,
        cookie: cookieObject(cookie),
      });
      const data = (body.body?.data ?? body.body ?? null) as
        | { url?: string[]; backupUrl?: string[]; status?: number }
        | null;
      void 0;
      const url = data?.url?.[0] ?? data?.backupUrl?.[0] ?? "";
      // 空 url = 这首歌给不出地址（VIP / 区域限制）—— 业务 null，不抛错
      return url || null;
    },

    async getLyrics(id, cookie) {
      const body = await callModule("lyric", {
        id,
        fmt: "lrc",
        decode: true,
        cookie: cookieObject(cookie),
      });
      const rawBody = body.body as { candidates?: unknown[] } | Record<string, unknown> | null;
      const candidates = (rawBody as { candidates?: unknown[] })?.candidates;
      const first = Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : null;
      const inner = (first ?? rawBody ?? null) as {
        content?: string;
        decodeContent?: string;
      } | null;
      const lyrics = inner?.decodeContent ?? inner?.content ?? "";
      return { lyrics: lyrics || null, translation: null, roman: null };
    },

    canProxyCover(url: string): boolean {
      try {
        const host = new URL(url).hostname;
        return host.endsWith(".kugou.com") || host.endsWith(".kgimg.com");
      } catch {
        return false;
      }
    },

    account: {
      /** 酷狗 App 扫码：login_qr_key 一步直接给二维码 data URL */
      async createLogin() {
        const body = await callModule("login_qr_key", {});
        const data = (body.body?.data ?? null) as { qrcode?: string; qrcode_img?: string } | null;
        const key = data?.qrcode;
        const qrDataUrl = data?.qrcode_img;
        if (!key || !qrDataUrl) throw new UpstreamError("酷狗音乐二维码没生成出来");
        return { key, qrDataUrl };
      },

      async checkLogin(key) {
        const body = await callModule("login_qr_check", { key });
        const inner = (body.body ?? body) as { status?: number; data?: { status?: number; token?: string; userid?: string | number } };
        // 状态码（包注释）：0 过期 / 1 等待 / 2 待确认 / 4 成功（带 token+userid）
        const code = inner?.data?.status ?? inner?.status ?? 1;
        const state =
          code === 4 ? "success" : code === 2 ? "scanned" : code === 0 ? "expired" : "waiting";
        const cookies: string[] = [];
        if (state === "success" && inner?.data?.token) {
          cookies.push(`token=${inner.data.token}`);
          if (inner.data.userid !== undefined) cookies.push(`userid=${inner.data.userid}`);
        }
        return { state, cookie: cookies };
      },

      async getProfile(cookie) {
        const body = await callModule("user_detail", { cookie: cookieObject(cookie) });
        const data = (body.body?.data ?? body.body ?? null) as Record<string, unknown> | null;
        if (!data) return null;
        // 真实字段（v6.59 实测）：nickname/pic（头像）/vip_type（0=非会员）；
        // 会员状态另有 get_union_vip 的 data.is_vip 更权威（v6.59 补 2），失败静默降级
        const nickname = typeof data.nickname === "string" ? data.nickname : "";
        const userId = String(data.userid ?? "");
        if (!nickname && !userId) return null;
        let vip = Number(data.vip_type ?? 0) !== 0;
        try {
          const vipBody = await callModule("user_vip_detail", { cookie: cookieObject(cookie) });
          const vipData = vipBody.body?.data as { is_vip?: number } | undefined;
          if (vipData && typeof vipData.is_vip === "number") vip = vipData.is_vip !== 0;
        } catch {
          // 查不到会员位就按 vip_type 兜底
        }
        return {
          userId: userId || "unknown",
          nickname: nickname || "酷狗音乐用户",
          avatarUrl: typeof data.pic === "string" ? data.pic : null,
          vip,
        };
      },

      async logout(cookie) {
        await callModule("logout", { cookie: cookieObject(cookie) }); // 尽力而为
      },
    },

    collections: {
      async getPlaylists(_userId, cookie) {
        // 分页拉全（pagesize 上限 100，防御性 20 页）
        const collected: OnlinePlaylistInfo[] = [];
        const cookieObj = cookieObject(cookie);
        for (let page = 1; page <= 20; page++) {
          const body = await callModule("user_playlist", { cookie: cookieObj, page, pagesize: 100 });
          const inner = (body.body?.data ?? body.body ?? null) as
            | { info?: Record<string, unknown>[]; count?: number }
            | null;
            const list = Array.isArray(inner?.info) ? inner.info : [];
          for (const item of list) {
            // 真实字段（v6.59 实测）：global_collection_id/name/pic/m_count
            const id = String(item.global_collection_id ?? item.gmid ?? item.listid ?? item.id ?? "");
            if (!id) continue;
            collected.push({
              id,
              name: typeof item.name === "string" ? item.name : "",
              cover: typeof item.pic === "string" ? item.pic : null,
              trackCount: Number(item.m_count ?? item.count ?? 0) || 0,
            });
          }
          const total = Number(inner?.count ?? 0);
          if (collected.length >= total || list.length === 0) break;
        }
        return collected;
      },

      async getPlaylistTracks(playlistId, cookie) {
        // 真实信封（v6.59 实测）：data.songs[]，字段 hash/name（name 是「歌手 - 歌名」
        // 的拼接展示格式）/album_id；分页字段 count + pagesize，按 count 拉全（防御上限）
        const collected: OnlineTrack[] = [];
        const cookieObj = cookieObject(cookie);
        const pagesize = 100;
        for (let beginIdx = 0; beginIdx < 1000; beginIdx += pagesize) {
          const body = await callModule("playlist_track_all", {
            id: playlistId,
            pagesize,
            cookie: cookieObj,
          });
          const data = (body.body?.data ?? null) as
            | { songs?: Record<string, unknown>[]; count?: number }
            | null;
          const songs = Array.isArray(data?.songs) ? data.songs : [];
          for (const item of songs) {
            const hash = typeof item.hash === "string" ? item.hash : "";
            // name 是「歌手 - 歌名」拼接格式：拆出歌手与歌名（没有 " - " 就整条当歌名）
            const rawName = typeof item.name === "string" ? item.name : "";
            const sep = rawName.indexOf(" - ");
            const artist = sep > 0 ? rawName.slice(0, sep) : "";
            const title = sep > 0 ? rawName.slice(sep + 3) : rawName;
            if (!hash || !title) continue;
            const albumId = typeof item.album_id === "string" || typeof item.album_id === "number" ? String(item.album_id) : "";
            collected.push({
              id: hash,
              title,
              artist,
              album: "",
              duration: null,
              cover: albumId ? `https://imge.kugou.com/stdmusic/480/${albumId}.jpg` : null,
              vipOnly: false,
            });
          }
          const total = Number(data?.count ?? 0);
          if (songs.length < pagesize || collected.length >= total || total === 0) break;
        }
        return collected;
      },
    },
  };
}
