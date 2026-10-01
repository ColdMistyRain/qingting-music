/**
 * 播放快捷键（PL-08）——纯判断，不碰 store 与 DOM，便于单测（PRD 11.2）。
 *
 * 为什么抽出来：主壳（PlayerLayout）与沉浸页（ImmersiveView）都要用同一套键位。
 * 两处各写一份必然漂（沉浸页当时就是因为没有共享件、自己接了空格键）。
 */
import { isEditableTarget, type EditableLike } from "./keyboard";

/** 快退/快进步长（秒），PRD PL-08 定的是 5 秒 */
export const SEEK_STEP_SECONDS = 5;
/** 音量步长（0~1） */
export const VOLUME_STEP = 0.05;

export interface ShortcutActions {
  /** 播放 / 暂停 */
  toggle: () => void;
  /** 相对当前位置跳转（可为负） */
  seekBy: (seconds: number) => void;
  /** 调整音量（-1~1 的增量） */
  adjustVolume: (delta: number) => void;
}

/**
 * 处理一次按键。认识这个键并**已经处理**（调用方应 `preventDefault`）时返回 true。
 *
 * 规则：
 * - 焦点在输入类控件里一律不接管（否则打字时按方向键会去拖进度条）；
 * - 带 Ctrl / Alt / Meta / Shift 的组合键不接管（那些是浏览器或系统的快捷键）；
 * - 空格不允许长按连发（`repeat`），方向键允许——按住方向键连续快进是预期行为。
 */
export function handleShortcut(event: KeyboardEvent, actions: ShortcutActions): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
  if (isEditableTarget(event.target as unknown as EditableLike | null)) return false;

  switch (event.code) {
    case "Space":
      if (event.repeat) return false;
      actions.toggle();
      return true;
    case "ArrowLeft":
      actions.seekBy(-SEEK_STEP_SECONDS);
      return true;
    case "ArrowRight":
      actions.seekBy(SEEK_STEP_SECONDS);
      return true;
    case "ArrowUp":
      actions.adjustVolume(VOLUME_STEP);
      return true;
    case "ArrowDown":
      actions.adjustVolume(-VOLUME_STEP);
      return true;
    default:
      return false;
  }
}
