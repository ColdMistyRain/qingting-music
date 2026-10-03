import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_SKIP_DELAY_MS,
  createSkipScheduler,
  isServerTrack,
  serverReachable,
} from "./playbackFailure";

describe("isServerTrack（要不要问服务器在不在）", () => {
  it("只有云端曲目涉及服务器：本地是 Blob、在线是第三方地址", () => {
    expect(isServerTrack("server")).toBe(true);
    expect(isServerTrack("local")).toBe(false);
    expect(isServerTrack("online")).toBe(false);
  });
});

describe("createSkipScheduler（延时跳过，可取消）", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("到点才跳，默认等 3 秒（留给用户换歌的时间）", () => {
    const onSkip = vi.fn();
    const scheduler = createSkipScheduler(AUTO_SKIP_DELAY_MS, onSkip);
    scheduler.schedule();
    expect(scheduler.pending()).toBe(true);

    vi.advanceTimersByTime(AUTO_SKIP_DELAY_MS - 1);
    expect(onSkip).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(scheduler.pending()).toBe(false);
  });

  it("取消之后一个都不跳（用户自己选了别的曲目）", () => {
    const onSkip = vi.fn();
    const scheduler = createSkipScheduler(1000, onSkip);
    scheduler.schedule();
    scheduler.cancel();
    expect(scheduler.pending()).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it("重复排只保留最后一次：不会叠出两次跳", () => {
    const onSkip = vi.fn();
    const scheduler = createSkipScheduler(1000, onSkip);
    scheduler.schedule();
    vi.advanceTimersByTime(600);
    scheduler.schedule();

    vi.advanceTimersByTime(600); // 距第一次排程已 1200ms，但那次已被顶掉
    expect(onSkip).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it("跳完再取消是空操作；跳完之后还能再排一次", () => {
    const onSkip = vi.fn();
    const scheduler = createSkipScheduler(1000, onSkip);
    scheduler.schedule();
    vi.advanceTimersByTime(1000);
    expect(() => scheduler.cancel()).not.toThrow();

    scheduler.schedule();
    expect(scheduler.pending()).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(onSkip).toHaveBeenCalledTimes(2);
  });
});

describe("serverReachable（服务器还活着吗）", () => {
  it("拿到任何 HTTP 响应都算活着（哪怕 401 / 500 —— 进程还在听）", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(serverReachable({ fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/config",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("网络层抛错 = 断了（后端进程没了时就是这个）", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(serverReachable({ fetchImpl })).resolves.toBe(false);
  });

  it("卡住不返回时按超时算（不断死等）", async () => {
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(serverReachable({ fetchImpl, timeoutMs: 10 })).resolves.toBe(false);
  });

  it("环境里没有 fetch：不把它当成“断了”（照常走跳歌那条路）", async () => {
    await expect(serverReachable({ fetchImpl: null })).resolves.toBe(true);
  });
});
