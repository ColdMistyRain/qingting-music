import { describe, expect, it } from "vitest";
import type { Track } from "@qingting/shared";
import {
  isResumableUrl,
  MAX_PERSISTED_TRACKS,
  parseSnapshot,
  sanitizeSnapshot,
  type PlayerSnapshot,
} from "./playerState";

/** PL-07 / PRD 11.2：存档的裁剪与容错解析（正常 + 异常路径） */

function track(id: string, url: string, duration: number | null = 200): Track {
  return {
    id,
    source: url.startsWith("blob:") ? "local" : "server",
    url,
    title: `歌 ${id}`,
    artist: "歌手",
    album: "专辑",
    cover: null,
    duration,
  };
}

function snapshot(partial: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    mode: "list",
    volume: 0.8,
    muted: false,
    queue: [],
    currentIndex: -1,
    seconds: 0,
    droppedLocalTracks: 0,
    ...partial,
  };
}

describe("isResumableUrl（刷新后还能不能续上）", () => {
  it("本地 Blob 地址不可恢复", () => {
    expect(isResumableUrl("blob:http://localhost:5173/abc")).toBe(false);
  });

  it("服务器路径 / 绝对地址 / 空串", () => {
    expect(isResumableUrl("/audio/abc.mp3")).toBe(true);
    expect(isResumableUrl("https://example.com/a.mp3")).toBe(true);
    expect(isResumableUrl("")).toBe(false);
  });
});

describe("sanitizeSnapshot（存盘前整理）", () => {
  it("丢掉不可恢复的曲目，云端曲目保留，并记下丢了几首本地曲目", () => {
    const result = sanitizeSnapshot(
      snapshot({
        queue: [track("a", "blob:http://localhost/1"), track("b", "/audio/2.mp3")],
        currentIndex: 1,
      }),
    );

    expect(result.queue.map((t) => t.id)).toEqual(["b"]);
    expect(result.droppedLocalTracks).toBe(1);
  });

  it("坏条目（缺 id / 不是对象）不算“本地曲目”，不污染提示数", () => {
    const result = sanitizeSnapshot(
      snapshot({
        queue: [null as unknown as Track, track("a", "blob:x"), track("b", "/audio/2.mp3")],
        currentIndex: 2,
      }),
    );

    expect(result.droppedLocalTracks).toBe(1);
  });

  it("丢曲目后 currentIndex 要重新对到**同一个曲目**", () => {
    const result = sanitizeSnapshot(
      snapshot({
        queue: [track("a", "blob:x"), track("b", "/audio/2.mp3"), track("c", "/audio/3.mp3")],
        currentIndex: 2,
        seconds: 42,
      }),
    );

    expect(result.queue.map((t) => t.id)).toEqual(["b", "c"]);
    expect(result.currentIndex).toBe(1);
    expect(result.seconds).toBe(42);
  });

  it("当前曲目自己被丢掉时：没有当前曲目，进度归零", () => {
    const result = sanitizeSnapshot(
      snapshot({
        queue: [track("a", "blob:x"), track("b", "/audio/2.mp3")],
        currentIndex: 0,
        seconds: 99,
      }),
    );

    expect(result.currentIndex).toBe(-1);
    expect(result.seconds).toBe(0);
  });

  it("进度夹取：负数归零、超出时长截到时长、时长未知时只保证非负", () => {
    const queue = [track("a", "/audio/a.mp3", 100), track("b", "/audio/b.mp3", null)];

    expect(sanitizeSnapshot(snapshot({ queue, currentIndex: 0, seconds: -5 })).seconds).toBe(0);
    expect(sanitizeSnapshot(snapshot({ queue, currentIndex: 0, seconds: 999 })).seconds).toBe(100);
    expect(sanitizeSnapshot(snapshot({ queue, currentIndex: 1, seconds: 999 })).seconds).toBe(999);
  });

  it("队列超过上限时截断（不让存档无限长）", () => {
    const queue = Array.from({ length: MAX_PERSISTED_TRACKS + 20 }, (_, i) =>
      track(`t${i}`, `/audio/${i}.mp3`),
    );
    const result = sanitizeSnapshot(snapshot({ queue, currentIndex: 0 }));

    expect(result.queue).toHaveLength(MAX_PERSISTED_TRACKS);
  });

  it("音量夹到 0~1，非法音量退回 1", () => {
    expect(sanitizeSnapshot(snapshot({ volume: 5 })).volume).toBe(1);
    expect(sanitizeSnapshot(snapshot({ volume: -3 })).volume).toBe(0);
    expect(sanitizeSnapshot(snapshot({ volume: Number.NaN })).volume).toBe(1);
  });
});

