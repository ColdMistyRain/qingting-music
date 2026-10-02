import { defineStore } from "pinia";
import { ref } from "vue";
import type { Song } from "@qingting/shared";
import { deleteSong, fetchSongs, libraryErrorMessage } from "@/api/songs";
import { usePlayerStore } from "@/stores/player";

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

  /**
   * 用最新的曲库信息校准队列里那几首云端曲目（AD-02）。
   * 队列是存盘的（PL-07）：刷新后恢复的那份里存的是**当时**的歌名、歌手、专辑，
   * 曲目信息被手动改过之后就会跟曲库对不上（“我改了名，刷新一下播放条又变回旧的”）。
   * 所以每次曲库加载完都拿它校准一次 —— 幂等，只动能对上的云端曲目（本地曲目的 id 不共享）。
   */
  function syncQueueMetadata(list: readonly Song[]): void {
    const player = usePlayerStore();
    const byId = new Map(list.map((song) => [song.id, song]));
    for (const track of player.queue) {
      if (track.source !== "server") continue;
      const song = byId.get(track.id);
      if (!song) continue;
      if (
        track.title === song.title &&
        track.artist === song.artist &&
        track.album === song.album
      ) {
        continue;
      }
      player.patchTrack(track.id, {
        title: song.title,
        artist: song.artist,
        album: song.album,
      });
    }
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
      syncQueueMetadata(result.songs);
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

  /**
   * 手动改完元信息 / 封面 / 歌词后（AD-02）：就地换掉列表里那一条（不动顺序，列表是按上传时间排的），
   * 顺带把**队列/正在播放**那一份也改掉 —— 曲目可能已经在队列里了，
   * 不同步的话会出现“列表改了、播放条上还是旧名字 / 旧封面”。
   *
   * `assets.lyrics` 是刚刚存下的歌词正文（粘贴或从文件读来的）：直接回填到 Track 上，
   * 省的再拉一次接口；没传就只同步标记（下一次开播会自己去取）。
   */
  function applyUpdated(song: Song, assets: { lyrics?: string } = {}): void {
    songs.value = songs.value.map((item) => (item.id === song.id ? song : item));
    usePlayerStore().patchTrack(song.id, {
      title: song.title,
      artist: song.artist,
      album: song.album,
      cover: song.coverUrl,
      hasLyrics: song.hasLyrics === true,
      ...(assets.lyrics ? { lyrics: assets.lyrics } : {}),
    });
  }

  function clearError(): void {
    error.value = "";
  }

  return {
    songs,
    totalSize,
    status,
    error,
    load,
    applyUploaded,
    applyUpdated,
    remove,
    clearError,
  };
});
