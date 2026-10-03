import { describe, expect, it } from "vitest";
import type { OnlineTrack } from "@qingting/shared";
import {
  ONLINE_EMPTY_URL,
  onlineCoverUrl,
  onlineProviderLabel,
  parseOnlineTrackId,
  toOnlineTrack,
} from "./onlineTracks";

const INFO: OnlineTrack = {
  id: "186016",
  title: "夜曲",
  artist: "周杰伦",
  album: "十一月的萧邦",
  duration: 226,
  cover: "https://p1.music.126.net/x/1.jpg",
  vipOnly: false,
};

describe("toOnlineTrack（搜索结果 → 播放器曲目）", () => {
  it("id 拼成 provider:id 引用键；url 留空（开播前才解析直链）", () => {
    const track = toOnlineTrack("netease", INFO);
    expect(track.id).toBe("netease:186016");
    expect(track.source).toBe("online");
    expect(track.url).toBe(ONLINE_EMPTY_URL);
    expect(track.title).toBe("夜曲");
    expect(track.duration).toBe(226);
    // VIP 标记随曲目进列表：行组件据此显示「试听」标（v6.33）
    expect(track.vipOnly).toBe(false);
  });

  it("vipOnly=true 的曲目带上标记（行组件显示试听标）", () => {
    const track = toOnlineTrack("netease", { ...INFO, vipOnly: true });
    expect(track.vipOnly).toBe(true);
  });

  it("unavailable=true 的曲目带上标记（行组件显示无版权标，v6.35 补 6）", () => {
    const track = toOnlineTrack("netease", { ...INFO, unavailable: true });
    expect(track.unavailable).toBe(true);
  });

  it("封面换成后端代理地址（取色要 same-origin），不直接用第三方直链", () => {
    expect(toOnlineTrack("netease", INFO).cover).toBe(
      onlineCoverUrl("netease", "https://p1.music.126.net/x/1.jpg"),
    );
    expect(toOnlineTrack("netease", { ...INFO, cover: null }).cover).toBeNull();
  });
});

describe("parseOnlineTrackId（provider:id 引用键）", () => {
  it("正常拆出 provider 与音源内 id；音源内 id 自己也可以带冒号", () => {
    expect(parseOnlineTrackId("netease:186016")).toEqual({ provider: "netease", nativeId: "186016" });
    expect(parseOnlineTrackId("kugou:a:b")).toEqual({ provider: "kugou", nativeId: "a:b" });
  });

  it("形状不对一律 null：没冒号、空段、云端 id 冒充", () => {
    expect(parseOnlineTrackId("netease:")).toBeNull();
    expect(parseOnlineTrackId(":186016")).toBeNull();
    expect(parseOnlineTrackId("186016")).toBeNull();
    expect(parseOnlineTrackId("")).toBeNull();
  });
});

describe("onlineProviderLabel（来源列的音源显示名，v6.35 补 3）", () => {
  it("已收录的音源给中文名", () => {
    expect(onlineProviderLabel("netease:186016")).toBe("网易云");
  });

  it("没收录的音源显示它的 id；形状不对给 null（调用方退回「在线」）", () => {
    expect(onlineProviderLabel("qq:1")).toBe("qq");
    expect(onlineProviderLabel("bad-shape")).toBeNull();
  });
});

describe("onlineCoverUrl（封面代理）", () => {
  it("provider 与原始直链都编码进查询参数", () => {
    expect(onlineCoverUrl("netease", "https://p1.music.126.net/a b.jpg?param=300y300")).toBe(
      `/api/online/netease/cover?url=${encodeURIComponent("https://p1.music.126.net/a b.jpg?param=300y300")}`,
    );
  });
});
