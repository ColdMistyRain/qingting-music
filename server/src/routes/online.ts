import { Router } from "express";
import type { AppConfig } from "../config.js";
import { asyncHandler, sendFail, sendOk } from "../http.js";
import { requireAccess } from "../middleware/auth.js";
import { UpstreamError, resolveProvider } from "../services/online/provider.js";

/**
 * 在线音源（PRD 3.5 / 5.6：`GET /api/online/:provider/...`）。
 *
 *   GET    /api/online/:provider/search?keywords=   搜索（ON-02），统一格式 OnlineTrack[]
 *   GET    /api/online/:provider/stream?id=         播放直链（ON-03），{ url }；null = 无可用音源
 *   GET    /api/online/:provider/lyrics?id=         歌词原文（ON-05），{ lyrics }；null = 没有
 *   GET    /api/online/:provider/cover?url=         封面代理（VS-02 取色要 same-origin；白名单见适配器）
 *   POST   /api/online/:provider/login/qr           生成扫码登录二维码（ON-10）
 *   GET    /api/online/:provider/login/check?key=   轮询扫码状态；成功时把会话**原样交给扫码的浏览器**
 *   GET    /api/online/:provider/login              校验请求头带来的会话是否仍有效
 *   DELETE /api/online/:provider/login              退出（让上游注销这个会话）
 *   GET    /api/online/:provider/collections        账号在音源里的歌单（收藏夹）
 *   GET    /api/online/:provider/collections/:id    一份歌单的全部曲目
 *
 * **会话模型（v6.31，需求方定）**：音源登录 Cookie 存在**各浏览器自己的 localStorage** 里
 * （普通网站的形态），随请求经 `X-Online-Auth` 头带上，服务端**不落盘、不跨浏览器共享** ——
 * 否则两个人先后扫码，后扫的会覆盖先扫的，账号就串了（服务端单槽是这个模型的硬伤）。
 * 代价与边界（已向需求方说明）：换浏览器/清浏览器数据要重新扫码；Cookie 对页面 JS 可读
 * （自部署、无第三方脚本，与普通网站同一信任模型）。
 *
 * 权限：AC-03 把"在线音源搜索播放"归**访客级**，全部 `visitor`。
 *
 * 播放地址为什么给 JSON 而不 302 重定向：前端要在"没有地址"（VIP / 无版权）时给出明确提示
 * 并把这首歌标记为不可播，JSON 的 `url: null` 一眼可判；音频本体由浏览器**直连**音源 CDN
 * （PRD 3.5 时序图），不占我们后端的带宽。
 *
 * 封面为什么要代理：封面要进 canvas 取色（VS-02），跨域图会把画布污染掉——
 * 代理后它与站点同源，取色管线一行不用改。这也是它必须带白名单的原因：
 * 这是一个"服务端替人发请求"的口子，只转发音源自家 CDN 上的图（`canProxyCover`）。
 */

/** 曲目 id 只认这种形状：网易云是纯数字，将来别的音源也是有限字符集；顺手挡掉路径/查询注入 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 搜索关键词：非空、长度收敛（再长的关键词只会浪费上游） */
function readKeyword(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, 100) : "";
}

/**
 * 从请求头取回浏览器存的会话。前端把 Cookie 数组用 "; " 连接后放进 `X-Online-Auth`；
 * 这里拆回数组（去掉空段），没有/为空就是未登录。
 */
