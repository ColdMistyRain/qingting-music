import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@qingting/shared";
import { fetchLyrics } from "@/api/songs";
import { fetchOnlineLyrics, fetchOnlineStreamUrl } from "@/api/online";
import { AUTO_SKIP_DELAY_MS } from "@/utils/playbackFailure";
import { TOAST_DURATION_MS, TOAST_STICKY_DURATION_MS, resetToasts, toasts } from "@/utils/toast";
import { usePlayerStore } from "./player";

// 云端歌词是开播时向 /api/songs/:id/lyrics 拉的（LR-02）：单测里只关心"拉没拉、什么时候拉"
vi.mock("@/api/songs", () => ({
  fetchLyrics: vi.fn(async (id: string) => ({
    lyrics: id === "cloud" ? "[00:01.00]云端内嵌歌词" : null,
  })),
}));

// 在线音源（ON-03/05）：直链解析与歌词都走这里，单测里按用例改返回值
vi.mock("@/api/online", () => ({
  fetchOnlineStreamUrl: vi.fn(async () => "https://cdn.example.test/stream.mp3"),
  fetchOnlineLyrics: vi.fn(async () => null),
}));

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

/** 云端曲目：只有 `source: "server"` 才会去问“服务器在不在” */
function cloudTrack(id: string): Track {
  return { ...track(id), source: "server", url: `/audio/${id}` };
}

