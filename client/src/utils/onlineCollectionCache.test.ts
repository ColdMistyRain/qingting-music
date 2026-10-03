import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineTrack } from "@qingting/shared";
import {
  clearCollectionCache,
  COLLECTION_CACHE_TTL_MS,
  readCollectionCache,
  writeCollectionCache,
} from "./onlineCollectionCache";

/** 歌单缓存（v6.34）：node 环境给一个够用的内存版 localStorage */
const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
    key: (index: number) => [...memory.keys()][index] ?? null,
    get length() {
      return memory.size;
    },
  });
});

function track(id: string): OnlineTrack {
  return {
    id,
    title: `歌 ${id}`,
    artist: "某人",
    album: "专辑",
    duration: 200,
    cover: null,
    vipOnly: false,
  };
}

describe("readCollectionCache / writeCollectionCache", () => {
  it("写入后原样读回（provider、playlistId、tracks）", () => {
    writeCollectionCache("netease", "100", [track("a"), track("b")]);
    const read = readCollectionCache("netease", "100");
    expect(read?.provider).toBe("netease");
    expect(read?.playlistId).toBe("100");
    expect(read?.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(read?.cachedAt).toBeTruthy();
  });

  it("按歌单分槽：读别的歌单拿不到", () => {
    writeCollectionCache("netease", "100", [track("a")]);
    expect(readCollectionCache("netease", "200")).toBeNull();
  });

  it("没写过 / JSON 坏了 / 形状不对，返回 null", () => {
    expect(readCollectionCache("netease", "100")).toBeNull();

    memory.set("qt-online-collection:netease:100", "{{{ 坏了");
    expect(readCollectionCache("netease", "100")).toBeNull();

    memory.set(
      "qt-online-collection:netease:100",
      JSON.stringify({ provider: "kugou", playlistId: "100", tracks: [] }),
    );
    expect(readCollectionCache("netease", "100")).toBeNull();

    memory.set(
      "qt-online-collection:netease:100",
      JSON.stringify({ provider: "netease", playlistId: "100", tracks: [{ id: 1 }] }),
    );
    expect(readCollectionCache("netease", "100")).toBeNull();
  });

  it("缓存有过期时间（v6.35 补 5）：超过 24 小时视为无缓存，时间坏掉也一样", () => {
    writeCollectionCache("netease", "100", [track("a")]);

    // 新鲜：正常读回
    expect(readCollectionCache("netease", "100")).not.toBeNull();

    // 过期（25 小时前写入）：视为无缓存
    const expired = JSON.parse(memory.get("qt-online-collection:netease:100")!);
    expired.cachedAt = new Date(Date.now() - COLLECTION_CACHE_TTL_MS - 60_000).toISOString();
    memory.set("qt-online-collection:netease:100", JSON.stringify(expired));
    expect(readCollectionCache("netease", "100")).toBeNull();

    // cachedAt 坏掉：同样视为过期（宁可靠网络，不可拿时间不明的数据装新鲜）
    const broken = JSON.parse(memory.get("qt-online-collection:netease:100")!);
    broken.cachedAt = "不是日期";
    memory.set("qt-online-collection:netease:100", JSON.stringify(broken));
    expect(readCollectionCache("netease", "100")).toBeNull();
  });

  it("clearCollectionCache 只清那个音源的歌单缓存", () => {
    writeCollectionCache("netease", "100", [track("a")]);
    writeCollectionCache("kugou", "200", [track("b")]);
    clearCollectionCache("netease");
    expect(readCollectionCache("netease", "100")).toBeNull();
    expect(readCollectionCache("kugou", "200")).not.toBeNull();
  });
});
