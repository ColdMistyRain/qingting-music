import { afterEach, describe, expect, it, vi } from "vitest";
import {
  shouldUseViewTransition,
  withViewTransition,
  VT_ATTR,
  VT_DIR_ATTR,
  VT_WATCHDOG_MS,
} from "./viewTransition";

describe("shouldUseViewTransition", () => {
  it("API 可用且未要求减少动效时启用", () => {
    expect(shouldUseViewTransition({ hasApi: true, reducedMotion: false })).toBe(true);
  });

  it("用户要求减少动效时不启用（降级为普通切换）", () => {
    expect(shouldUseViewTransition({ hasApi: true, reducedMotion: true })).toBe(false);
  });

  it("浏览器不支持 API 时不启用", () => {
    expect(shouldUseViewTransition({ hasApi: false, reducedMotion: false })).toBe(false);
    expect(shouldUseViewTransition({ hasApi: false, reducedMotion: true })).toBe(false);
  });
});

describe("常量", () => {
  it("看门狗时长是正数毫秒（超时强制拆除快照，避免重影）", () => {
    expect(VT_WATCHDOG_MS).toBeGreaterThan(0);
    expect(Number.isFinite(VT_WATCHDOG_MS)).toBe(true);
  });

  it("过渡标记是个合法属性名", () => {
    expect(VT_ATTR).toBe("data-vt");
    expect(VT_DIR_ATTR).toBe("data-vt-dir");
  });
});

/** 造一个够用的 document/window 桩：只看属性读写与 startViewTransition 调用 */
function stubEnv(options: { hasApi: boolean; reducedMotion?: boolean }) {
  const attrs = new Map<string, string>();
  const root = {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
  const finished = Promise.resolve();
  const startViewTransition = vi.fn((cb: () => unknown) => {
    void cb();
    return { finished, skipTransition: vi.fn() };
  });
  const doc: Record<string, unknown> = { documentElement: root };
  if (options.hasApi) doc.startViewTransition = startViewTransition;
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: options.reducedMotion ?? false }),
  });
  return { attrs, startViewTransition };
}

describe("withViewTransition", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("不支持 API 时直接执行更新，不碰属性", async () => {
    const env = stubEnv({ hasApi: false });
    let ran = false;
    const used = await withViewTransition(() => {
      ran = true;
    }, "in");
    expect(used).toBe(false);
    expect(ran).toBe(true);
    expect(env.startViewTransition).not.toHaveBeenCalled();
    expect(env.attrs.size).toBe(0);
  });

  it("用户要求减少动效时不起过渡（但导航照常）", async () => {
    const env = stubEnv({ hasApi: true, reducedMotion: true });
    let ran = false;
    const used = await withViewTransition(() => {
      ran = true;
    }, "out");
    expect(used).toBe(false);
    expect(ran).toBe(true);
    expect(env.startViewTransition).not.toHaveBeenCalled();
  });

  it("起过渡时写上方向，结束后两个属性都清掉", async () => {
    const env = stubEnv({ hasApi: true });
    const used = await withViewTransition(() => undefined, "out");
    expect(used).toBe(true);
    expect(env.startViewTransition).toHaveBeenCalledTimes(1);
    // finished 用的是一个已 resolve 的 promise；等一个微任务让 finally 跑完
    await Promise.resolve();
    await Promise.resolve();
    expect(env.attrs.has(VT_ATTR)).toBe(false);
    expect(env.attrs.has(VT_DIR_ATTR)).toBe(false);
  });
});
