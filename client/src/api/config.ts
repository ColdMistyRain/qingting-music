import type { AppConfig } from "@qingting/shared";
import { apiGet } from "./http";

/** 功能开关（在线音源是否配置，ON-04） */
export function fetchConfig(): Promise<AppConfig> {
  return apiGet<AppConfig>("/api/config");
}
