import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { OnlineTrack } from "@qingting/shared";
import { UpstreamError, type OnlineProvider } from "./provider.js";

/**
 * QQ 音乐适配器（ON-06，v6.57）。
 *
 * 依赖 `@yakult-green-tea/qq-music-api`（**MIT**，Folia 同款方案的维护分支 —— 此前卡住的
 * "npm 上 qq-music-api 无 license 字段" 指的是旧包，这个分支在 README 明确 MIT 并可 npm 嵌入）。
 *
 * 嵌入形态：包根入口在 import 时就 `app.listen()`（Electron 式进程内嵌，README 明确保留）——
 * 这里以**进程内 HTTP 服务**的形态用它：设 `PORT=0`（临时端口）+ `QQ_SESSION_SECRET`
 * （登录路由需要；持久化在 `data/qq-session-secret`，重启后会话密封 token 仍可解）+
 * `LOG_LEVEL=silent`（包的逐请求日志太吵）→ require → 等 `listening` → 拿实际端口。
 * exports 的深路径被挡（只有 `.` / `./serverless` / `./mqtt`），而 serverless 入口没有
 * search/lyric 路由，所以走根入口是唯一能拿到全部目录路由的形态。
 *
 * 会话模型与网易云同款（v6.31）：微信扫码成功后 check 响应里带**密封会话 token**
 * （`qqmusic_session=...`），原样交给扫码的浏览器存 localStorage（`qt-online-session:qq`），
 * 每次请求经 `X-Online-Auth` 带回，适配器拼成包约定的 `cookie` query 传回去 —— 服务端不留副本。
 *
 * 实测边界（v6.57）：**QQ 的搜索必须带登录 Cookie**（匿名调老接口 500、新接口 500003）；
 * 歌词免登录可用；播放直链免登录基本拿不到（VIP 歌必然要登录）—— 所以 QQ 的入口是先扫码。
 */

/** 搜索结果里的一首（上游字段：client_search_cp 的 list 项） */
interface QqSong {
  songmid?: string;
  mid?: string;
  songname?: string;
  name?: string;
  title?: string;
  singer?: { name?: string }[];
  albumname?: string;
  album?: { name?: string; mid?: string };
  interval?: number;
  fee?: number;
}

/** 与 netease.ts 同一招：包是 CJS，ESM 里走 createRequire；类型只声明用到的部分 */
interface QqMusicLib {
  server: import("node:http").Server | null;
}

/** 传输缝：生产 = fetch 进程内服务；测试注入 stub（vitest 下包不监听，见 app.js isTestEnv） */
export interface QqTransport {
  get(pathname: string): Promise<unknown>;
}

/**
 * 内嵌服务的端口：从 `QQ_MUSIC_PORT`（默认 39213）起找第一个空闲的。
 * 为什么不用 listen(0)（随机端口）：包的配置校验要求 port **正整数**（zod `.positive()`），
 * 0 会被拒 —— 而它校验失败的处理是 `process.exit(1)`，会把我们整个后端带走（v6.57 实测）。
 * 预检找空闲口有一个微小的 TOCTOU 窗口，私有部署单进程下可接受。
 */
const QQ_PORT_BASE = Number(process.env.QQ_MUSIC_PORT || 39213);

function findFreePort(start: number, tries = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryOnce = (): void => {
      const probe = createServer();
      probe.once("error", () => {
        probe.close(() => undefined);
        port += 1;
        if (port - start >= tries) reject(new UpstreamError("找不到空闲端口给 QQ 音乐内嵌服务"));
        else tryOnce();
      });
      probe.once("listening", () => {
        probe.close(() => resolve(port));
      });
      probe.listen(port, "127.0.0.1");
    };
    tryOnce();
  });
}

let serviceBaseUrl: Promise<string> | null = null;

/** 会话密封密钥：登录路由需要（没有它 /login 全回 501）。生成一次、持久化在 data/ */
function sessionSecretPath(dataDir: string): string {
  return path.join(dataDir, "qq-session-secret");
}

