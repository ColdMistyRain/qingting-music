import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Song, Track } from "@qingting/shared";
import { usePlayerStore } from "./player";
import { useLibraryStore } from "./library";

function song(id: string, size = 100): Song {
  return {
    id,
    title: `曲目 ${id}`,
    artist: "歌手",
    album: "专辑",
    duration: 120,
    coverUrl: null,
    originalName: `${id}.mp3`,
    storedName: `${id}.mp3`,
    size,
    uploadedAt: "2026-09-30T10:00:00.000Z",
  };
}

/** 用 stub 顶掉 fetch，只关心 store 的行为（正常 + 异常路径） */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => Promise.resolve(handler(url, init)));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.unstubAllGlobals();
});

describe("曲库 store", () => {
  it("加载成功：写入列表与占用空间，状态转为 ready", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        code: 0,
        data: { songs: [song("a", 300), song("b", 100)], totalSize: 400 },
      }),
    );
    const library = useLibraryStore();

    await library.load();

    expect(library.status).toBe("ready");
    expect(library.songs.map((s) => s.id)).toEqual(["a", "b"]);
    expect(library.totalSize).toBe(400);
    expect(library.error).toBe("");
  });

  it("已加载过不再重复请求，force 时才重新拉", async () => {
    const fetchMock = vi.fn(() =>
      jsonResponse(200, { code: 0, data: { songs: [], totalSize: 0 } }),
    );
    stubFetch(fetchMock as never);
    const library = useLibraryStore();

    await library.load();
    await library.load();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await library.load(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("接口失败：状态转 error 并给出可读提示，且不清空已有列表", async () => {
    stubFetch(() => jsonResponse(200, { code: 0, data: { songs: [song("a")], totalSize: 100 } }));
    const library = useLibraryStore();
    await library.load();

    stubFetch(() => jsonResponse(500, { code: 500, message: "服务器内部错误" }));
    await library.load(true);

    expect(library.status).toBe("error");
    expect(library.error).toBe("服务器内部错误");
    expect(library.songs.map((s) => s.id)).toEqual(["a"]);
  });

  it("401 时给的是登录提示，而不是后端原文", async () => {
    stubFetch(() => jsonResponse(401, { code: 401, message: "请先登录" }));
    const library = useLibraryStore();

    await library.load();

    expect(library.error).toContain("重新登录");
  });

  it("上传成功后就地插入，不重新拉全量，并重算占用空间", async () => {
    stubFetch(() =>
      jsonResponse(200, { code: 0, data: { songs: [song("a", 100)], totalSize: 100 } }),
    );
    const library = useLibraryStore();
    await library.load();

    library.applyUploaded(song("b", 200));

    expect(library.songs.map((s) => s.id)).toEqual(["b", "a"]);
    expect(library.totalSize).toBe(300);
  });

  it("删除成功：本地同步剔除；接口失败：保留该曲并抛出给页面提示", async () => {
    stubFetch(() =>
      jsonResponse(200, {
        code: 0,
        data: { songs: [song("a", 100), song("b", 200)], totalSize: 300 },
      }),
    );
    const library = useLibraryStore();
    await library.load();

    stubFetch((url, init) => {
      if (init?.method === "DELETE" && url.endsWith("/api/songs/a")) {
        return jsonResponse(200, { code: 0, data: { id: "a" } });
      }
      return jsonResponse(404, { code: 404, message: "曲目不存在" });
    });

    await library.remove("a");
    expect(library.songs.map((s) => s.id)).toEqual(["b"]);
    expect(library.totalSize).toBe(200);

    await expect(library.remove("b")).rejects.toThrow("曲目不存在");
    expect(library.songs.map((s) => s.id)).toEqual(["b"]);
  });
});

describe("曲库 store · applyUpdated（AD-02 编辑元信息）", () => {
  /** 队列里的云端曲目：id 与曲库里的 song.id 同一套（播放/歌词都按它找） */
  function cloudTrack(overrides: Partial<Track> = {}): Track {
    return {
      id: "a",
      source: "server",
      url: "/audio/a.mp3",
      title: "曲目 a",
      artist: "歌手",
      album: "专辑",
      cover: null,
      duration: 120,
      ...overrides,
    };
  }

  it("就地换掉那一条，顺序不变、占用空间也不重算", () => {
    const library = useLibraryStore();
    library.songs = [song("a", 100), song("b", 200)];
    library.totalSize = 300;

    library.applyUpdated({ ...song("a", 100), title: "改过的名字", artist: "新歌手" });

    expect(library.songs.map((s) => s.id)).toEqual(["a", "b"]);
    expect(library.songs[0]).toMatchObject({ title: "改过的名字", artist: "新歌手" });
    expect(library.totalSize).toBe(300);
  });

  it("队列里那一份也跟着改：不然列表改了、播放条上还是旧名字", () => {
    const library = useLibraryStore();
    const player = usePlayerStore();
    library.songs = [song("a", 100)];
    player.setQueue([cloudTrack()]);

    library.applyUpdated({ ...song("a", 100), title: "改过的名字" });

    expect(player.queue[0].title).toBe("改过的名字");
  });

  it("队列里没有这条（只改了别的歌）：不会凭空塞进去", () => {
    const library = useLibraryStore();
    const player = usePlayerStore();
    library.songs = [song("a", 100)];
    player.setQueue([cloudTrack({ id: "b" })]);

    library.applyUpdated({ ...song("a", 100), title: "改过的名字" });

    expect(player.queue).toHaveLength(1);
    expect(player.queue[0].title).toBe("曲目 a");
  });

  it("列表还没加载完（列表为空）：不新增行，只同步队列", () => {
    const library = useLibraryStore();
    const player = usePlayerStore();
    player.setQueue([cloudTrack()]);

    library.applyUpdated({ ...song("a", 100), title: "改过的名字" });

    expect(library.songs).toEqual([]);
    expect(player.queue[0].title).toBe("改过的名字");
  });

  it("加载曲库时校准队列：刷新后恢复的存档里可能还是旧名字", async () => {
    const player = usePlayerStore();
    // 播放存档里存的是“改名前”那一份（歌名/歌手/专辑都是旧的）
    player.setQueue([
      cloudTrack({ title: "曲目 a", artist: "歌手", album: "专辑" }),
      { ...cloudTrack({ id: "local-1" }), source: "local", title: "本地歌" },
    ]);
    stubFetch(() =>
      jsonResponse(200, {
        code: 0,
        data: {
          songs: [{ ...song("a", 100), title: "改过的名字", artist: "新歌手", album: "新专辑" }],
          totalSize: 100,
        },
      }),
    );
    const library = useLibraryStore();

    await library.load();

    expect(player.queue[0]).toMatchObject({
      title: "改过的名字",
      artist: "新歌手",
      album: "新专辑",
    });
    expect(player.queue[1].title).toBe("本地歌"); // 本地曲目不参与（id 不共享，别乱改）
  });
});
