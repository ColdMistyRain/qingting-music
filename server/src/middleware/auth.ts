import type { RequestHandler } from "express";
import { hasAccess, type AccessLevel } from "@qingting/shared";
import type { AppConfig } from "../config.js";
import { sendFail } from "../http.js";
import { AUTH_COOKIE, resolveRole } from "../services/auth.js";

/**
 * 解析 Cookie 得到当前角色并挂到 req.role。
 * 门禁关闭（两把密码都未配置）时视为管理员，全功能开放（AC-05）。
 */
export function attachRole(config: AppConfig): RequestHandler {
  return (req, _res, next) => {
    if (!config.authEnabled) {
      req.role = "admin";
    } else {
      const cookies = req.cookies as Record<string, string | undefined> | undefined;
      req.role = resolveRole(cookies?.[AUTH_COOKIE], config.authSecret, config.authTtlMs);
    }
    next();
  };
}

/** 分级保护（AC-03）：未登录 401，角色不足 403 */
export function requireAccess(level: AccessLevel): RequestHandler {
  return (req, res, next) => {
    if (req.role === "anonymous") {
      sendFail(res, 401, "请先登录");
      return;
    }
    if (!hasAccess(req.role, level)) {
      sendFail(res, 403, "当前身份无权访问该功能");
      return;
    }
    next();
  };
}
