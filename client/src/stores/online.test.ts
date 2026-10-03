import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlinePlaylistInfo, OnlineTrack } from "@qingting/shared";

// store 的动作只经 api/online 这一层：桩掉它，测“拉没拉、什么时候拉、装没装进状态”
vi.mock("@/api/online", () => ({
  fetchOnlineAccount: vi.fn(),
  createOnlineQrLogin: vi.fn(),
  checkOnlineQrLogin: vi.fn(),
  logoutOnline: vi.fn(async () => undefined),
  fetchOnlineCollections: vi.fn(),
  fetchOnlineCollectionTracks: vi.fn(),
}));

import {
  fetchOnlineAccount,
  fetchOnlineCollectionTracks,
  fetchOnlineCollections,
} from "@/api/online";
import { useOnlineStore } from "./online";

const TRACK: OnlineTrack = {
  id: "186016",
  title: "夜曲",
  artist: "周杰伦",
  album: "十一月的萧邦",
  duration: 226,
  cover: "https://p1.music.126.net/x.jpg",
  vipOnly: false,
};

vi.mocked(fetchOnlineAccount).mockResolvedValue({
  loggedIn: true,
  profile: { userId: "77", nickname: "夜行客", avatarUrl: null },
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("online store · 账号（ON-10）", () => {
  it("loadAccount 拉账号态；成功后 loggedIn / profile 可用", async () => {
    const online = useOnlineStore();
    await online.loadAccount();

    expect(online.loggedIn).toBe(true);
    expect(online.profile?.nickname).toBe("夜行客");
  });

  it("拉取失败只记错误态，不打断页面", async () => {
    vi.mocked(fetchOnlineAccount).mockRejectedValueOnce(new Error("后端断了"));
    const online = useOnlineStore();
    await online.loadAccount();

    expect(online.accountStatus).toBe("error");
    expect(online.loggedIn).toBe(false);
  });
});

describe("online store · 收藏夹（ON-10）", () => {
  const PLAYLISTS: OnlinePlaylistInfo[] = [
    { id: "100", name: "我喜欢的音乐", cover: null, trackCount: 1 },
  ];

  it("openPlaylist 把曲目按统一格式装进 store（provider:id 引用键、url 空串）", async () => {
    vi.mocked(fetchOnlineCollections).mockResolvedValue({ playlists: PLAYLISTS });
    vi.mocked(fetchOnlineCollectionTracks).mockResolvedValue({ tracks: [TRACK] });

    const online = useOnlineStore();
    await online.loadPlaylists();
    await online.openPlaylist("100");

    expect(online.activePlaylistId).toBe("100");
    expect(online.activePlaylist?.name).toBe("我喜欢的音乐");
    expect(online.collectionTracks).toEqual([
      {
        id: "netease:186016",
        source: "online",
        url: "",
        title: "夜曲",
        artist: "周杰伦",
        album: "十一月的萧邦",
        cover: "/api/online/netease/cover?url=" + encodeURIComponent("https://p1.music.126.net/x.jpg"),
        duration: 226,
      },
    ]);
  });

  it("closePlaylist 收起歌单：曲目清空、回到搜索态", async () => {
    vi.mocked(fetchOnlineCollections).mockResolvedValue({ playlists: PLAYLISTS });
    vi.mocked(fetchOnlineCollectionTracks).mockResolvedValue({ tracks: [TRACK] });
    const online = useOnlineStore();
    await online.loadPlaylists();
    await online.openPlaylist("100");

    online.closePlaylist();
    expect(online.activePlaylistId).toBeNull();
    expect(online.collectionTracks).toEqual([]);
  });

  it("歌单读失败时记下原因；未登录（401）给一句能照着做的话", async () => {
    const { ApiError } = await import("@/api/http");
    vi.mocked(fetchOnlineCollections).mockRejectedValue(
      new ApiError(401, 401, "还没有登录这个音源的账号"),
    );
    const online = useOnlineStore();
    await online.loadPlaylists();

    expect(online.playlistsStatus).toBe("error");
    expect(online.playlistsError).toBe("还没有登录网易云账号");
  });
});
