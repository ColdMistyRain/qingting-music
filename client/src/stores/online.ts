import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { OnlineAccountInfo, OnlinePlaylistInfo, Track } from "@qingting/shared";
import {
  createOnlineQrLogin,
  checkOnlineQrLogin,
  fetchOnlineAccount,
  fetchOnlineCollectionTracks,
  fetchOnlineCollections,
  logoutOnline,
} from "@/api/online";
import { toOnlineTrack } from "@/utils/onlineTracks";
import { ApiError } from "@/api/http";

/**
 * 在线音源账号与收藏夹（ON-10 / v6.30）。
 *
 * 登录是**全 server 共享一份**的（会话存服务端 data/online-auth.json）：
 * 部署者扫一次码，这个部署里的所有人都能听这个账号收藏的歌。
 *
 * 收藏夹的曲目放在 store 里而不是页面里：从在线页跳去沉浸页再回来，
 * 选中的歌单还在（搜索结果是页面状态、不留 —— 见 OnlineView 的注释）。
 */

/** 账号能力的提供方（P1 只有网易云；QQ/酷狗接入后在这里加） */
export const ACCOUNT_PROVIDERS = ["netease"] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

export type OnlineStatus = "idle" | "loading" | "ready" | "error";

export const useOnlineStore = defineStore("online", () => {
  /* ---------- 账号 ---------- */
  const account = ref<OnlineAccountInfo | null>(null);
  const accountStatus = ref<OnlineStatus>("idle");

  async function loadAccount(force = false): Promise<void> {
    if (accountStatus.value === "loading") return;
    if (accountStatus.value === "ready" && !force) return;
    accountStatus.value = "loading";
    try {
      account.value = await fetchOnlineAccount("netease");
      accountStatus.value = "ready";
    } catch {
      accountStatus.value = "error";
    }
  }

  /**
   * 扫码轮询的**一次性驱动**（轮询节奏归调用方/弹窗组件管，store 只出两步动作）：
   * 生成二维码；按 key 问一次状态。
   */
  async function createLogin(): Promise<{ key: string; qrDataUrl: string }> {
    return createOnlineQrLogin("netease");
  }

  async function checkLogin(key: string): Promise<{ state: string; profile: unknown }> {
    const result = await checkOnlineQrLogin("netease", key);
    if (result.state === "success") {
      // 会话已在服务端落盘：把本地账号态刷成新的一份
      await loadAccount(true);
    }
    return result;
  }

  async function logout(): Promise<void> {
    await logoutOnline("netease");
    account.value = { loggedIn: false, profile: null };
    playlists.value = [];
    activePlaylistId.value = null;
    collectionTracks.value = [];
    collectionStatus.value = "idle";
  }

  const loggedIn = computed(() => account.value?.loggedIn ?? false);
  const profile = computed(() => account.value?.profile ?? null);

  /* ---------- 收藏夹（歌单）---------- */
  const playlists = ref<OnlinePlaylistInfo[]>([]);
  const playlistsStatus = ref<OnlineStatus>("idle");
  const playlistsError = ref("");

  async function loadPlaylists(force = false): Promise<void> {
    if (playlistsStatus.value === "loading") return;
    if (playlistsStatus.value === "ready" && !force) return;
    playlistsStatus.value = "loading";
    try {
      playlists.value = (await fetchOnlineCollections("netease")).playlists;
      playlistsStatus.value = "ready";
    } catch (error) {
      // 未登录（401）是最常见的原因：给一句能照着做的话
      playlistsError.value =
        error instanceof ApiError && error.status === 401
          ? "还没有登录网易云账号"
          : (error instanceof Error ? error.message : "歌单没能读出来");
      playlistsStatus.value = "error";
    }
  }

  /* ---------- 当前打开的一份歌单 ---------- */
  const activePlaylistId = ref<string | null>(null);
  const collectionTracks = ref<Track[]>([]);
  const collectionStatus = ref<OnlineStatus>("idle");
  const collectionError = ref("");

  const activePlaylist = computed(
    () => playlists.value.find((entry) => entry.id === activePlaylistId.value) ?? null,
  );

  /** 打开一份歌单：曲目按统一格式进 store（url 空串，开播前由 player store 现解析直链） */
  async function openPlaylist(id: string): Promise<void> {
    if (collectionStatus.value === "loading") return;
    collectionStatus.value = "loading";
    collectionError.value = "";
    try {
      const { tracks } = await fetchOnlineCollectionTracks("netease", id);
      collectionTracks.value = tracks.map((info) => toOnlineTrack("netease", info));
      activePlaylistId.value = id;
      collectionStatus.value = "ready";
    } catch (error) {
      collectionError.value = error instanceof Error ? error.message : "歌单没能读出来";
      collectionStatus.value = "error";
    }
  }

  /** 收起歌单，回到搜索 */
  function closePlaylist(): void {
    activePlaylistId.value = null;
    collectionTracks.value = [];
    collectionStatus.value = "idle";
    collectionError.value = "";
  }

  return {
    // 账号
    account,
    accountStatus,
    loggedIn,
    profile,
    loadAccount,
    createLogin,
    checkLogin,
    logout,
    // 收藏夹
    playlists,
    playlistsStatus,
    playlistsError,
    loadPlaylists,
    activePlaylistId,
    activePlaylist,
    collectionTracks,
    collectionStatus,
    collectionError,
    openPlaylist,
    closePlaylist,
  };
});
