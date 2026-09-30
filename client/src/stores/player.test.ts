import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { Track } from "@qingting/shared";
import { usePlayerStore } from "./player";

/** 队列里的曲目：用 https 地址，避免单测触碰 Blob URL 释放（那是浏览器行为） */
function track(id: string, duration: number | null = null): Track {
  return {
    id,
    source: "local",
    url: `https://example.test/${id}`,
    title: `曲目 ${id}`,
    artist: "测试歌手",
    album: "本地文件",
    cover: null,
    duration,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("队列操作（PL-06）", () => {
  it("addTracks 追加曲目并返回新增条数", () => {
    const player = usePlayerStore();
    expect(player.addTracks([track("a"), track("b")])).toBe(2);
    expect(player.queue.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("同 ID 视为重复：跳过且不计入新增", () => {
    const player = usePlayerStore();
    player.addTracks([track("a")]);
    expect(player.addTracks([track("a"), track("b")])).toBe(1);
    expect(player.queue.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("removeAt 删掉当前曲之前的曲目时，当前索引跟着前移", () => {
    const player = usePlayerStore();
    player.addTracks([track("a"), track("b"), track("c")]);
    player.playAt(2);
    player.removeAt(0);
    expect(player.queue.map((item) => item.id)).toEqual(["b", "c"]);
    expect(player.currentTrack?.id).toBe("c");
  });

  it("removeAt 删掉当前曲时接着播下一位；删空则复位", () => {
    const player = usePlayerStore();
    player.addTracks([track("a"), track("b")]);
    player.playAt(0);
    player.removeAt(0);
    expect(player.currentTrack?.id).toBe("b");

    player.removeAt(0);
    expect(player.queue).toEqual([]);
    expect(player.currentIndex).toBe(-1);
    expect(player.playing).toBe(false);
  });

  it("clear 清空队列并复位播放状态", () => {
    const player = usePlayerStore();
    player.addTracks([track("a")]);
    player.playAt(0);
    player.clear();
    expect(player.queue).toEqual([]);
    expect(player.hasTrack).toBe(false);
    expect(player.progress).toBe(0);
    expect(player.duration).toBe(0);
  });
});

describe("播放与切歌（PL-01/02/05）", () => {
  it("playAt 载入指定曲目：更新索引、时长、进度归零", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 100), track("b", 200)]);
    player.playAt(1);
    expect(player.currentIndex).toBe(1);
    expect(player.currentTrack?.id).toBe("b");
    expect(player.duration).toBe(200);
    expect(player.progress).toBe(0);
  });

  it("未选曲时 toggle 从第一首开始播", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 100)]);
    player.toggle();
    expect(player.currentTrack?.id).toBe("a");
  });

  it("空队列时 toggle / next 不报错", () => {
    const player = usePlayerStore();
    expect(() => {
      player.toggle();
      player.next();
      player.prev();
    }).not.toThrow();
    expect(player.hasTrack).toBe(false);
  });

  it("顺序播放到末尾停下来（不再有下一首）", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10)]);
    player.mode = "seq";
    player.playAt(1);
    player.next();
    expect(player.currentIndex).toBe(1);
    expect(player.playing).toBe(false);
    expect(player.progress).toBe(0);
  });

  it("列表循环从末尾回到第一首", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10)]);
    player.mode = "list";
    player.playAt(1);
    player.next();
    expect(player.currentTrack?.id).toBe("a");
  });

  it("随机播放切到列表里的另一首", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10), track("c", 10)]);
    player.mode = "random";
    player.playAt(0);
    player.next();
    expect(player.currentTrack?.id).not.toBe("a");
  });

  it("无 audio 元素（如单测/降级环境）时上一首按索引回退", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10)]);
    player.playAt(1);
    player.prev();
    expect(player.currentTrack?.id).toBe("a");
  });

  it("cycleMode 循环切换四种模式并带上中文标签", () => {
    const player = usePlayerStore();
    expect(player.mode).toBe("list");
    player.cycleMode();
    expect([player.mode, player.modeLabel]).toEqual(["one", "单曲循环"]);
    player.cycleMode();
    expect(player.mode).toBe("random");
    player.cycleMode();
    expect(player.mode).toBe("seq");
    player.cycleMode();
    expect(player.mode).toBe("list");
  });
});

describe("进度与音量（PL-03/04）", () => {
  it("seekTo 夹在 0..时长之间", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 200)]);
    player.playAt(0);
    player.seekTo(500);
    expect(player.progress).toBe(200);
    player.seekTo(-5);
    expect(player.progress).toBe(0);
  });

  it("拖拽期间显示手指位置，松手才落到进度上（PL-03）", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 100)]);
    player.playAt(0);
    player.beginSeek(0.5);
    expect(player.seeking).toBe(true);
    expect(player.displaySeconds).toBe(50);
    expect(player.progress).toBe(0);

    player.endSeek();
    expect(player.seeking).toBe(false);
    expect(player.progress).toBe(50);
  });

  it("displayRatio 在时长未知时为 0，不产生 NaN", () => {
    const player = usePlayerStore();
    player.addTracks([track("a")]);
    player.playAt(0);
    expect(player.displayRatio).toBe(0);
  });

  it("setVolume 夹在 0..1，且非零时自动解除静音", () => {
    const player = usePlayerStore();
    player.toggleMute();
    expect(player.muted).toBe(true);
    player.setVolume(2);
    expect(player.volume).toBe(1);
    expect(player.muted).toBe(false);
    player.setVolume(-1);
    expect(player.volume).toBe(0);
  });

  it("toggleMute 来回切换", () => {
    const player = usePlayerStore();
    player.toggleMute();
    expect(player.muted).toBe(true);
    player.toggleMute();
    expect(player.muted).toBe(false);
  });
});

describe("时长回填（LC-04 前置）", () => {
  it("patchDuration 更新队列曲目，当前曲同步更新", () => {
    const player = usePlayerStore();
    player.addTracks([track("a"), track("b")]);
    player.playAt(0);
    player.patchDuration("a", 231);
    expect(player.queue[0]?.duration).toBe(231);
    expect(player.duration).toBe(231);
    player.patchDuration("b", 180);
    expect(player.duration).toBe(231);
  });

  it("未知 ID 不报错也不改动状态", () => {
    const player = usePlayerStore();
    expect(() => player.patchDuration("missing", 10)).not.toThrow();
  });
});
