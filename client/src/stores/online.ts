import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { OnlinePlaylistInfo, OnlineTrack, Track } from "@qingting/shared";
import {
  createOnlineQrLogin,
  checkOnlineQrLogin,
  fetchOnlineAccount,
  fetchOnlineCollectionTracks,
  fetchOnlineCollections,
  fetchOnlineSearch,
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
export const ACCOUNT_PROVIDERS = ["netease", "qq", "kugou"] as const;
export type AccountProvider = (typeof ACCOUNT_PROVIDERS)[number];
/** 搜索音源：单个平台，或 "all"（聚合，ON-07 —— 并发查各源交错合并） */
export type SearchSource = AccountProvider | "all";

export type OnlineStatus = "idle" | "loading" | "ready" | "error";

/** 音源的中文显示名（提示与标题用；来源列的映射在 utils/onlineTracks） */
export const PROVIDER_LABELS: Record<AccountProvider, string> = {
  netease: "网易云",
  qq: "QQ 音乐",
  kugou: "酷狗音乐",
};

export const useOnlineStore = defineStore("online", () => {
  /* ---------- 账号（会话在本浏览器，按音源分槽；v6.59 起三源通用）---------- */
  const sessionsByProvider = ref<Record<AccountProvider, OnlineSession | null>>({
    netease: readOnlineSession("netease"),
    qq: readOnlineSession("qq"),
    kugou: readOnlineSession("kugou"),
  });
  const accountStatus = ref<OnlineStatus>("idle");
  /** 向某音源验真：失效即清并提示（v6.39 的规则，v6.59 泛化到全部音源） */
  async function verifySession(target: AccountProvider): Promise<void> {
    const label = PROVIDER_LABELS[target];
    const stored = readOnlineSession(target);
    if (!stored) {
      sessionsByProvider.value[target] = null;
      return;
    }
    try {
      const info = await fetchOnlineAccount(target);
      if (info.loggedIn) {
        sessionsByProvider.value[target] = { ...stored, profile: info.profile };
        writeOnlineSession(sessionsByProvider.value[target]!);
      } else {
        clearOnlineSession(target);
        sessionsByProvider.value[target] = null;
        showToast({ title: `${label}登录已失效`, description: `请到 设置 › 在线音源 重新扫码登录` });
      }
    } catch {
      // 验真失败（网络/后端不在）：保留本地会话，下次再验
    }
  }

  /**
   * 启动时校验某音源的本地会话（v6.59 泛化：失效即清 + 提示；后端无状态，验证经它转手）。
   * 没有本地会话直接跳过；验真失败（网络/后端不在）保留本地会话，下次再验。
   */
  async function loadAccount(target: AccountProvider, force = false): Promise<void> {
    if (accountStatus.value === "loading") return;
    if (!force && accountStatus.value === "ready") return;
    accountStatus.value = "loading";
    const hadSession = readOnlineSession(target) !== null;
    if (!hadSession) {
      sessionsByProvider.value[target] = null;
      return;
    }
    try {
      await verifySession(target);
      accountStatus.value = "ready";
    } catch {
      accountStatus.value = "error";
    }
  }


  /**
   * 扫码轮询的**一次性驱动**（轮询节奏归调用方/弹窗组件管，store 只出两步动作）：
   * 生成二维码；按 key 问一次状态。
   */
  async function startQrLogin(
    provider: AccountProvider,
    channel?: string,
  ): Promise<{ key: string; qrDataUrl: string }> {
    return createOnlineQrLogin(provider, channel);
  }

  async function checkQrLogin(
    provider: AccountProvider,
    key: string,
  ): Promise<{ state: string; profile: unknown }> {
    const result = await checkOnlineQrLogin(provider, key);
    if (result.state === "success" && result.cookie.length > 0) {
      // 会话交给这台浏览器：存下，界面即刻变已登录
      const next: OnlineSession = {
        provider,
        cookie: result.cookie,
        profile: (result.profile as OnlineSession["profile"]) ?? null,
        loggedInAt: new Date().toISOString(),
      };
      writeOnlineSession(next);
      sessionsByProvider.value[provider] = next;
    }
    return result;
  }

  /** 退出某音源（v6.59 泛化）：上游注销尽力而为，本地一定清 */
  async function logoutFor(target: AccountProvider): Promise<void> {
    try {
      await logoutOnline(target);
    } catch {
      // 网络不通也照常清本地
    }
    clearOnlineSession(target);
    sessionsByProvider.value[target] = null;
  }

  async function logout(): Promise<void> {
    await logoutFor("netease");
    // 歌单内容缓存也是账号数据：退出一并清（v6.34）
    clearCollectionCache("netease");
    playlistsByProvider.value.netease = [];
    activePlaylistId.value = null;
    collectionTracks.value = [];
    collectionStatus.value = "idle";
  }

  const loggedIn = computed(() => sessionsByProvider.value.netease !== null);
  const qqLoggedIn = computed(() => sessionsByProvider.value.qq !== null);
  const kugouLoggedIn = computed(() => sessionsByProvider.value.kugou !== null);
  const profile = computed(() => sessionsByProvider.value.netease?.profile ?? null);
  /** 各已登录音源（聚合搜索与侧栏分区都按它展开） */
  const loggedInProviders = computed<AccountProvider[]>(() =>
    ACCOUNT_PROVIDERS.filter((target) => sessionsByProvider.value[target] !== null),
  );

  /* ---------- 收藏夹（歌单）：按音源分槽，侧栏同时展示各已登录平台（v6.57 补 6）---------- */
  const playlistsByProvider = ref<Record<AccountProvider, OnlinePlaylistInfo[]>>({
    netease: [],
    qq: [],
    kugou: [],
  });
  const playlistsStatusByProvider = ref<Record<AccountProvider, OnlineStatus>>({
    netease: "idle",
    qq: "idle",
    kugou: "idle",
  });
  const playlistsErrorByProvider = ref<Record<AccountProvider, string>>({
    netease: "",
    qq: "",
    kugou: "",
  });

  async function loadPlaylists(target: AccountProvider, force = false): Promise<void> {
    const status = playlistsStatusByProvider.value[target];
    if (status === "loading") return;
    if (status === "ready" && !force) return;
    playlistsStatusByProvider.value[target] = "loading";
    try {
      playlistsByProvider.value[target] = (await fetchOnlineCollections(target)).playlists;
      playlistsStatusByProvider.value[target] = "ready";
    } catch (error) {
      const label = target === "qq" ? "QQ 音乐" : "网易云";
      playlistsErrorByProvider.value[target] =
        error instanceof ApiError && error.status === 401
          ? `还没有登录${label}账号`
          : (error instanceof Error ? error.message : "歌单没能读出来");
      playlistsStatusByProvider.value[target] = "error";
    }
  }

  /* ---------- 音源选择（v6.57，ON-06；v6.58 起 ON-07 聚合）---------- */
  const PROVIDER_STORAGE_KEY = "qt-online-provider";
  const SOURCE_STORAGE_VALUES: readonly string[] = ["all", "netease", "qq"];
  function resolveInitialSource(): SearchSource {
    if (typeof localStorage === "undefined") return "all";
    const stored = localStorage.getItem(PROVIDER_STORAGE_KEY);
    return stored !== null && SOURCE_STORAGE_VALUES.includes(stored)
      ? (stored as SearchSource)
      : "all";
  }
  const provider = ref<SearchSource>(resolveInitialSource());
  function setProvider(next: SearchSource): void {
    if (provider.value === next) return;
    provider.value = next;
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, next);
    } catch {
      // 存不上就算了：这次会话内仍然有效
    }
    // 切源 = 换搜索语境：搜索结果清掉。歌单**不跟随** —— 侧栏同时展示
    // 各个已登录平台的歌单（v6.57 补 6，需求方："不管选择那个音源，
    // 已经登录的平台所收藏的歌单都应该展示出来"）
    closePlaylist();
    searchKeyword.value = "";
    searchStatus.value = "idle";
    searchError.value = "";
    searchPartialError.value = "";
    searchTracks.value = [];
    lastSearchKeyword.value = "";
    searchSeq += 1;
  }

  /* ---------- 搜索（ON-02）：结果跨页保留（v6.45，需求方连点"继续"后我把
     页面局部状态搬进 store —— 跳去沉浸页再回来，搜索结果不再丢失）---------- */
  const searchKeyword = ref("");
  const searchStatus = ref<OnlineStatus>("idle");
  const searchError = ref("");
  /** 聚合搜索的部分失败提示（结果照摆时另给的弱提示，v6.58） */
  const searchPartialError = ref("");
  const searchTracks = ref<Track[]>([]);
  const lastSearchKeyword = ref("");
  /** 每次搜索自增；响应回来时序号对不上就丢掉（请求本身没法中断，也不必中断） */
  let searchSeq = 0;

  /** 当前搜索语境下会并发查询的音源列表（"all" = 网易云恒在 + 已登录的 QQ） */
  function activeSearchSources(): AccountProvider[] {
    if (provider.value !== "all") return [provider.value];
    // 聚合档：网易云恒在（免登录可搜），其余已登录的源参与
    const sources: AccountProvider[] = ["netease"];
    if (qqLoggedIn.value) sources.push("qq");
    if (kugouLoggedIn.value) sources.push("kugou");
    return sources;
  }

  async function search(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text) return;
    const seq = ++searchSeq;
    // 搜索是新的意图：收起正在看的歌单
    closePlaylist();
    searchStatus.value = "loading";
    searchError.value = "";
    searchPartialError.value = "";
    lastSearchKeyword.value = text;

    const sources = activeSearchSources();
    // 单源：原路径（聚合路径也是各源自带会话头，只是并发 + 合并）
    const settled = await Promise.allSettled(
      sources.map((source) => fetchOnlineSearch(source, text)),
    );
    if (seq !== searchSeq) return;

    const buckets: Track[][] = [];
    const failures: string[] = [];
    settled.forEach((result, index) => {
      const label = PROVIDER_LABELS[sources[index]];
      if (result.status === "fulfilled") {
        buckets.push(result.value.tracks.map((info: OnlineTrack) => toOnlineTrack(result.value.provider, info)));
      } else {
        failures.push(label);
      }
    });

    // 全部失败：照旧走错误态
    if (buckets.length === 0) {
      searchStatus.value = "error";
      searchError.value = "搜索出了点问题，稍后再试";
      return;
    }

    // 交错合并（轮流取各源的下一条）：单源内部保持相关度序，跨源交替出现，
    // TrackRow 的来源列本就显示实际音源名（v6.35 补 3），不会分不清
    const merged: Track[] = [];
    const longest = Math.max(...buckets.map((bucket) => bucket.length));
    for (let index = 0; index < longest; index++) {
      for (const bucket of buckets) {
        const track = bucket[index];
        if (track) merged.push(track);
      }
    }
    searchTracks.value = merged;
    searchStatus.value = "ready";
    // 部分失败：结果照摆，另给一条弱提示（OnlineView 的 strip 展示）
    searchPartialError.value =
      failures.length > 0 ? `${failures.join("、")}搜索失败，已省略其结果` : "";
  }

  /* ---------- 当前打开的一份歌单 ---------- */
  const activePlaylistId = ref<string | null>(null);
  const collectionTracks = ref<Track[]>([]);
  const collectionStatus = ref<OnlineStatus>("idle");
  const collectionError = ref("");

  /** 打开的歌单属于哪个音源（缓存与曲目映射都跟着它走，与搜索音源无关） */
  const activePlaylistProvider = ref<AccountProvider>("netease");
  const activePlaylist = computed(
    () =>
      playlistsByProvider.value[activePlaylistProvider.value]?.find(
        (entry) => entry.id === activePlaylistId.value,
      ) ?? null,
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
  /** 打开的歌单属于哪个音源：先按侧栏两份列表认领；认领不出（列表还没加载 /
      存档恢复等场景）回退到当前搜索音源 —— 缓存与曲目请求本来就按音源分键 */
  function resolvePlaylistProvider(id: string): AccountProvider {
    for (const target of ACCOUNT_PROVIDERS) {
      if (playlistsByProvider.value[target].some((entry) => entry.id === id)) return target;
    }
    // 兜底（列表还没加载等场景）：当前搜索音源；聚合档回网易云（它恒可用）
    return provider.value === "qq" || provider.value === "kugou" ? provider.value : "netease";
  }

  async function openPlaylist(id: string): Promise<void> {
    if (collectionStatus.value === "loading") return;
    activePlaylistProvider.value = resolvePlaylistProvider(id);
    collectionError.value = "";
    activePlaylistId.value = id;

    const owner = activePlaylistProvider.value;
    const cached = readCollectionCache(owner, id);
    if (cached) {
      collectionTracks.value = cached.tracks.map((info) => toOnlineTrack(owner, info));
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
      const { tracks } = await fetchOnlineCollectionTracks(activePlaylistProvider.value, id);
      writeCollectionCache(activePlaylistProvider.value, id, tracks);
      collectionTracks.value = tracks.map((info) => toOnlineTrack(activePlaylistProvider.value, info));
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
    activePlaylistProvider.value = resolvePlaylistProvider(id);
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
    sessionsByProvider,
    loggedIn,
    qqLoggedIn,
    kugouLoggedIn,
    loggedInProviders,
    profile,
    loadAccount,
    startQrLogin,
    checkQrLogin,
    provider,
    setProvider,
    logoutFor,
    logout,
    // 搜索
    searchKeyword,
    searchStatus,
    searchError,
    searchPartialError,
    searchTracks,
    lastSearchKeyword,
    search,
    // 收藏夹
    playlistsByProvider,
    playlistsStatusByProvider,
    playlistsErrorByProvider,
    loadPlaylists,
    activePlaylistProvider,
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
