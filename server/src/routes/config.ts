import { Router } from "express";
import type { AppConfig as ClientConfig } from "@qingting/shared";
import type { AppConfig } from "../config.js";
import { sendOk } from "../http.js";

/** GET /api/config：前端功能开关（ON-04 在线音源未配置时隐藏入口） */
export function createConfigRouter(config: AppConfig): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const data: ClientConfig = { onlineEnabled: config.onlineEnabled };
    sendOk(res, data);
  });

  return router;
}
