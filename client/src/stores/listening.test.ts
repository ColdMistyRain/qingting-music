import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListeningData, PlaylistItem } from "@qingting/shared";
import { addFavorite, fetchListening, recordRecent, removeFavorite } from "@/api/listening";
import { useListeningStore } from "./listening";

vi.mock("@/api/listening", () => ({
  fetchListening: vi.fn(async () => ({ favorites: [], recent: [] })),
  addFavorite: vi.fn(async (item: PlaylistItem) => ({ favorites: [item], recent: [] })),
  removeFavorite: vi.fn(async () => ({ favorites: [], recent: [] })),
  recordRecent: vi.fn(async (item: PlaylistItem) => ({
    favorites: [],
    recent: [{ ...item, playedAt: "2026-10-02T00:00:00.000Z" }],
  })),
  clearRecent: vi.fn(async () => ({ favorites: [], recent: [] })),
  listeningErrorMessage: (error: unknown) => String(error),
}));

const cloud: PlaylistItem = {
  source: "server",
  refId: "song-1",
  title: "光辉岁月",
  artist: "BEYOND",
  duration: 303,
};
const local: PlaylistItem = { source: "local", refId: "林晚|夜行", title: "夜行", artist: "林晚" };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("收藏与最近播放 store（PS-05）", () => {
  it("载入：两份列表一起拿，状态转 ready", async () => {
    vi.mocked(fetchListening).mockResolvedValueOnce({ favorites: [cloud], recent: [] });
    const store = useListeningStore();

    await store.load();

    expect(store.status).toBe("ready");
    expect(store.isFavorite(cloud)).toBe(true);
    expect(store.isFavorite(local)).toBe(false);
  });

  it("收藏 → 取消收藏：两次点同一个入口，服务端返回的那一份回填", async () => {
    const store = useListeningStore();

    await store.toggleFavorite(cloud);
    expect(addFavorite).toHaveBeenCalledWith(cloud);
    expect(store.isFavorite(cloud)).toBe(true);

    await store.toggleFavorite(cloud);
    expect(removeFavorite).toHaveBeenCalledWith("server:song-1");
    expect(store.isFavorite(cloud)).toBe(false);
  });

  it("同一条在请求还没回来之前连点：第二次直接忽略（不会发出相反的两次请求）", async () => {
    // 用一个“可由测试放行”的 Promise 卡住请求（写成对象属性，避免 let 的收窄判定）
    const gate: { release: () => void } = { release: () => {} };
    vi.mocked(addFavorite).mockImplementationOnce(
      (item) =>
        new Promise<ListeningData>((resolve) => {
          gate.release = () => resolve({ favorites: [item], recent: [] });
        }),
    );
    const store = useListeningStore();

    const first = store.toggleFavorite(cloud);
    const second = store.toggleFavorite(cloud);
    expect(addFavorite).toHaveBeenCalledTimes(1);
    expect(store.isPending(cloud)).toBe(true);

    gate.release();
    await Promise.all([first, second]);
    expect(store.isFavorite(cloud)).toBe(true);
  });

  it("记一次播放：写进最近播放；失败保持安静（不打扰听歌）", async () => {
    const store = useListeningStore();

    await store.recordPlay(cloud);
    expect(store.recent.map((entry) => entry.title)).toEqual(["光辉岁月"]);

    vi.mocked(recordRecent).mockRejectedValueOnce(new Error("offline"));
    await store.recordPlay(local);
    expect(store.error).toBe("");
  });

  it("载入失败：状态转 error 并给可读提示，但不把已有收藏清空", async () => {
    vi.mocked(fetchListening)
      .mockResolvedValueOnce({ favorites: [cloud], recent: [] })
      .mockRejectedValueOnce(new Error("boom"));
    const store = useListeningStore();
    await store.load();

    await store.load(true);

    expect(store.status).toBe("error");
    expect(store.favorites).toHaveLength(1);
    expect(store.error).toContain("boom");
  });

  it("收藏失败：错误说出来，列表保持原样", async () => {
    vi.mocked(addFavorite).mockRejectedValueOnce(new Error("boom"));
    const store = useListeningStore();

    await store.toggleFavorite(cloud);

    expect(store.error).toContain("boom");
    expect(store.favorites).toEqual([]);
    expect(store.isPending(cloud)).toBe(false);
  });
});
