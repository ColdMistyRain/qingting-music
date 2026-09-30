import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AuthStatus, Role } from "@qingting/shared";
import { fetchAuthStatus, login as loginRequest, logout as logoutRequest } from "@/api/auth";

/**
 * 登录态 store（AC-01/02/05/08）。
 * 角色三档：anonymous（仅本地播放）/ visitor（可听云端与在线）/ admin（额外解锁管理台）。
 */
export const useAuthStore = defineStore("auth", () => {
  const role = ref<Role>("anonymous");
  const authEnabled = ref(false);
  const loaded = ref(false);

  /** 首次拉取的并发去重，避免多个守卫同时打接口 */
  let inflight: Promise<void> | null = null;

  const isAdmin = computed(() => role.value === "admin");
  const isVisitor = computed(() => role.value === "visitor");
  /** 访客及以上：可用云端曲库、歌单与在线音源（AC-03 访客级接口） */
  const canUseServer = computed(() => role.value !== "anonymous");

  function apply(status: AuthStatus): void {
    role.value = status.role;
    authEnabled.value = status.authEnabled;
    loaded.value = true;
  }

  async function refresh(): Promise<void> {
    apply(await fetchAuthStatus());
  }

  /** 路由守卫调用：首次进入时确保登录态已就绪 */
  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return;
    inflight ??= refresh().finally(() => {
      inflight = null;
    });
    await inflight;
  }

  async function login(password: string): Promise<void> {
    apply(await loginRequest(password));
  }

  async function logout(): Promise<void> {
    apply(await logoutRequest());
  }

  return { role, authEnabled, loaded, isAdmin, isVisitor, canUseServer, refresh, ensureLoaded, login, logout };
});