/** “服务器在不在”探的是全局 fetch（`utils/playbackFailure` 的默认注入点）—— 单测里桩掉它 */
function stubServer(alive: boolean) {
  const spy = vi.fn(async () => {
    if (!alive) throw new TypeError("Failed to fetch");
    return new Response("{}", { status: 200 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  setActivePinia(createPinia());
  resetToasts();
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

  it("setQueue 整单替换并从指定那首开始播（PS-03 播放歌单）", () => {
    const player = usePlayerStore();
    player.addTracks([track("old")]);

    player.setQueue([track("a"), track("b"), track("c")], 1);

    expect(player.queue.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(player.currentTrack?.id).toBe("b");
    expect(player.progress).toBe(0);
    // 单测环境不创建 <audio>，所以只断言“选中了哪一首”，不断言 playing
  });

  it("setQueue 起点越界时夹回合法范围；空数组等于只清空", () => {
    const player = usePlayerStore();

    player.setQueue([track("a"), track("b")], 99);
    expect(player.currentTrack?.id).toBe("b");

    player.setQueue([track("a"), track("b")], -3);
    expect(player.currentTrack?.id).toBe("a");

    player.setQueue([]);
    expect(player.queue).toEqual([]);
    expect(player.hasTrack).toBe(false);
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

  it("拖到 0 就是静音：muted 跟着置真（界面只存在一种“静音”说法）", () => {
    const player = usePlayerStore();
    player.setVolume(0);
    expect(player.volume).toBe(0);
    expect(player.muted).toBe(true);
    player.setVolume(0.3);
    expect(player.muted).toBe(false);
  });

  it("toggleMute 来回切换，并记住“能听见”的音量", () => {
    const player = usePlayerStore();
    player.setVolume(0.6);
    player.toggleMute();
    expect(player.muted).toBe(true);
    expect(player.volume).toBe(0.6);
    expect(player.lastAudibleVolume).toBe(0.6);
    player.toggleMute();
    expect(player.muted).toBe(false);
    expect(player.volume).toBe(0.6);
  });

  it("音量为 0 时再点静音键 = 恢复音量，而不是再翻一次 muted", () => {
    const player = usePlayerStore();
    player.setVolume(0.5);
    player.setVolume(0);
    expect(player.muted).toBe(true);
    player.toggleMute();
    expect(player.muted).toBe(false);
    expect(player.volume).toBe(0.5);
  });

  it("始终没调过音量时，从 0 恢复不会停在 0（用默认可听音量兜底）", () => {
    const player = usePlayerStore();
    player.setVolume(0);
    player.toggleMute();
    expect(player.muted).toBe(false);
    expect(player.volume).toBeGreaterThan(0);
  });
});

/** 最近一条提示（PL-09 的断言就落在这里：文案 / 色号 / 停留时长） */
const latestToast = () => toasts.value.at(-1);

describe("播放提示（PL-09，v5.72 起走提示条）", () => {
  it("提示类走中性色，且带有限的停留时长（不会长期占着屏幕）", () => {
    const player = usePlayerStore();
    player.notify("浏览器阻止了自动播放，点一下播放按钮即可");
    expect(latestToast()?.title).toContain("自动播放");
    expect(latestToast()?.tone).toBe("info");
    expect(latestToast()?.duration).toBe(TOAST_DURATION_MS);
  });

  it("出错用状态色，而且停留更久（跟跳下一首这种事不能转瞬即逝）", () => {
    const player = usePlayerStore();
    player.notify("这首歌加载失败", true, "danger");
    expect(latestToast()?.tone).toBe("danger");
    expect(latestToast()?.duration).toBe(TOAST_STICKY_DURATION_MS);
  });

  it("两条不同的提示并排排着（不再像以前那样互相顶掉）", () => {
    const player = usePlayerStore();
    player.notify("第一条");
    player.notify("第二条");
    expect(toasts.value.map((item) => item.title)).toEqual(["第一条", "第二条"]);
  });

  it("传空串只收掉瞬时提示，粘性提示留着", () => {
    const player = usePlayerStore();
    player.notify("粘性的", true);
    player.notify("瞬时的");
    expect(toasts.value).toHaveLength(2);

    player.notify("");
    expect(toasts.value.map((item) => item.title)).toEqual(["粘性的"]);
  });
});

/** 可编程的假 audio 元素：用于验证 store 与 <audio> 的接线（真机行为靠事件驱动） */
class FakeAudio {
  static instances: FakeAudio[] = [];
  src = "";
  currentTime = 0;
  duration = 0;
  volume = 1;
  muted = false;
  preload = "";
  paused = true;
  style: Record<string, string> = {};
  /** play() 是否应被浏览器拦下（自动播放策略） */
  blockPlay = false;
  /** 加载失败时浏览器给出的媒体错误（非空 = 这次是“放不出来”，而不是“被拦了”） */
  error: MediaError | null = null;

  private listeners = new Map<string, Set<() => void>>();

  constructor() {
    FakeAudio.instances.push(this);
  }

  addEventListener(type: string, callback: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(callback);
    this.listeners.set(type, set);
  }

  emit(type: string): void {
    for (const callback of this.listeners.get(type) ?? []) callback();
  }

  async play(): Promise<void> {
    // 加载失败时浏览器先给元素挂上 `MediaError`，再让 play() 的 promise 被拒
    if (this.error) throw new Error("NotSupportedError");
    if (this.blockPlay) throw new Error("NotAllowedError");
    this.paused = false;
    this.emit("play");
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit("pause");
  }

  removeAttribute(): void {
    this.src = "";
  }
}

/** 让异步的失败收尾跑完（假定时器下也能用）：放掉微任务再推一次定时器 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await Promise.resolve();
}

describe("手动歌词库（LR-02 第三条来源，v4.87）", () => {
  /** node 环境没有 localStorage，给一个够用的内存版 */
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const LRC = "[00:01.00]手动第一句\n[00:03.00]手动第二句";

  it("导入后成为最高优先级来源，清掉则退回内嵌那份", () => {
    const player = usePlayerStore();
    player.addTracks([{ ...track("a"), lyrics: "[00:01.00]内嵌" }]);
    player.playAt(0);

    expect(player.lyricsSource).toBe("[00:01.00]内嵌");
    expect(player.hasImportedLyrics).toBe(false);

    expect(player.importLyrics(LRC)).toBe(true);
    expect(player.hasImportedLyrics).toBe(true);
    expect(player.lyricsSource).toBe(LRC);

    player.clearImportedLyrics();
    expect(player.hasImportedLyrics).toBe(false);
    expect(player.lyricsSource).toBe("[00:01.00]内嵌");
  });

  it("解析不出歌词的文本不写入（返回 false，交给界面提示用户）", () => {
    const player = usePlayerStore();
    player.addTracks([track("a")]);
    player.playAt(0);

    expect(player.importLyrics("这不是歌词，一个时间标签都没有")).toBe(false);
    expect(player.hasImportedLyrics).toBe(false);
  });

  it("按曲目各记各的：切歌不串歌词", () => {
    const player = usePlayerStore();
    player.addTracks([track("a"), track("b")]);
    player.playAt(0);
    player.importLyrics("[00:01.00]A 的手动歌词");

    player.playAt(1);
    expect(player.hasImportedLyrics).toBe(false);
    player.importLyrics("[00:01.00]B 的手动歌词");

    player.playAt(0);
    expect(player.lyricsSource).toBe("[00:01.00]A 的手动歌词");
  });

  it("存进 localStorage（本地曲目用“歌手|曲名”当键：id 每次都会重新生成）", async () => {
    const player = usePlayerStore();
    player.addTracks([track("a")]);
    player.playAt(0);
    player.importLyrics(LRC);
    await nextTick(); // 落盘走的是 watch，默认异步

    const stored: Record<string, string> = JSON.parse(memory.get("qt-lyrics") ?? "{}");
    expect(stored["local:测试歌手|曲目 a"]).toBe(LRC);
  });

  it("restore 时把手动歌词库读回来（刷新后还在）", () => {
    memory.set("qt-lyrics", JSON.stringify({ "local:测试歌手|曲目 a": LRC }));
    const player = usePlayerStore();
    player.restore();
    player.addTracks([track("a")]);
    player.playAt(0);

    expect(player.hasImportedLyrics).toBe(true);
    expect(player.lyricsSource).toBe(LRC);
  });

  it("存档坏掉（不是 JSON / 全是垃圾条目）也不会崩，只是什么都没有", () => {
    memory.set("qt-lyrics", "{{{ 不是 JSON");
    const player = usePlayerStore();
    player.restore();

    expect(player.importedLyrics).toEqual({});

    memory.set("qt-lyrics", JSON.stringify({ 坏条目: "没有时间标签", 好东西: LRC }));
    player.restore();
    expect(Object.keys(player.importedLyrics)).toEqual(["好东西"]);
  });
});

describe("与 audio 元素的接线", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    // 这一组要验“失败后多久才跳”，用假定时器把 3 秒推过去（`settle()` 负责放微任务）
    vi.useFakeTimers();
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("播放成功后 playing 跟随 play 事件置真，pause 后置假", async () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 10)]);
    player.playAt(0);
    await settle();
    expect(player.playing).toBe(true);

    player.pause();
    expect(player.playing).toBe(false);
  });

  it("自动播放被拦：给出提示且不误报播放中；播放成功后提示被清掉", async () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 10)]);
    player.playAt(0);
    await settle();

    FakeAudio.instances[0]!.blockPlay = true;
    player.pause();
    player.toggle();
    await settle();
    expect(player.playing).toBe(false);
    expect(latestToast()?.title).toContain("自动播放");

    // 用户再点一次（此时已放行）→ 播放成功，提示应立刻消失
    FakeAudio.instances[0]!.blockPlay = false;
    player.toggle();
    await settle();
    expect(player.playing).toBe(true);
    expect(toasts.value).toHaveLength(0);
  });

  it("音频加载失败（服务器还在）：3 秒后才跳下一首，这 3 秒里用户能自己换歌", async () => {
    stubServer(true);
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10)]);
    player.playAt(0);
    await settle();

    FakeAudio.instances[0]!.emit("error");
    await settle();
    // 不立刻跳：先让用户看见那句话，也给他换歌的时间
    expect(player.currentTrack?.id).toBe("a");
    expect(latestToast()?.title).toContain("3 秒后跳下一首");
    expect(latestToast()?.tone).toBe("danger");

    await vi.advanceTimersByTimeAsync(AUTO_SKIP_DELAY_MS);
    expect(player.currentTrack?.id).toBe("b");
  });

  it("这 3 秒里用户点了别的曲目：那次待跳被取消（不会被再跳走一次）", async () => {
    stubServer(true);
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10), track("c", 10)]);
    player.playAt(0);
    await settle();

    FakeAudio.instances[0]!.emit("error");
    await settle();

    player.playAt(2); // 用户自己挑了一首
    await vi.advanceTimersByTimeAsync(AUTO_SKIP_DELAY_MS * 2);
    expect(player.currentTrack?.id).toBe("c");
  });

  it("同一首重复派 error 也只跳一次（不会叠出两次跳）", async () => {
    stubServer(true);
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10), track("c", 10)]);
    player.playAt(0);
    await settle();

    const element = FakeAudio.instances[0]!;
    element.emit("error");
    element.emit("error");
    await settle();
    await vi.advanceTimersByTimeAsync(AUTO_SKIP_DELAY_MS);
    expect(player.currentTrack?.id).toBe("b");
  });

  it("服务器断链：不一首首往下跳，而是说清“连接不上服务器”并停下来", async () => {
    stubServer(false);
    const player = usePlayerStore();
    player.addTracks([cloudTrack("a"), cloudTrack("b"), cloudTrack("c")]);
    player.mode = "list";
    player.playAt(0);
    await settle();

    FakeAudio.instances[0]!.emit("error");
    await settle();

    expect(latestToast()?.title).toContain("连接不上服务器");
    expect(latestToast()?.tone).toBe("danger");
    expect(player.playing).toBe(false);
    // 关键：给足时间也不会自己往下跳（原来就是这样一首首飞快跳完整个列表）
    await vi.advanceTimersByTimeAsync(AUTO_SKIP_DELAY_MS * 4);
    expect(player.currentTrack?.id).toBe("a");
  });

  it("本地曲目不涉及服务器：一次也不去探测（直接走 3 秒延时那条路）", async () => {
    const fetchSpy = stubServer(true);
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10)]);
    player.playAt(0);
    await settle();

    FakeAudio.instances[0]!.emit("error");
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(latestToast()?.title).toContain("3 秒后跳下一首");
  });

  it("单曲循环下坏文件不会原地每 3 秒重试一次（停在原地并说清楚）", async () => {
    stubServer(true);
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10)]);
    player.mode = "one";
    player.playAt(0);
    await settle();

    FakeAudio.instances[0]!.emit("error");
    await settle();
    expect(latestToast()?.title).toContain("先停在这里");

    await vi.advanceTimersByTimeAsync(AUTO_SKIP_DELAY_MS * 3);
    expect(player.currentTrack?.id).toBe("a");
    expect(toasts.value).toHaveLength(1);
  });

  it("加载失败不会被说成“浏览器拦住自动播放”（那会把人指到错方向）", async () => {
    stubServer(true);
    const player = usePlayerStore();
    player.addTracks([track("a", 10), track("b", 10)]);
    player.playAt(0);
    await settle();

    const element = FakeAudio.instances[0]!;
    element.error = {} as MediaError;
    element.emit("error");
    await settle();

    expect(toasts.value.some((item) => item.title.includes("自动播放"))).toBe(false);
    expect(latestToast()?.title).toContain("无法播放");
  });

  it("音量与静音同步到 audio 元素（PL-04）", () => {
    const player = usePlayerStore();
    player.addTracks([track("a", 10)]);
    player.playAt(0);
    player.setVolume(0.4);
    player.toggleMute();

    const element = FakeAudio.instances[0]!;
    expect(element.volume).toBe(0.4);
    expect(element.muted).toBe(true);

    // 拉到 0 也等同于静音，audio 侧同样要静下来
    player.setVolume(0);
    expect(element.volume).toBe(0);
    expect(element.muted).toBe(true);
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

describe("云端曲目的内嵌歌词（LR-02：开播时按需拉一次）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(fetchLyrics).mockClear();
  });

  it("hasLyrics 为真：拉回来回填到曲目上，并落进「内嵌」优先级", async () => {
    const player = usePlayerStore();
    player.addTracks([{ ...track("cloud"), source: "server", hasLyrics: true }]);
    player.playAt(0);

    await vi.waitFor(() => expect(player.lyricsSource).toBe("[00:01.00]云端内嵌歌词"));
    expect(player.currentTrack?.lyrics).toBe("[00:01.00]云端内嵌歌词");
  });

  it("没有内嵌歌词的云端曲目：一次也不去请求（hasLyrics 为假）", async () => {
    const player = usePlayerStore();
    player.addTracks([{ ...track("plain"), source: "server" }]);
    player.playAt(0);
    await Promise.resolve();

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it("本地曲目不去问服务端（歌词来自文件标签本身）", async () => {
    const player = usePlayerStore();
    player.addTracks([{ ...track("local"), source: "local", hasLyrics: true }]);
    player.playAt(0);
    await Promise.resolve();

    expect(fetchLyrics).not.toHaveBeenCalled();
  });

  it("同一首来回切歌只拉一次（问过没有就是没有）", async () => {
    const player = usePlayerStore();
    player.addTracks([
      { ...track("other"), source: "server" },
      { ...track("cloud"), source: "server", hasLyrics: true },
    ]);

    player.playAt(1);
    await vi.waitFor(() => expect(fetchLyrics).toHaveBeenCalledTimes(1));
    player.playAt(0);
    player.playAt(1);
    await Promise.resolve();

    expect(fetchLyrics).toHaveBeenCalledTimes(1);
  });

  it("手动导入的歌词仍然优先于云端内嵌歌词（LR-02 优先级不变）", async () => {
    const memory = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    });
    const player = usePlayerStore();
    player.addTracks([{ ...track("cloud"), source: "server", hasLyrics: true }]);
    player.playAt(0);
    await vi.waitFor(() => expect(player.currentTrack?.lyrics).toBeTruthy());

    player.importLyrics("[00:09.00]我自己找的");

    expect(player.lyricsSource).toBe("[00:09.00]我自己找的");
    vi.unstubAllGlobals();
  });
});

