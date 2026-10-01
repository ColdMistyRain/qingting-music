import { describe, expect, it } from "vitest";
import { shouldUseViewTransition, VT_ATTR, VT_WATCHDOG_MS } from "./viewTransition";

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
  });
});
