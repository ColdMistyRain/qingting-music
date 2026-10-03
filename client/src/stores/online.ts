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
import { showToast } from "@/utils/toast";
import {
  clearCollectionCache,
  readCollectionCache,
  writeCollectionCache,
} from "@/utils/onlineCollectionCache";
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
        // 之前登录着、这次验真失效了：说清楚界面为什么变回未登录（v6.39），
        // 而不是静默清掉让人摸不着头脑；清掉之后这条提示不会重复出现
        clearOnlineSession("netease");
        session.value = null;
        showToast({
          title: "网易云登录已失效",
          description: "请到 设置 › 在线音源 重新扫码登录",
        });
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
    // 歌单内容缓存也是账号数据：退出一并清（v6.34）
    clearCollectionCache("netease");
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

  /**
   * 打开一份歌单（v6.34 起缓存进 localStorage；**v6.35 补 4 起改为纯缓存优先**，
   * 需求方："为啥点击歌单还是会发送请求？不是会从 localstorage 中加载吗"）：
   * 有缓存（24h 内，见 `COLLECTION_CACHE_TTL_MS`）→ 直接摆缓存，**不发任何请求** ——
   * 想跟音源对一遍，点「刷新列表」；缓存过期或没有 → 清掉上一份的曲目、给「加载中」，
   * 等网络回来（居中进度条）。
   * （初版是 stale-while-revalidate：缓存照摆、后台再拉一份对音源 —— 显式的
   *   「刷新列表」按钮出现后，那次自动请求成了多余流量，按需求方的预期收敛。）
   */
  async function openPlaylist(id: string): Promise<void> {
    if (collectionStatus.value === "loading") return;
    collectionError.value = "";
    activePlaylistId.value = id;

    const cached = readCollectionCache("netease", id);
    if (cached) {
      collectionTracks.value = cached.tracks.map((info) => toOnlineTrack("netease", info));
      collectionStatus.value = "ready";
      return;
    }

    // 没缓存：必须清掉上一份的曲目 —— 否则"加载中"期间页面还摆着旧列表，
    // 且视图的加载分支（要求列表为空）接不住，会掉进空闲空态（v6.34 实测）
    await loadCollection(id);
  }

  /** 清掉旧曲目、重新拉一份（openPlaylist 的无缓存路径与「刷新列表」按钮共用） */
  async function loadCollection(id: string): Promise<void> {
    collectionTracks.value = [];
    collectionStatus.value = "loading";
    try {
      const { tracks } = await fetchOnlineCollectionTracks("netease", id);
      writeCollectionCache("netease", id, tracks);
      collectionTracks.value = tracks.map((info) => toOnlineTrack("netease", info));
      collectionStatus.value = "ready";
    } catch (error) {
      collectionError.value = error instanceof Error ? error.message : "歌单没能读出来";
      collectionStatus.value = "error";
    }
  }

  /**
   * 强制刷新一份歌单（「刷新列表」按钮）：**绕过缓存**重新拉取 ——
   * 纯缓存优先（v6.35 补 4）之后，这是"跟音源对一遍"的唯一入口。
   */
  async function refreshPlaylist(id: string): Promise<void> {
    if (collectionStatus.value === "loading") return;
    collectionError.value = "";
    activePlaylistId.value = id;
    await loadCollection(id);
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
    refreshPlaylist,
    closePlaylist,
  };
});
