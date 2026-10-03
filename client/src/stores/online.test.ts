import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlinePlaylistInfo, OnlineTrack } from "@qingting/shared";

// store 的动作只经 api/online 这一层：桩掉它，测"拉没拉、什么时候拉、装没装进状态"
vi.mock("@/api/online", () => ({
  fetchOnlineAccount: vi.fn(),
  createOnlineQrLogin: vi.fn(),
  checkOnlineQrLogin: vi.fn(),
  logoutOnline: vi.fn(async () => undefined),
  fetchOnlineCollections: vi.fn(),
  fetchOnlineCollectionTracks: vi.fn(),
}));

import {
  checkOnlineQrLogin,
  fetchOnlineAccount,
  fetchOnlineCollectionTracks,
  fetchOnlineCollections,
  logoutOnline,
} from "@/api/online";
import { writeCollectionCache } from "@/utils/onlineCollectionCache";
import { useOnlineStore } from "./online";

/** node 环境没有 localStorage：会话就存在这里，测试直接看它的内容 */
const storage = new Map<string, string>();

beforeEach(() => {
  setActivePinia(createPinia());
  storage.clear();
  // resetAllMocks（而不是 clearAllMocks）：上一个用例挂起的 mockReturnValue 之类
  // 的实现会跨用例泄漏（clear 只清调用记录、不清实现），把"挂起直到手动 release"
  // 的实现带进下一个用例就是 5 秒超时 —— 实现全部打掉，每个用例显式给。
  vi.resetAllMocks();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    // clearCollectionCache 靠遍历清掉某音源的全部歌单缓存：桩要有 length 与 key()
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  });
  vi.mocked(fetchOnlineAccount).mockResolvedValue({ loggedIn: false, profile: null });
  // 给常用桩一个安全默认值（resetAllMocks 打掉了工厂里的实现）
  vi.mocked(logoutOnline).mockResolvedValue(undefined);
  vi.mocked(fetchOnlineCollections).mockResolvedValue({ playlists: [] });
  vi.mocked(fetchOnlineCollectionTracks).mockResolvedValue({ tracks: [] });
});

const TRACK: OnlineTrack = {
  id: "186016",
  title: "夜曲",
  artist: "周杰伦",
  album: "十一月的萧邦",
  duration: 226,
  cover: "https://p1.music.126.net/x.jpg",
  vipOnly: false,
};

