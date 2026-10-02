import { existsSync } from "node:fs";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";

/**
 * 前端静态托管（生产形态）：一个域名同时服务前端与 `/api`。
 *
 * 为什么需要它：开发期前端在 5173（Vite 再把 /api、/audio、/covers 代理到 3000），
 * 生产期总不能让用户开两个端口 —— `npm run build` 之后由后端把 `client/dist` 发出去，
 * 同源也就顺带没有了跨域与 Cookie 那些事（AC-07 私有部署：一条命令起一个进程）。
 *
 * 两条容易踩的规矩：
 * 1. **`/api`、`/audio`、`/covers` 不归 SPA 路由管**：它们返回 JSON / 文件，
 *    找不到就该 404，不能被兜底成一份 `index.html`（否则前端拿到 200 text/html，
 *    症状是“接口静默变成一坨 HTML” —— 与开发代理漏配 `/covers` 是同一个毛病）。
 *    这三条与 Service Worker 的 `navigateFallbackDenylist` 是同一份名单，一起维护。
 * 2. **入口文件与 SW 不缓存，只有带哈希的产物长缓存**：`index.html` / `sw.js` /
 *    `manifest.webmanifest` 一旦被缓存住，下次更新就推不下去（用户永远看到旧版本）。
 *    Vite 把带内容哈希的东西全放 `assets/` 下，所以规则可以写得很干脆。
 */

/** 这三条根路径不参与 SPA 兜底（与 vite.config.ts 的 navigateFallbackDenylist 同名单） */
const NON_SPA_PREFIXES = ["/api", "/audio", "/covers"];

function isNonSpaPath(reqPath: string): boolean {
  return NON_SPA_PREFIXES.some((prefix) => reqPath === prefix || reqPath.startsWith(`${prefix}/`));
}

/** 缓存策略：只有 `assets/` 下的哈希产物可以长缓存，其余一律协商缓存 */
export function staticCacheControl(filePath: string): string {
  const normalized = filePath.split(path.sep).join("/");
  return /\/assets\/[^/]+$/.test(normalized) && /-[A-Za-z0-9_]{8}\./.test(path.basename(normalized))
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

/** 目录里到底有没有可托管的前端产物（createApp 与启动日志共用这一个判断） */
export function hasStaticSite(dir: string | null): boolean {
  return dir !== null && existsSync(path.join(dir, "index.html"));
}

/**
 * 挂上静态托管。目录不存在时**什么都不做**（开发期就是这样：
 * 前端归 Vite，后端只管接口），返回是否启用。
 */
export function attachStaticSite(app: Express, dir: string | null): boolean {
  if (!hasStaticSite(dir)) return false;
  const staticDir = dir as string;

  app.use(
    express.static(staticDir, {
      // 目录索引交给下面的 SPA 兜底，别让 express.static 自己发 index.html
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader("Cache-Control", staticCacheControl(filePath));
      },
    }),
  );

  // SPA 兜底：前端路由（/library、/playlist/xxx…）刷新时都要拿到这一份 index.html。
  // 只认 GET/HEAD，且绕开上面那三条根路径；其余方法交给 Express 自己的 404。
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    if (isNonSpaPath(req.path)) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(staticDir, "index.html"));
  });

  return true;
}
