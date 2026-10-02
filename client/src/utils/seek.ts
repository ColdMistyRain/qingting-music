import { SEEK_STEP_SECONDS } from "@/utils/shortcuts";

/**
 * 进度条上的键盘跳转（纯函数，`components/ProgressBar.vue` 与单测共用）。
 *
 * 进度条与音量条不一样：音量/增益是**绝对**控件（值就落在刻度上，整数步长正合适），
 * 而“快进 5 秒”是**相对**位移 —— 所以不能拄 `utils/slider.ts` 的 `stepValue`：
 * 它在 `round(current / step) * step` 里把值对齐到步长整数倍，从 7 秒按一下会跳到 10 秒
 * （只走了 3 秒，与 PL-08 的“±5 秒”不符）。
 *
 * 返回 `null` 表示这个键不归进度条管（调用方据此决定要不要 `preventDefault`）。
 */
export function seekKeyTarget(
  currentSeconds: number,
  key: string,
  totalSeconds: number,
  step: number = SEEK_STEP_SECONDS,
): number | null {
  const size = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  // 当前值本身异常（时长还没读出来 / 被别的代码写坏）时**退为 0 再算位移**，
  // 不要把 NaN 一路带进 store（那会让进度条变成一条空轨）
  const base = Number.isFinite(currentSeconds) ? currentSeconds : 0;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return clampSeek(base - step, size);
    case "ArrowRight":
    case "ArrowUp":
      return clampSeek(base + step, size);
    case "Home":
      return 0;
    case "End":
      return size;
    default:
      return null;
  }
}

/** 夹到 `0 ~ total`（时长未知时一律 0） */
function clampSeek(seconds: number, totalSeconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(totalSeconds, Math.max(0, seconds));
}
