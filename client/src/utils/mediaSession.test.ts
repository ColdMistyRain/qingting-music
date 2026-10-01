import { describe, expect, it } from "vitest";
import {
  applyMetadata,
  applyPlaybackState,
  applyPosition,
  attachActions,
  buildMetadata,
  buildPositionState,
  MEDIA_ACTIONS,
} from "./mediaSession";

describe("buildMetadata", () => {
  it("没有曲目时什么都不写（返回 null）", () => {
    expect(buildMetadata(null)).toBeNull();
  });

  it("只给歌名时只写歌名：空字段省略，锁屏不会多出一行空白", () => {
    expect(buildMetadata({ title: "夜曲" })).toEqual({ title: "夜曲" });
  });

  it("有歌手与专辑时一并写上", () => {
    expect(buildMetadata({ title: "夜曲", artist: "周杰伦", album: "十一月的萧邦" })).toEqual({
      title: "夜曲",
      artist: "周杰伦",
      album: "十一月的萧邦",
    });
  });

  it("有封面时给一条 artwork（带 sizes 建议、不写 type）", () => {
    const meta = buildMetadata({ title: "夜曲", cover: "/covers/abc.jpg" });
    expect(meta?.artwork).toEqual([{ src: "/covers/abc.jpg", sizes: "512x512" }]);
    expect(meta?.artwork?.[0]).not.toHaveProperty("type");
  });

  it("没有封面时不带 artwork（空数组也没必要）", () => {
    expect(buildMetadata({ title: "夜曲" })).not.toHaveProperty("artwork");
  });
});

describe("buildPositionState", () => {
  it("时长未知（0）时不上报 —— 引擎会抛异常", () => {
    expect(buildPositionState(0, 0)).toBeNull();
  });

  it("时长/位置是 NaN 或 Infinity 时不上报", () => {
    expect(buildPositionState(Number.NaN, 1)).toBeNull();
    expect(buildPositionState(180, Number.NaN)).toBeNull();
    expect(buildPositionState(Number.POSITIVE_INFINITY, 1)).toBeNull();
  });

  it("时长与位置都合法时原样上报，playbackRate 恒为 1", () => {
    expect(buildPositionState(180, 42.5)).toEqual({
      duration: 180,
      position: 42.5,
      playbackRate: 1,
    });
  });

  it("位置超过时长时夹取到时长（丢弃只会让锁屏停在旧值）", () => {
    expect(buildPositionState(180, 200)?.position).toBe(180);
  });

  it("位置为负时夹取到 0（浮点误差会造成 -0.001 这种值）", () => {
    expect(buildPositionState(180, -0.001)?.position).toBe(0);
  });
});

describe("无 mediaSession 的引擎（node 测试环境 / 老浏览器）", () => {
  it("写元数据不报错（整体跳过，而不是靠 catch 兜）", () => {
    expect(() => applyMetadata({ title: "夜曲", cover: "/x.jpg" })).not.toThrow();
  });

  it("写播放状态不报错", () => {
    expect(() => applyPlaybackState(true)).not.toThrow();
  });

  it("写进度不报错", () => {
    expect(() => applyPosition(180, 10)).not.toThrow();
  });

  it("注册动作返回一个可调用的解绑函数", () => {
    const handlers = {
      play: () => {},
      pause: () => {},
      next: () => {},
      prev: () => {},
      seekBy: () => {},
    };
    const detach = attachActions(handlers);
    expect(typeof detach).toBe("function");
    expect(() => detach()).not.toThrow();
  });

  it("动作清单覆盖 RT-04 要求的四个 + 快退快进", () => {
    expect(MEDIA_ACTIONS).toEqual([
      "play",
      "pause",
      "nexttrack",
      "previoustrack",
      "seekbackward",
      "seekforward",
    ]);
  });
});