describe("online store · 账号（ON-10，会话存浏览器 v6.31）", () => {
  it("扫码成功：会话写进本浏览器的 localStorage，界面即刻已登录", async () => {
    vi.mocked(checkOnlineQrLogin).mockResolvedValue({
      state: "success",
      cookie: ["MUSIC_U=abc", "__csrf_token=x"],
      profile: { userId: "77", nickname: "夜行客", avatarUrl: null },
    });
    const online = useOnlineStore();
    await online.checkLogin("KEY");

    expect(online.loggedIn).toBe(true);
    expect(online.profile?.nickname).toBe("夜行客");

    const stored = JSON.parse(storage.get("qt-online-session:netease")!);
    expect(stored.cookie).toEqual(["MUSIC_U=abc", "__csrf_token=x"]);
    expect(stored.provider).toBe("netease");
    expect(stored.loggedInAt).toBeTruthy();
  });

  it("扫码失败（未确认/过期）：不写任何会话，仍是未登录", async () => {
    vi.mocked(checkOnlineQrLogin).mockResolvedValue({
      state: "expired",
      cookie: [],
      profile: null,
    });
    const online = useOnlineStore();
    await online.checkLogin("KEY");

    expect(online.loggedIn).toBe(false);
    expect(storage.has("qt-online-session:netease")).toBe(false);
  });

  it("启动校验：音源说会话失效 → 清掉本地（界面回未登录，不拿死会话装已登录）", async () => {
    storage.set(
      "qt-online-session:netease",
      JSON.stringify({
        provider: "netease",
        cookie: ["MUSIC_U=dead"],
        profile: { userId: "1", nickname: "旧会话", avatarUrl: null },
        loggedInAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    vi.mocked(fetchOnlineAccount).mockResolvedValue({ loggedIn: false, profile: null });

    const online = useOnlineStore();
    await online.loadAccount();

    expect(online.loggedIn).toBe(false);
    expect(storage.has("qt-online-session:netease")).toBe(false);
  });

  it("启动校验：会话仍有效 → 保持登录，并把最新资料回写（昵称改了也跟得上）", async () => {
    storage.set(
      "qt-online-session:netease",
      JSON.stringify({
        provider: "netease",
        cookie: ["MUSIC_U=live"],
        profile: { userId: "77", nickname: "旧昵称", avatarUrl: null },
        loggedInAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    vi.mocked(fetchOnlineAccount).mockResolvedValue({
      loggedIn: true,
      profile: { userId: "77", nickname: "新昵称", avatarUrl: null },
    });

    const online = useOnlineStore();
    await online.loadAccount();

    expect(online.loggedIn).toBe(true);
    expect(online.profile?.nickname).toBe("新昵称");
    const stored = JSON.parse(storage.get("qt-online-session:netease")!);
    expect(stored.profile.nickname).toBe("新昵称");
  });

  it("退出登录：先让上游注销这个会话，再清本地（清完回未登录、歌单缓存也没了）", async () => {
    vi.mocked(checkOnlineQrLogin).mockResolvedValue({
      state: "success",
      cookie: ["MUSIC_U=abc"],
      profile: { userId: "77", nickname: "夜行客", avatarUrl: null },
    });
    const online = useOnlineStore();
    await online.checkLogin("KEY");

    await online.logout();

    expect(logoutOnline).toHaveBeenCalledWith("netease");
    expect(online.loggedIn).toBe(false);
    expect(storage.has("qt-online-session:netease")).toBe(false);
    expect(online.playlists).toEqual([]);
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
        vipOnly: false,
      },
    ]);
  });

  it("再次点开有缓存的歌单：纯本地加载，一次请求都不发（v6.35 补 4）", async () => {
    vi.mocked(fetchOnlineCollections).mockResolvedValue({ playlists: PLAYLISTS });
    vi.mocked(fetchOnlineCollectionTracks).mockClear();
    vi.mocked(fetchOnlineCollectionTracks).mockResolvedValue({ tracks: [TRACK] });
    const online = useOnlineStore();
    await online.loadPlaylists();
    await online.openPlaylist("100"); // 第一遍：无缓存，正常拉取并写缓存
    expect(fetchOnlineCollectionTracks).toHaveBeenCalledTimes(1);

    // 预埋一份"旧缓存"：再点开必须直接用缓存，不追着音源对一遍
    // （想跟音源对一遍，有显式的「刷新列表」按钮）
    const STALE = { ...TRACK, id: "1", title: "缓存里的旧版本" };
    writeCollectionCache("netease", "100", [STALE]);
    vi.mocked(fetchOnlineCollectionTracks).mockClear();

    await online.openPlaylist("100");

    expect(online.collectionStatus).toBe("ready");
    expect(online.collectionTracks.map((t) => t.title)).toEqual(["缓存里的旧版本"]);
    expect(fetchOnlineCollectionTracks).not.toHaveBeenCalled();

    // 显式刷新才会发请求，并更新缓存与列表
    await online.refreshPlaylist("100");
    expect(fetchOnlineCollectionTracks).toHaveBeenCalledTimes(1);
    expect(online.collectionTracks.map((t) => t.title)).toEqual(["夜曲"]);
    void online.closePlaylist();
  });

  it("无缓存时打开新歌单会清掉上一份的曲目（加载分支才接得住，页面中间给进度）", async () => {
    vi.mocked(fetchOnlineCollections).mockResolvedValue({ playlists: PLAYLISTS });
    vi.mocked(fetchOnlineCollectionTracks).mockResolvedValueOnce({ tracks: [TRACK] });
    const online = useOnlineStore();
    await online.loadPlaylists();
    await online.openPlaylist("100");
    expect(online.collectionTracks).toHaveLength(1);

    let release!: (value: { tracks: OnlineTrack[] }) => void;
    vi.mocked(fetchOnlineCollectionTracks).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    // 不 await：openPlaylist 要等这份挂起的响应，手动放行后再等状态到位
    void online.openPlaylist("200");
    await vi.waitFor(() => expect(online.collectionStatus).toBe("loading"));
    const during = { status: online.collectionStatus, tracks: online.collectionTracks.length };
    release({ tracks: [TRACK, TRACK] });
    await vi.waitFor(() => expect(online.collectionStatus).toBe("ready"));
    expect(during).toEqual({ status: "loading", tracks: 0 });
    expect(online.collectionTracks).toHaveLength(2);
    void online.closePlaylist();
  });

  it("退出登录时清掉歌单内容缓存（缓存也是账号数据）", async () => {
    vi.mocked(fetchOnlineCollections).mockResolvedValue({ playlists: PLAYLISTS });
    vi.mocked(fetchOnlineCollectionTracks).mockResolvedValue({ tracks: [TRACK] });
    const online = useOnlineStore();
    await online.openPlaylist("100");
    expect(storage.has("qt-online-collection:netease:100")).toBe(true);

    await online.logout();
    expect(storage.has("qt-online-collection:netease:100")).toBe(false);
  });

  it("refreshPlaylist 绕过缓存强制重拉（「刷新列表」按钮）", async () => {
    vi.mocked(fetchOnlineCollections).mockResolvedValue({ playlists: PLAYLISTS });
    vi.mocked(fetchOnlineCollectionTracks).mockResolvedValue({ tracks: [TRACK] });
    const online = useOnlineStore();
    await online.openPlaylist("100"); // 先走一遍：缓存里是 TRACK

    // 预埋旧缓存 + 让网络回一份不同的新数据
    writeCollectionCache("netease", "100", [{ ...TRACK, title: "缓存旧版" }]);
    vi.mocked(fetchOnlineCollectionTracks).mockResolvedValue({
      tracks: [{ ...TRACK, title: "音源新版" }],
    });

    await online.refreshPlaylist("100");

    // 不展示缓存旧版，直接是音源新数据；缓存也被更新
    expect(online.collectionTracks.map((t) => t.title)).toEqual(["音源新版"]);
    const stored = JSON.parse(storage.get("qt-online-collection:netease:100")!).tracks[0].title;
    expect(stored).toBe("音源新版");
    void online.closePlaylist();
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
