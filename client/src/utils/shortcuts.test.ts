import { describe, expect, it, vi } from "vitest";
import { SEEK_STEP_SECONDS, VOLUME_STEP, handleShortcut, type ShortcutActions } from "./shortcuts";

/** PL-08 / PRD 11.2：快捷键判定（快退快进、音量、空格），含不该接管的场景 */

function actions(): ShortcutActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    toggle: () => calls.push("toggle"),
    seekBy: (seconds) => calls.push(`seek ${seconds}`),
    adjustVolume: (delta) => calls.push(`volume ${delta.toFixed(2)}`),
  };
}

/** 只造出处理器真正会读的字段（KeyboardEvent 在 node 环境里没有完整实现） */
function key(code: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { code, repeat: false, target: null, ...extra } as unknown as KeyboardEvent;
}

describe("handleShortcut（PL-08）", () => {
  it("空格切换播放/暂停", () => {
    const a = actions();
    expect(handleShortcut(key("Space"), a)).toBe(true);
    expect(a.calls).toEqual(["toggle"]);
  });

  it("长按空格不连发（否则会疯狂切换）", () => {
    const a = actions();
    expect(handleShortcut(key("Space", { repeat: true }), a)).toBe(false);
    expect(a.calls).toEqual([]);
  });

  it("左右方向键快退/快进 5 秒，且允许按住连发", () => {
    const a = actions();
    handleShortcut(key("ArrowLeft"), a);
    handleShortcut(key("ArrowRight", { repeat: true }), a);
    expect(a.calls).toEqual([`seek -${SEEK_STEP_SECONDS}`, `seek ${SEEK_STEP_SECONDS}`]);
  });

  it("上下方向键按 5% 调音量", () => {
    const a = actions();
    handleShortcut(key("ArrowUp"), a);
    handleShortcut(key("ArrowDown"), a);
    expect(a.calls).toEqual([
      `volume ${VOLUME_STEP.toFixed(2)}`,
      `volume -${VOLUME_STEP.toFixed(2)}`,
    ]);
  });

  it("焦点在输入框里一律不接管（打字时的方向键/空格要留给输入框）", () => {
    const a = actions();
    const inInput = { tagName: "INPUT" } as unknown as EventTarget;
    for (const code of ["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
      expect(handleShortcut(key(code, { target: inInput }), a)).toBe(false);
    }
    expect(a.calls).toEqual([]);
  });

  it("带修饰键的组合不接管（那是浏览器/系统的快捷键）", () => {
    const a = actions();
    expect(handleShortcut(key("ArrowRight", { ctrlKey: true }), a)).toBe(false);
    expect(handleShortcut(key("ArrowLeft", { metaKey: true }), a)).toBe(false);
    expect(handleShortcut(key("Space", { altKey: true }), a)).toBe(false);
    expect(handleShortcut(key("ArrowUp", { shiftKey: true }), a)).toBe(false);
    expect(a.calls).toEqual([]);
  });

  it("不认识的键返回 false（交给浏览器）", () => {
    const a = actions();
    const spy = vi.fn(handleShortcut);
    expect(spy(key("KeyA"), a)).toBe(false);
    expect(handleShortcut(key("Escape"), a)).toBe(false);
    expect(a.calls).toEqual([]);
  });
});