describe("在线曲目（ON-03/05）", () => {
  /** 在线曲目：进队列时 url 是空串，直链开播前才解析 */
  function onlineTrack(id: string): Track {
    return {
      id,
      source: "online",
      url: "",
      title: `在线 ${id}`,
      artist: "在线歌手",
      album: "在线专辑",
      cover: null,
      duration: 180,
    };
  }

  beforeEach(() => {
    FakeAudio.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
    vi.mocked(fetchOnlineStreamUrl).mockClear();
    vi.mocked(fetchOnlineStreamUrl).mockResolvedValue("https://cdn.example.test/stream.mp3");
    vi.mocked(fetchOnlineLyrics).mockClear();
    vi.mocked(fetchOnlineLyrics).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("playAt 前先解析直链：解析出的地址回填到曲目上并装进 audio", async () => {
    const player = usePlayerStore();
    player.addTracks([onlineTrack("netease:1")]);
    player.playAt(0);
    await settle();

    expect(fetchOnlineStreamUrl).toHaveBeenCalledWith("netease", "1");
    expect(player.queue[0]?.url).toBe("https://cdn.example.test/stream.mp3");
    expect(FakeAudio.instances[0]!.src).toBe("https://cdn.example.test/stream.mp3");
    expect(player.playing).toBe(true);
  });

  it("已经解析过的曲目再播不再发请求", async () => {
    const player = usePlayerStore();
    player.addTracks([onlineTrack("netease:1")]);
    player.playAt(0);
    await settle();

    player.pause();
    player.playAt(0);
    await settle();
    expect(fetchOnlineStreamUrl).toHaveBeenCalledTimes(1);
  });

  it("VIP/无版权（url 为 null）：说清楚原因并停下，不自动跳歌", async () => {
    vi.mocked(fetchOnlineStreamUrl).mockResolvedValue(null);
    const player = usePlayerStore();
    player.addTracks([onlineTrack("netease:1"), onlineTrack("netease:2")]);
    player.mode = "list";
    player.playAt(0);
    await settle();

    expect(latestToast()?.tone).toBe("danger");
    expect(latestToast()?.title).toContain("VIP 或暂无版权");
    expect(player.playing).toBe(false);
    // 解析失败在装 audio 之前就停住了：连元素都不用建
    expect(FakeAudio.instances).toHaveLength(0);
    // 回写真实可播状态（v6.35 补 6 留白落地）：行内标从「试听」翻成「无版权」
    expect(player.queue[0]?.unavailable).toBe(true);
    // 与坏文件不同：这里没有排 3 秒的待跳（自动跳下去会成另一种"自己换歌"）
    await vi.advanceTimersByTimeAsync(AUTO_SKIP_DELAY_MS * 3);
    expect(player.currentTrack?.id).toBe("netease:1");
  });

  it("解析请求本身失败（后端断/音源 502）：提示音源连不上，同样不跳", async () => {
    vi.mocked(fetchOnlineStreamUrl).mockRejectedValue(new Error("网络断了"));
    const player = usePlayerStore();
    player.addTracks([onlineTrack("netease:1")]);
    player.playAt(0);
    await settle();

    expect(latestToast()?.title).toContain("在线音源暂时连不上");
    expect(player.playing).toBe(false);
  });

  it("同一首的并发解析只发一次请求（快速连点不炸接口）", async () => {
    let release!: (value: string | null) => void;
    vi.mocked(fetchOnlineStreamUrl).mockReturnValue(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    const player = usePlayerStore();
    player.addTracks([onlineTrack("netease:1")]);
    player.playAt(0);
    player.playAt(0);
    release("https://cdn.example.test/late.mp3");
    await settle();

    expect(fetchOnlineStreamUrl).toHaveBeenCalledTimes(1);
    expect(player.queue[0]?.url).toBe("https://cdn.example.test/late.mp3");
  });

  it("切到在线曲目时自动拉歌词进 lyricsText（LR-02 的「在线」档）；同一首只拉一次", async () => {
    vi.mocked(fetchOnlineLyrics).mockResolvedValue("[00:01.17]夜曲");
    const player = usePlayerStore();
    player.addTracks([onlineTrack("netease:1"), onlineTrack("netease:2")]);

    player.playAt(0);
    await settle();
    await settle();
    expect(player.lyricsText).toBe("[00:01.17]夜曲");

    // 切走又切回：问过的曲目不再发请求（问过没有/有过都是那一遍）
    player.playAt(1);
    await settle();
    player.playAt(0);
    await settle();
    await settle();
    // 每首只问一次：给 netease:1 发过一次请求，切到 netease:2 又是一次
    const callsForFirst = vi
      .mocked(fetchOnlineLyrics)
      .mock.calls.filter(([provider, id]) => provider === "netease" && id === "1");
    expect(callsForFirst).toHaveLength(1);
    expect(player.lyricsText).toBe("[00:01.17]夜曲");
  });

  it("在线歌词拉不到时安静退场：lyricsText 留空，也不打扰播放", async () => {
    vi.mocked(fetchOnlineLyrics).mockRejectedValue(new Error("音源断了"));
    const player = usePlayerStore();
    player.addTracks([onlineTrack("netease:1")]);
    player.playAt(0);
    await settle();
    await settle();

    expect(player.lyricsText).toBe("");
    expect(player.playing).toBe(true);
  });
});
