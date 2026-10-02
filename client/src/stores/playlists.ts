import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  playlistItemKey,
  toPlaylistItem,
  type Playlist,
  type PlaylistItem,
  type Track,
} from "@qingting/shared";
import {
  createPlaylist as apiCreate,
  deletePlaylist as apiDelete,
  fetchPlaylists,
  playlistErrorMessage,
  renamePlaylist as apiRename,
  replacePlaylistItems as apiReplaceItems,
} from "@/api/playlists";
import { movePlaylistItem } from "@/utils/playlistEntries";

export type PlaylistsStatus = "idle" | "loading" | "ready" | "error";

/**
 * 歌单（PRD 3.6 / PS-01~04）。歌单**存在服务器端**（PS-01），本地只缓存这一份列表。
 *
 * 所有写操作都拿服务端返回的整份歌单回填本地 —— 服务端会再去重、
 * 也会维护 `updatedAt`，客户端自己算一份容易两边不一致。
 */
export const usePlaylistsStore = defineStore("playlists", () => {
  const playlists = ref<Playlist[]>([]);
  const status = ref<PlaylistsStatus>("idle");
  const error = ref("");

  const count = computed(() => playlists.value.length);
  const byId = computed(() => new Map(playlists.value.map((entry) => [entry.id, entry])));

  function replaceLocal(playlist: Playlist): void {
    const index = playlists.value.findIndex((entry) => entry.id === playlist.id);
    if (index >= 0) playlists.value[index] = playlist;
    else playlists.value = [...playlists.value, playlist];
  }

  /** 载入列表；force 用于别处改过歌单后强制刷新 */
  async function load(force = false): Promise<void> {
    if (status.value === "loading") return;
    if (status.value === "ready" && !force) return;

    status.value = "loading";
    try {
      const result = await fetchPlaylists();
      playlists.value = result.playlists;
      error.value = "";
      status.value = "ready";
    } catch (err) {
      // 保留已有列表（刷新失败不该把侧栏清空），只在页面上给提示
      error.value = playlistErrorMessage(err);
      status.value = "error";
    }
  }

  async function create(name: string): Promise<Playlist> {
    const created = await apiCreate(name);
    replaceLocal(created);
    return created;
  }

  async function rename(id: string, name: string): Promise<Playlist> {
    const updated = await apiRename(id, name);
    replaceLocal(updated);
    return updated;
  }

  async function remove(id: string): Promise<void> {
    await apiDelete(id);
    playlists.value = playlists.value.filter((entry) => entry.id !== id);
  }

  /** 整表替换曲目：添加、移除、排序都走这一条（PS-02 / PS-04） */
  async function setItems(id: string, items: readonly PlaylistItem[]): Promise<Playlist> {
    const updated = await apiReplaceItems(id, items);
    replaceLocal(updated);
    return updated;
  }

  /** 把曲目追加到歌单末尾（同一首已在里面就不重复加） */
  async function addTracks(id: string, tracks: readonly Track[]): Promise<Playlist | null> {
    const playlist = byId.value.get(id);
    if (!playlist || tracks.length === 0) return null;
    return setItems(id, [...playlist.items, ...tracks.map(toPlaylistItem)]);
  }

  /** 移掉歌单里的某一条（按身份键定位，不靠下标 —— 下标会被排序改掉） */
  async function removeItem(id: string, item: PlaylistItem): Promise<Playlist | null> {
    const playlist = byId.value.get(id);
    if (!playlist) return null;
    const key = playlistItemKey(item);
    return setItems(
      id,
      playlist.items.filter((entry) => playlistItemKey(entry) !== key),
    );
  }

  /**
   * 歌单内排序（PS-04）：把第 from 条挪到第 to 条的位置。
   * 排序也是“新的一份顺序”（与添加/移除同一回事），所以直接发整表（`utils/playlistEntries`
   * 的 `movePlaylistItem` 负责下标运算，纯函数、有单测）。
   */
  async function moveItem(id: string, from: number, to: number): Promise<Playlist | null> {
    const playlist = byId.value.get(id);
    if (!playlist) return null;
    return setItems(id, movePlaylistItem(playlist.items, from, to));
  }

  function clearError(): void {
    error.value = "";
  }

  return {
    playlists,
    status,
    error,
    count,
    byId,
    load,
    create,
    rename,
    remove,
    setItems,
    addTracks,
    removeItem,
    moveItem,
    clearError,
  };
});
