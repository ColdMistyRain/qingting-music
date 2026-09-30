import { defineStore } from "pinia";
import { ref } from "vue";
import type { Song } from "@qingting/shared";
import { deleteSong, fetchSongs, libraryErrorMessage } from "@/api/songs";

export type LibraryStatus = "idle" | "loading" | "ready" | "error";

/**
 * 云端曲库（PRD 3.4 / LB-04）。
 * 列表一次拉全、过滤与排序交给页面用纯函数做（LB-07），
 * 这样控制台与音乐库共享同一份数据，删除/上传后两边一起更新。
 */
export const useLibraryStore = defineStore("library", () => {
  const songs = ref<Song[]>([]);
  /** 占用空间（字节）：成功加载时用后端给的总额，本地增删后重算（LB-10 / AD-03） */
  const totalSize = ref(0);
  const status = ref<LibraryStatus>("idle");
  const error = ref("");

  function recalcTotalSize(): void {
    totalSize.value = songs.value.reduce((sum, song) => sum + song.size, 0);
  }

  /** 载入列表；force 用于"重建索引"后强制刷新 */
  async function load(force = false): Promise<void> {
    if (status.value === "loading") return;
    if (status.value === "ready" && !force) return;

    status.value = "loading";
    try {
      const result = await fetchSongs();
      songs.value = result.songs;
      totalSize.value = result.totalSize;
      error.value = "";
      status.value = "ready";
    } catch (err) {
      // 保留已有列表（刷新失败不该把已看到的歌清空），只在页面上给出提示
      error.value = libraryErrorMessage(err);
      status.value = "error";
    }
  }

  /** 上传成功后插入本地列表，省一次全量请求（同 ID 视为更新） */
  function applyUploaded(song: Song): void {
    songs.value = [song, ...songs.value.filter((item) => item.id !== song.id)];
    recalcTotalSize();
  }

  /** 删除（LB-05）：接口成功才从列表剔除，失败抛给调用方提示 */
  async function remove(id: string): Promise<void> {
    await deleteSong(id);
    songs.value = songs.value.filter((song) => song.id !== id);
    recalcTotalSize();
  }

  function clearError(): void {
    error.value = "";
  }

  return { songs, totalSize, status, error, load, applyUploaded, remove, clearError };
});
