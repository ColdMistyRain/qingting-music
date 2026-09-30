import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Song } from "@qingting/shared";
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
    stubFetch(() => jsonResponse(200, { code: 0, data: { songs: [song("a", 300), song("b", 100)], totalSize: 400 } }));
    const library = useLibraryStore();

    await library.load();

    expect(library.status).toBe("ready");
    expect(library.songs.map((s) => s.id)).toEqual(["a", "b"]);
    expect(library.totalSize).toBe(400);
    expect(library.error).toBe("");
  });

  it("已加载过不再重复请求，force 时才重新拉", async () => {
    const fetchMock = vi.fn(() => jsonResponse(200, { code: 0, data: { songs: [], totalSize: 0 } }));
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
    stubFetch(() => jsonResponse(200, { code: 0, data: { songs: [song("a", 100)], totalSize: 100 } }));
    const library = useLibraryStore();
    await library.load();

    library.applyUploaded(song("b", 200));

    expect(library.songs.map((s) => s.id)).toEqual(["b", "a"]);
    expect(library.totalSize).toBe(300);
  });

  it("删除成功：本地同步剔除；接口失败：保留该曲并抛出给页面提示", async () => {
    stubFetch(() => jsonResponse(200, { code: 0, data: { songs: [song("a", 100), song("b", 200)], totalSize: 300 } }));
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
