import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { OnlinePlaylistInfo, Track } from "@qingting/shared";
import {
  createOnlineQrLogin,
  checkOnlineQrLogin,
  fetchOnlineAccount,
  fetchOnlineCollectionTracks,
  fetchOnlineCollections,
  logoutOnline,
} from "@/api/online";
import {
  clearOnlineSession,
  readOnlineSession,
  writeOnlineSession,
  type OnlineSession,
} from "@/utils/onlineSession";
import { toOnlineTrack } from "@/utils/onlineTracks";
import { ApiError } from "@/api/http";

/**
 * 在线音源账号与收藏夹（ON-10；v6.31 起会话**存各浏览器自己的 localStorage**）。
 *
 * 为什么不存服务端（需求方定）：服务端单槽会话下，两个人先后扫码会互相覆盖 —— 账号就串了。
 * 现在的模型与普通网站一致：扫码成功后会话交给**扫码的那台浏览器**，本 store 负责
 * 存取（`utils/onlineSession`）与验证（每次启动向后端验一次是否仍有效），后端全程无状态。
 * 代价：换浏览器/清浏览器数据要重新扫码。
 *
 * 收藏夹的曲目放在 store 里而不是页面里：从在线页跳去沉浸页再回来，
 * 选中的歌单还在（搜索结果是页面状态、不留 —— 见 OnlineView 的注释）。
 */

/** 账号能力的提供方（P1 只有网易云；QQ/酷狗接入后在这里加） */
export const ACCOUNT_PROVIDERS = ["netease"] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];

export type OnlineStatus = "idle" | "loading" | "ready" | "error";

export const useOnlineStore = defineStore("online", () => {
  /* ---------- 账号（会话在本浏览器）---------- */
  const session = ref<OnlineSession | null>(readOnlineSession("netease"));
  const accountStatus = ref<OnlineStatus>("idle");

  /**
   * 启动时校验一遍本地会话：向音源验真（后端无状态，验证经它转手）。
   * 音源说失效了就清掉本地 —— 界面回到未登录，不会拿着死会话装作已登录。
   */
  async function loadAccount(force = false): Promise<void> {
    if (accountStatus.value === "loading") return;
    if (accountStatus.value === "ready" && !force) return;
    accountStatus.value = "loading";
    const stored = readOnlineSession("netease");
    if (!stored) {
      session.value = null;
      accountStatus.value = "ready";
      return;
    }
    try {
      const info = await fetchOnlineAccount("netease");
      if (info.loggedIn) {
        // 验证顺带把最新资料带回（改过昵称/头像也能跟上）
        session.value = { ...stored, profile: info.profile };
        writeOnlineSession(session.value);
      } else {
        clearOnlineSession("netease");
        session.value = null;
      }
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
    if (result.state === "success" && result.cookie.length > 0) {
      // 会话交给这台浏览器：存下，界面即刻变已登录
      const next: OnlineSession = {
        provider: "netease",
        cookie: result.cookie,
        profile: (result.profile as OnlineSession["profile"]) ?? null,
        loggedInAt: new Date().toISOString(),
      };
      writeOnlineSession(next);
      session.value = next;
    }
    return result;
  }

  async function logout(): Promise<void> {
    // 上游注销尽力而为：本地一定清（就算上游没响应，死会话下次启动验真时也会被清）
    try {
      await logoutOnline("netease");
    } catch {
      // 网络不通也照常清本地
    }
    clearOnlineSession("netease");
    session.value = null;
    playlists.value = [];
    activePlaylistId.value = null;
    collectionTracks.value = [];
    collectionStatus.value = "idle";
  }

  const loggedIn = computed(() => session.value !== null);
  const profile = computed(() => session.value?.profile ?? null);

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