/** 扫码登录态的落盘位置（加密信封，包自己写） */
function sessionStatePath(dataDir: string): string {
  return path.join(dataDir, "qq-auth-sessions.enc");
}

function ensureSessionSecret(dataDir: string): string {
  const file = sessionSecretPath(dataDir);
  try {
    const existing = readFileSync(file, "utf-8").trim();
    if (existing) return existing;
  } catch {
    // 还没有：下面生成
  }
  const secret = randomBytes(32).toString("hex");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

/** 起（或复用）进程内嵌的 QQ 音乐服务，解析出它的 base URL */
function ensureQqService(dataDir: string): Promise<string> {
  if (!serviceBaseUrl) {
    serviceBaseUrl = boot(dataDir).catch((error) => {
      serviceBaseUrl = null; // 失败可重试：下次调用再起一遍
      throw error;
    });
  }
  return serviceBaseUrl;
}

async function boot(dataDir: string): Promise<string> {
  // 包在 import 时读这三个环境变量；设完就恢复，避免污染进程其余部分
  const port = await findFreePort(QQ_PORT_BASE);
  const previous = {
    PORT: process.env.PORT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    QQ_SESSION_SECRET: process.env.QQ_SESSION_SECRET,
    QQ_AUTH_SESSION_PATH: process.env.QQ_AUTH_SESSION_PATH,
  };
  process.env.PORT = String(port);
  process.env.LOG_LEVEL = "silent";
  process.env.QQ_SESSION_SECRET = ensureSessionSecret(dataDir);
  // 登录态加密落盘（包在 import 时自动接，Folia 同款配置）：
  // 包默认把会话放**进程内存** —— 后端一重启全部登录失效（v6.57 实测 401 的根因）。
  // 文件走包自己的原子写 + 用会话密钥加密，owner-only 权限。
  process.env.QQ_AUTH_SESSION_PATH = sessionStatePath(dataDir);

  let lib: QqMusicLib;
  try {
    const require = createRequire(import.meta.url);
    lib = require("@yakult-green-tea/qq-music-api") as QqMusicLib;
  } finally {
    if (previous.PORT === undefined) delete process.env.PORT;
    else process.env.PORT = previous.PORT;
    if (previous.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = previous.LOG_LEVEL;
    if (previous.QQ_SESSION_SECRET === undefined) delete process.env.QQ_SESSION_SECRET;
    else process.env.QQ_SESSION_SECRET = previous.QQ_SESSION_SECRET;
    if (previous.QQ_AUTH_SESSION_PATH === undefined) delete process.env.QQ_AUTH_SESSION_PATH;
    else process.env.QQ_AUTH_SESSION_PATH = previous.QQ_AUTH_SESSION_PATH;
  }

  const server = lib.server;
  if (!server) {
    throw new UpstreamError("QQ 音乐内嵌服务没能启动（server 句柄为空）");
  }
  return new Promise<string>((resolve, reject) => {
    const onError = (error: Error): void => reject(new UpstreamError(`QQ 音乐内嵌服务启动失败：${error.message}`));
    server.once("error", onError);
    server.once("listening", () => {
      server.off("error", onError);
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function decodeMaybeBase64(value: string): string {
  const trimmed = value.trim();
  // LRC 里有 [ ] : 空格，都不在 base64 字符集里 —— 正则过了才当它是 base64
  if (!trimmed || trimmed.length % 4 !== 0 || !/^[A-Za-z0-9+/=]+$/.test(trimmed)) return value;
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
    return decoded.includes("\uFFFD") ? value : decoded; // 解出乱码就当不是 base64
  } catch {
    return value;
  }
}

/** 适配器工厂。`baseUrl` 给测试注入（vitest 下包不监听）；生产传 config 自己起内嵌服务 */
export function createQqProvider(options: { baseUrl?: string; dataDir?: string }): OnlineProvider {
  const cookieQuery = (cookie?: string[]): string =>
    cookie && cookie.length > 0 ? `&cookie=${encodeURIComponent(cookie.join("; "))}` : "";

  async function get(baseUrl: string, pathname: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${pathname}`);
    } catch (error) {
      throw new UpstreamError(`QQ 音乐服务连不上：${error instanceof Error ? error.message : String(error)}`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new UpstreamError("QQ 音乐服务回了不成形的响应", response.status);
    }
    if (!response.ok) {
      throw new UpstreamError(`QQ 音乐服务出错（${response.status}）`, response.status);
    }
    return body;
  }

  async function call(pathname: string): Promise<unknown> {
    if (options.baseUrl) return get(options.baseUrl, pathname);
    const baseUrl = await ensureQqService(options.dataDir ?? "./data");
    return get(baseUrl, pathname);
  }


  function mapSong(song: QqSong & { mid?: string; pay?: { pay_play?: number } }): OnlineTrack | null {
    // 两套字段族：搜索老接口 songmid/songname/albumname；musicu.fcg mid/name/album.{mid,name}
    const id = song.songmid ?? song.mid;
    const title = song.songname ?? song.name ?? song.title;
    if (!id || !title) return null;
    const albumMid = song.album?.mid;
    return {
      id,
      title,
      artist: (song.singer ?? []).map((s) => s.name ?? "").filter(Boolean).join(" / "),
      album: song.albumname ?? song.album?.name ?? "",
      // QQ 的 interval 本来就是秒（网易才是毫秒）
      duration: typeof song.interval === "number" && song.interval > 0 ? song.interval : null,
      cover: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : null,
      // fee=1 / pay.pay_play=1 是 VIP 专享（仅供参考，能不能播以 stream 接口为准）
      vipOnly: song.fee === 1 || song.pay?.pay_play === 1,
    };
  }

  /**
   * musicu.fcg 直调（安卓轻应用壳）：QQ 网页播放器同一条路。
   * 要点全在三处（v6.57 按 Folia 的用法核对的接口事实）：**POST**（GET 没有）、
   * `comm` 设备档案（tmeAppID=qqmusiclight 的安卓壳，缺它上游回 500003）、
   * `Cookie: tmeLoginType=-1` + okhttp UA（移动客户端身份）。不需要登录态。
   */
  async function musicuPost(
    method: string,
    module: string,
    param: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const payload = {
      comm: {
        ct: 11,
        cv: "1003006",
        v: "1003006",
        os_ver: "15",
        phonetype: "24122RKC7C",
        rom: "Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys",
        tmeAppID: "qqmusiclight",
        nettype: "NETWORK_WIFI",
        udid: "0",
        uid: "0",
      },
      request: { method, module, param },
    };
    let response: Response;
    try {
      response = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "tmeLoginType=-1;",
          "User-Agent": "okhttp/3.14.9",
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new UpstreamError(`QQ 音乐连不上：${error instanceof Error ? error.message : String(error)}`);
    }
    const body = (await response.json().catch(() => null)) as {
      code?: number;
      request?: { code?: number; data?: Record<string, unknown> };
    } | null;
    if (!body) throw new UpstreamError("QQ 音乐回了不成形的响应", response.status);
    if (body.code !== 0 || body.request?.code !== 0) {
      throw new UpstreamError(
        `QQ 音乐接口出错（code ${body.code ?? "?"}/${body.request?.code ?? "?"}）`,
        response.status,
      );
    }
    return body.request.data ?? {};
  }

  /** 免登录搜索：DoSearchForQQMusicLite（安卓轻应用版，响应在 body.item_song） */
  async function searchViaMusicu(keyword: string): Promise<OnlineTrack[]> {
    const data = await musicuPost("DoSearchForQQMusicLite", "music.search.SearchCgiService", {
      search_id: String(Math.floor(Math.random() * 1e14 + Date.now() % 86400000)),
      remoteplace: "search.android.keyboard",
      query: keyword.length > 60 ? keyword.slice(0, 60) : keyword,
      search_type: 0,
      num_per_page: 30,
      page_num: 1,
      highlight: 0,
      nqc_flag: 0,
      page_id: 1,
      grp: 1,
    });
    const body = data.body as { item_song?: QqSong[] } | undefined;
    return (body?.item_song ?? [])
      .map(mapSong)
      .filter((track): track is OnlineTrack => track !== null);
  }

  return {
    id: "qq",

    async search(keyword) {
      // 安卓轻应用壳的 musicu.fcg 搜索：**免登录可用**（匿名 GET 的老接口 500、
      // 无 comm 块的 musicu 500003 —— comm 设备档案 + POST 是缺失的两块，v6.57 实测）。
      // 搜索本身不需要登录态；VIP 曲目照常列出（播放时由 authed getMusicPlay 定可播）
      return searchViaMusicu(keyword);
    },

    async getStreamUrl(id, cookie) {
      const body = (await call(`/getMusicPlay?songmid=${encodeURIComponent(id)}${cookieQuery(cookie)}`)) as {
        data?: { playUrl?: Record<string, { url?: string; error?: string }> };
      };
      const entry = body.data?.playUrl?.[id];
      const url = typeof entry?.url === "string" ? entry.url : "";
      // 空 url / 带 error 都是"这首歌给不出地址"（VIP / 区域限制）—— 业务 null，不抛错
      return url || null;
    },

    async getLyrics(id, cookie) {
      const body = (await call(`/getLyric?songmid=${encodeURIComponent(id)}${cookieQuery(cookie)}`)) as {
        response?: { lyric?: string; trans?: string };
      };
      const raw = body.response?.lyric ?? "";
      const lyrics = raw ? decodeMaybeBase64(raw) : "";
      const trans = body.response?.trans ?? "";
      return {
        lyrics: lyrics || null,
        translation: trans ? decodeMaybeBase64(trans) || null : null,
        roman: null, // QQ 没有音译轨道（qrc 是加密的逐字稿，不在本适配器范围）
      };
    },

    canProxyCover(url: string): boolean {
      try {
        const host = new URL(url).hostname;
        return host === "y.gtimg.cn" || host.endsWith(".gtimg.cn");
      } catch {
        return false;
      }
    },

    collections: {
      async getPlaylists(_userId, cookie) {
        // 真实信封（v6.57 用真实账号核对）：{ code, playlist: [...] }，
        // 字段 tid/dirName/songNum/picUrl（bigpicUrl 是大图）
        const body = (await call(`/user/playlist?${cookieQuery(cookie).slice(1)}`)) as {
          data?: { v_playlist?: Record<string, unknown>[] };
          v_playlist?: Record<string, unknown>[];
          playlist?: Record<string, unknown>[];
        };
        const list = body.playlist ?? body.data?.v_playlist ?? body.v_playlist ?? [];
        return list.map((item) => {
          const id = String(item.tid ?? item.dissid ?? item.dirId ?? item.dirid ?? item.id ?? "");
          const name = typeof item.dirName === "string" ? item.dirName : typeof item.dissname === "string" ? item.dissname : "";
          const cover =
            typeof item.picUrl === "string"
              ? item.picUrl
              : typeof item.bigpicUrl === "string"
                ? item.bigpicUrl
                : typeof item.imgurl === "string"
                  ? item.imgurl
                  : null;
          return {
            id,
            name,
            cover,
            trackCount: Number(item.songNum ?? item.song_count ?? item.songcnt ?? 0) || 0,
          };
        });
      },

      async getPlaylistTracks(playlistId, cookie) {
        const cookieQs = cookieQuery(cookie).slice(1);
        const collected: OnlineTrack[] = [];
        // 分页拉全（包单页上限 100，more/total 告知是否还有；防御性上限 1000 首）
        for (let offset = 0; offset < 1000; offset += 100) {
          const body = (await call(
            `/user/playlist-detail?tid=${encodeURIComponent(playlistId)}&offset=${offset}&limit=100${cookieQs ? `&${cookieQs}` : ""}`,
          )) as { songs?: Record<string, unknown>[]; more?: boolean | number; total?: number };
          const songs = Array.isArray(body.songs) ? body.songs : [];
          for (const item of songs) {
            // 曲目可能裸放，也可能包在 songInfo 里（musicu 的歌单读法）
            const song = (item.songInfo ?? item.song ?? item) as QqSong & { mid?: string; pay?: { pay_play?: number } };
            const mapped = mapSong(song);
            if (mapped) collected.push(mapped);
          }
          const more = body.more === true || body.more === 1;
          if (!more || songs.length === 0) break;
        }
        return collected;
      },
    },

    account: {
      async createLogin(channel) {
        // 通道白名单（包本身支持 wechat 微信扫 / qq QQ App 扫 —— Node 宿主下 qq 走
        // MQTT 长连接，实测都能出码）；channel 会随 unikey 密封，create/check 自动跟随
        const ch = channel === "qq" ? "qq" : "wechat";
        const keyBody = (await call(`/login/qr/key?channel=${ch}`)) as { data?: { unikey?: string } };
        const key = keyBody.data?.unikey;
        if (!key) throw new UpstreamError("QQ 音乐扫码 key 没拿到");
        const qrBody = (await call(`/login/qr/create?key=${encodeURIComponent(key)}`)) as {
          data?: { qrimg?: string };
        };
        const qrimg = qrBody.data?.qrimg;
        if (!qrimg) throw new UpstreamError("QQ 音乐二维码没生成出来");
        return { key, qrDataUrl: qrimg };
      },

      async checkLogin(key) {
        const body = (await call(`/login/qr/check?key=${encodeURIComponent(key)}`)) as {
          code?: number;
          cookie?: string;
        };
        // 与网易云同一套码值：801 等待 / 802 已扫 / 803 成功 / 800 过期
        const code = body.code ?? 801;
        const state =
          code === 803 ? "success" : code === 802 ? "scanned" : code === 800 ? "expired" : "waiting";
        return {
          state,
          cookie: state === "success" && body.cookie ? [body.cookie] : [],
        };
      },

      async getProfile(cookie) {
        // 扫码成功的瞬间上游凭据可能还没就绪（/user/detail 短暂 401）：重试两次
        let raw: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const body = (await call(`/user/detail?${cookieQuery(cookie).slice(1)}`)) as {
            code?: number;
            profile?: Record<string, unknown>;
          };
          raw = (body.profile ?? null) as Record<string, unknown> | null;
          if (raw) break;
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
        if (!raw) return null;
        // 字段名（v6.57 用真实返回核对）：账号字段全在**嵌套 info** 里（包源码注释也写明
        // GetLoginUserInfo 顶层不带账号字段）；顶层只有 musicid 与凭据派的 nick/logo（常空）
        const info = (raw.info ?? null) as Record<string, unknown> | null;
        const pickString = (...values: unknown[]): string => {
          for (const value of values) {
            if (typeof value === "string" && value) return value;
          }
          return "";
        };
        const nickname = pickString(info?.nick, raw.nickname, raw.nick);
        const userId = String(raw.musicid ?? raw.str_musicid ?? "unknown");
        const avatarUrl = pickString(info?.logo, raw.avatarUrl, raw.logo) || null;
        return {
          userId,
          nickname: nickname || "QQ 音乐用户",
          avatarUrl,
          vip: raw.vip === true,
        };
      },

      async logout(cookie) {
        await call(`/logout?${cookieQuery(cookie).slice(1)}`); // 尽力而为：上游失败不中断退出
      },
    },
  };
}