function readSession(req: { get(name: string): string | undefined }): string[] {
  const raw = req.get("X-Online-Auth") ?? "";
  return raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 封面代理的上游超时：图片小，8 秒足够 */
const COVER_TIMEOUT_MS = 8000;
/** 封面缓存一天：与 /covers 同一档（封面基本不变，改了也有 CDN 过期兜底） */
const COVER_CACHE_CONTROL = "public, max-age=86400";

/** 封面是 <img> 的 src，带不了自定义头 —— 封面是公开 CDN 资源，不需要会话，天然不受影响 */
export function createOnlineRouter(config: AppConfig): Router {
  const router = Router();

  router.get(
    "/:provider/search",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider) {
        sendFail(res, 404, "没有这个音源（或未配置它的服务地址）");
        return;
      }
      const keyword = readKeyword(req.query.keywords);
      if (!keyword) {
        sendFail(res, 400, "关键词不能为空");
        return;
      }
      const session = readSession(req);
      try {
        const tracks = await provider.search(keyword, session.length > 0 ? session : undefined);
        sendOk(res, { provider: provider.id, keyword, tracks });
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/:provider/stream",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider) {
        sendFail(res, 404, "没有这个音源（或未配置它的服务地址）");
        return;
      }
      const id = String(req.query.id ?? "");
      if (!ID_PATTERN.test(id)) {
        sendFail(res, 400, "曲目 id 不合法");
        return;
      }
      const session = readSession(req);
      try {
        // url 为 null 是**业务结果**（VIP / 无版权 / 试听片段，ON-03）：200 + null，让前端据此刻提示
        sendOk(res, { url: await provider.getStreamUrl(id, session.length > 0 ? session : undefined) });
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/:provider/lyrics",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider) {
        sendFail(res, 404, "没有这个音源（或未配置它的服务地址）");
        return;
      }
      const id = String(req.query.id ?? "");
      if (!ID_PATTERN.test(id)) {
        sendFail(res, 400, "曲目 id 不合法");
        return;
      }
      const session = readSession(req);
      try {
        const { lyrics, translation, roman } = await provider.getLyrics(
          id,
          session.length > 0 ? session : undefined,
        );
        sendOk(res, { lyrics, translation, roman });
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  /* ---------- 账号（ON-10：扫码登录；会话归浏览器，服务端无状态）---------- */

  router.post(
    "/:provider/login/qr",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider?.account) {
        sendFail(res, 404, "这个音源不支持账号登录");
        return;
      }
      try {
        sendOk(res, await provider.account.createLogin());
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/:provider/login/check",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider?.account) {
        sendFail(res, 404, "这个音源不支持账号登录");
        return;
      }
      const key = String(req.query.key ?? "");
      if (!key) {
        sendFail(res, 400, "缺少轮询 key");
        return;
      }
      try {
        const check = await provider.account.checkLogin(key);
        if (check.state !== "success" || check.cookie.length === 0) {
          sendOk(res, { state: check.state, cookie: [], profile: null });
          return;
        }
        // 成功：会话**原样交给扫码的这台浏览器**（它存进自己的 localStorage），
        // 顺带把账号资料带回。服务端不留任何副本 —— 这是"多人各自扫码不串号"的前提。
        const profile = await provider.account.getProfile(check.cookie);
        sendOk(res, { state: check.state, cookie: check.cookie, profile });
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/:provider/login",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider?.account) {
        sendFail(res, 404, "这个音源不支持账号登录");
        return;
      }
      // 无状态校验：浏览器把它存的会话带上来，我们向音源验一下是否仍有效。
      // 没带就是未登录（不打扰上游）；带了但失效也让音源说 false，客户端据此清掉本地会话。
      const session = readSession(req);
      if (session.length === 0) {
        sendOk(res, { loggedIn: false, profile: null });
        return;
      }
      try {
        const profile = await provider.account.getProfile(session);
        sendOk(res, { loggedIn: profile !== null, profile });
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  router.delete(
    "/:provider/login",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider?.account) {
        sendFail(res, 404, "这个音源不支持账号登录");
        return;
      }
      // 让上游注销**这台浏览器带来的**那个会话；本地没有存过任何东西，无需清理
      const session = readSession(req);
      if (session.length > 0) {
        await provider.account.logout(session);
      }
      sendOk(res, { id: provider.id });
    }),
  );

  /* ---------- 收藏夹（登录后能听自己在音源收的歌）---------- */

  router.get(
    "/:provider/collections",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider?.collections) {
        sendFail(res, 404, "这个音源不支持收藏夹");
        return;
      }
      const session = readSession(req);
      if (session.length === 0) {
        sendFail(res, 401, "还没有登录这个音源的账号，先到 设置 › 在线音源 扫码登录");
        return;
      }
      try {
        // user_playlist 需要 uid：拿会话向音源现查一次 profile（一次轻请求）
        const profile = provider.account ? await provider.account.getProfile(session) : null;
        if (!profile?.userId) {
          sendFail(res, 401, "这个登录会话已经失效了，请重新扫码");
          return;
        }
        const playlists = await provider.collections.getPlaylists(profile.userId, session);
        sendOk(res, { playlists });
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/:provider/collections/:playlistId",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider?.collections) {
        sendFail(res, 404, "这个音源不支持收藏夹");
        return;
      }
      const playlistId = String(req.params.playlistId);
      if (!ID_PATTERN.test(playlistId)) {
        sendFail(res, 400, "歌单 id 不合法");
        return;
      }
      const session = readSession(req);
      if (session.length === 0) {
        sendFail(res, 401, "还没有登录这个音源的账号，先到 设置 › 在线音源 扫码登录");
        return;
      }
      try {
        const tracks = await provider.collections.getPlaylistTracks(playlistId, session);
        sendOk(res, { tracks });
      } catch (error) {
        if (error instanceof UpstreamError) {
          sendFail(res, 502, "音源暂时连不上，稍后再试");
          return;
        }
        throw error;
      }
    }),
  );

  router.get(
    "/:provider/cover",
    requireAccess("visitor"),
    asyncHandler(async (req, res) => {
      const provider = resolveProvider(config, String(req.params.provider));
      if (!provider) {
        sendFail(res, 404, "没有这个音源（或未配置它的服务地址）");
        return;
      }
      const url = String(req.query.url ?? "");
      // 白名单外一律 403：这个口子只该转发音源自家 CDN 的封面
      if (!provider.canProxyCover(url)) {
        sendFail(res, 403, "这个地址不在封面的白名单里");
        return;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), COVER_TIMEOUT_MS);
      try {
        const upstream = await fetch(url, { signal: controller.signal });
        const contentType = upstream.headers.get("content-type") ?? "";
        if (!upstream.ok || !contentType.startsWith("image/")) {
          sendFail(res, 502, "封面取不到");
          return;
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        res.set("Content-Type", contentType);
        res.set("Cache-Control", COVER_CACHE_CONTROL);
        res.send(body);
      } catch {
        sendFail(res, 502, "封面取不到");
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  return router;
}
