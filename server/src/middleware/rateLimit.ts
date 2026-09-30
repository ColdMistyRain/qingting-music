import rateLimit from "express-rate-limit";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS } from "../config.js";

/**
 * 登录防爆破（AC-06）：窗口内失败次数超限返回 429。
 * 成功登录不计入失败计数（skipSuccessfulRequests）。
 */
export function createLoginLimiter() {
  return rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_MAX_FAILURES,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ code: 429, message: "尝试次数过多，请稍后再试" });
    },
  });
}
