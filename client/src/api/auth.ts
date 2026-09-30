import type { AuthStatus } from "@qingting/shared";
import { apiGet, apiPost } from "./http";

/** 查询登录态与门禁开关（AC-01 / AC-05 / AC-07） */
export function fetchAuthStatus(): Promise<AuthStatus> {
  return apiGet<AuthStatus>("/api/auth/status");
}

/** 登录：单密码输入，后端自动识别角色（AC-02 / AC-07） */
export function login(password: string): Promise<AuthStatus> {
  return apiPost<AuthStatus>("/api/auth/login", { password });
}

/** 登出：清除凭证（AC-04） */
export function logout(): Promise<AuthStatus> {
  return apiPost<AuthStatus>("/api/auth/logout");
}
