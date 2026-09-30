import { Router, type CookieOptions, type Request } from "express";
import type { AuthStatus } from "@qingting/shared";
import type { AppConfig } from "../config.js";
import { sendFail, sendOk } from "../http.js";
import { createLoginLimiter } from "../middleware/rateLimit.js";
import { AUTH_COOKIE, matchPassword, signToken, type PasswordCandidate } from "../services/auth.js";

/** 按 AC-02 的顺序构造候选：访客在前、管理员在后 */
export function configuredPasswords(config: AppConfig): PasswordCandidate[] {
  const candidates: PasswordCandidate[] = [];
  if (config.userPassword) candidates.push({ role: "visitor", password: config.userPassword });
  if (config.adminPassword) candidates.push({ role: "admin", password: config.adminPassword });
  return candidates;
}

/** 凭证 Cookie 属性：httpOnly + sameSite=Lax，HTTPS 下自动加 secure */
function cookieOptions(req: Request, config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
    path: "/",
    maxAge: config.authTtlMs,
  };
}

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();

  /** GET /api/auth/status：前端据此决定进入未登录模式、登录页还是管理台 */
  router.get("/status", (req, res) => {
    const data: AuthStatus = { authEnabled: config.authEnabled, role: req.role };
    sendOk(res, data);
  });

  /** POST /api/auth/login：单密码输入，后端自动识别角色（AC-07） */
  router.post("/login", createLoginLimiter(), (req, res) => {
    if (!config.authEnabled) {
      sendFail(res, 400, "当前环境未启用门禁，无需登录");
      return;
    }
    const body = req.body as { password?: unknown } | undefined;
    const password = typeof body?.password === "string" ? body.password : "";
    const role = matchPassword(password, configuredPasswords(config));
    if (!role) {
      sendFail(res, 401, "访问密码不正确");
      return;
    }
    res.cookie(AUTH_COOKIE, signToken(role, config.authSecret), cookieOptions(req, config));
    const data: AuthStatus = { authEnabled: config.authEnabled, role };
    sendOk(res, data);
  });

  /** POST /api/auth/logout：清除凭证，回到未登录（AC-04） */
  router.post("/logout", (req, res) => {
    res.clearCookie(AUTH_COOKIE, { ...cookieOptions(req, config), maxAge: undefined });
    const data: AuthStatus = { authEnabled: config.authEnabled, role: "anonymous" };
    sendOk(res, data);
  });

  return router;
}