describe("parseSnapshot（读盘容错）", () => {
  it("没有存档 / JSON 坏掉 → null（调用方保持默认）", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("")).toBeNull();
    expect(parseSnapshot("{不是 JSON")).toBeNull();
    expect(parseSnapshot("null")).toBeNull();
    expect(parseSnapshot("[1,2,3]")).toBeNull();
  });

  it("旧版本存档（只有偏好、没有队列）也能读，队列为空", () => {
    const result = parseSnapshot(JSON.stringify({ mode: "random", volume: 0.4, muted: true }));

    expect(result).toEqual({
      mode: "random",
      volume: 0.4,
      muted: true,
      queue: [],
      currentIndex: -1,
      seconds: 0,
      droppedLocalTracks: 0,
    });
  });

  it("字段类型不对就忽略：queue 不是数组、currentIndex 是字符串、mode 不认识", () => {
    const result = parseSnapshot(
      JSON.stringify({
        mode: "不存在的模式",
        queue: "不是数组",
        currentIndex: "2",
        seconds: "30",
        volume: "大",
      }),
    );

    expect(result?.mode).toBe("list");
    expect(result?.queue).toEqual([]);
    expect(result?.currentIndex).toBe(-1);
    expect(result?.seconds).toBe(0);
    expect(result?.volume).toBe(1);
  });

  it("队列里混着坏条目（缺 id / 缺 url / 不是对象）会被过滤", () => {
    const result = parseSnapshot(
      JSON.stringify({
        queue: [
          { title: "缺 id" },
          null,
          { id: "x", title: "缺 url" },
          track("ok", "/audio/1.mp3"),
        ],
        currentIndex: 3,
      }),
    );

    expect(result?.queue.map((t) => t.id)).toEqual(["ok"]);
    expect(result?.currentIndex).toBe(0);
  });

  it("存盘 → 读盘是往返一致的（含进度）", () => {
    const saved = sanitizeSnapshot(
      snapshot({
        mode: "one",
        volume: 0.33,
        muted: true,
        queue: [track("a", "blob:x"), track("b", "/audio/b.mp3", 240)],
        currentIndex: 1,
        seconds: 61.5,
      }),
    );
    const loaded = parseSnapshot(JSON.stringify(saved));

    expect(loaded).toEqual(saved);
  });

  it("刷新后仍记得“有几首本地曲目没恢复成”（存档里存的是数量，不是那些曲目）", () => {
    const saved = sanitizeSnapshot(
      snapshot({
        queue: [track("a", "blob:x"), track("b", "blob:y"), track("c", "/audio/c.mp3")],
        currentIndex: 2,
      }),
    );
    const loaded = parseSnapshot(JSON.stringify(saved));

    expect(loaded?.droppedLocalTracks).toBe(2);
    expect(loaded?.queue.map((t) => t.id)).toEqual(["c"]);
  });
});

describe("存档里的本地曲目计数", () => {
  it("下一次存盘会把它清零（提示只该出现一次，不能反复烦人）", () => {
    const restored = parseSnapshot(
      JSON.stringify({ queue: [], currentIndex: -1, seconds: 0, droppedLocalTracks: 3 }),
    );
    expect(restored?.droppedLocalTracks).toBe(3);

    // 恢复之后再存一次盘：此时队列里已经没有那些本地曲目了，计数自然归零
    const next = sanitizeSnapshot(restored!);
    expect(next.droppedLocalTracks).toBe(0);
  });
});

describe("在线曲目的存档（ON-03：直链不进存档）", () => {
  /** 在线曲目：队列里的 url 本来就是空串（直链开播前才解析） */
  function online(id: string, url = ""): Track {
    return { ...track(id, "https://example.test/x"), source: "online", url };
  }

  it("在线曲目即使 url 是空串也入存档（id 是 provider:id 稳定键，随时能重解析）", () => {
    const result = sanitizeSnapshot(
      snapshot({ queue: [online("netease:1"), track("b", "/audio/2.mp3")], currentIndex: 0 }),
    );

    expect(result.queue.map((t) => t.id)).toEqual(["netease:1", "b"]);
    expect(result.droppedLocalTracks).toBe(0);
  });

  it("已经解析出的直链在存档里被置空（签名地址会过期，存下来就是死链）", () => {
    const live = online("netease:1", "https://m701.music.126.net/abc.mp3");
    const result = sanitizeSnapshot(snapshot({ queue: [live], currentIndex: 0 }));

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]?.url).toBe("");
    // 不动队列里的原对象：播放中的那份还要靠它出声
    expect(live.url).toBe("https://m701.music.126.net/abc.mp3");
  });

  it("恢复后当前曲目仍是同一首：进度对着它夹取", () => {
    const saved = sanitizeSnapshot(
      snapshot({ queue: [track("a", "blob:x"), online("netease:9")], currentIndex: 1, seconds: 42 }),
    );
    const loaded = parseSnapshot(JSON.stringify(saved));

    expect(loaded?.currentIndex).toBe(0);
    expect(loaded?.queue[0]?.url).toBe("");
    expect(loaded?.seconds).toBe(42);
  });
});
