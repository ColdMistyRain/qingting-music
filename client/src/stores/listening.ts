import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  playlistItemKey,
  type ListeningData,
  type PlaylistItem,
  type RecentEntry,
} from "@qingting/shared";
import {
  addFavorite,
  clearRecent as apiClearRecent,
  fetchListening,
  listeningErrorMessage,
  recordRecent,
  removeFavorite,
} from "@/api/listening";

export type ListeningStatus = "idle" | "loading" | "ready" | "error";

/**
 * 收藏与最近播放（PS-05）。数据在服务器端（`data/listening.json`）：
 * 手机上收藏的、电脑上要能看见；清一次浏览器数据不该把它清掉。
 *
 * 两份列表由一个接口一起给，所有写操作也返回更新后的**两份** —— 客户端不做乐观更新，
 * 一律用服务端那一份回填（与歌单 store 同一套口径：服务端是唯一真相，两边不会不一致）。
 */
export const useListeningStore = defineStore("listening", () => {
  const favorites = ref<PlaylistItem[]>([]);
  const recent = ref<RecentEntry[]>([]);
  const status = ref<ListeningStatus>("idle");
  const error = ref("");
  /** 正在请求的那几条（身份键）：连点两下不会再发一次相反的请求 */
  const pending = ref<Set<string>>(new Set());

  const favoriteKeys = computed(() => new Set(favorites.value.map(playlistItemKey)));

  function apply(data: ListeningData): void {
    favorites.value = data.favorites;
    recent.value = data.recent;
  }

  /** 载入两份列表；force 用于别处改过之后强制刷新 */
  async function load(force = false): Promise<void> {
    if (status.value === "loading") return;
    if (status.value === "ready" && !force) return;

    status.value = "loading";
    try {
      apply(await fetchListening());
      error.value = "";
      status.value = "ready";
    } catch (err) {
      // 保留已有列表（刷新失败不该把收藏清空），只在页面上给提示
      error.value = listeningErrorMessage(err);
      status.value = "error";
    }
  }

  function isFavorite(item: PlaylistItem): boolean {
    return favoriteKeys.value.has(playlistItemKey(item));
  }

  function isPending(item: PlaylistItem): boolean {
    return pending.value.has(playlistItemKey(item));
  }

  /** 收藏 / 取消收藏（同一个入口：按当前状态决定发哪一条请求） */
  async function toggleFavorite(item: PlaylistItem): Promise<void> {
    const key = playlistItemKey(item);
    if (pending.value.has(key)) return;

    const wasFavorite = isFavorite(item);
    pending.value = new Set(pending.value).add(key);
    error.value = "";
    try {
      apply(wasFavorite ? await removeFavorite(key) : await addFavorite(item));
    } catch (err) {
      error.value = listeningErrorMessage(err);
    } finally {
      const next = new Set(pending.value);
      next.delete(key);
      pending.value = next;
    }
  }

  /**
   * 记一次播放（PS-05）。**失败保持安静**：历史记不上不该在听歌时弹错，
   * 也不该把播放体验牵连进去（下次切歌还会再记一次）。
   */
  async function recordPlay(item: PlaylistItem): Promise<void> {
    try {
      apply(await recordRecent(item));
      error.value = "";
      status.value = "ready";
    } catch {
      /* 静默：这是背景动作 */
    }
  }

  /** 清空最近播放（破坏性，调用方负责先问一句） */
  async function clearRecent(): Promise<void> {
    error.value = "";
    try {
      apply(await apiClearRecent());
    } catch (err) {
      error.value = listeningErrorMessage(err);
    }
  }

  function clearError(): void {
    error.value = "";
  }

  return {
    favorites,
    recent,
    status,
    error,
    favoriteKeys,
    pending,
    load,
    isFavorite,
    isPending,
    toggleFavorite,
    recordPlay,
    clearRecent,
    clearError,
  };
});
