/**
 * 滑杆的几何与步进（纯函数：`components/Slider.vue` 与单测共用）。
 *
 * 滑杆有竖横两种朝向，但「值 ↔ 位置」的换算、填充条几何、键盘步进都与朝向无关 ——
 * 收在这里是为了让竖杆（音量条、均衡器十根）与横杆（均衡器整体增益）**共用同一套口径**。
 *
 * 为什么连位置比例也自己算：原生 `<input type="range">` 的填充是**从 min 端起算**的
 * （-10~+10 在 0 处就填满一半），双极控件照它画会被读成 0~100% 的进度条；
 * 而"从中线往两侧长"这件事原生压根没有（v5.69 实测：增益条的填充还停在 50%，见 AGENTS 坑 23）。
 */

export interface SliderRange {
  min: number;
  max: number;
  /** 步长，缺省 1；非正数按"不步进"处理 */
  step?: number;
}

const DEFAULT_STEP = 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 值 → 0~1 的位置比例（从 min 端起算）；超出范围夹取，`min === max` 时按 0 */
export function sliderRatio(value: number, range: SliderRange): number {
  const span = range.max - range.min;
  if (span === 0) return 0;
  return clamp((value - range.min) / span, 0, 1);
}

/** 步长对齐 + 夹取。浮点步长会留尾巴（0.30000000000000004），统一收三位小数 */
export function quantizeValue(raw: number, range: SliderRange): number {
  const step = range.step ?? DEFAULT_STEP;
  const clamped = clamp(raw, range.min, range.max);
  if (!(step > 0)) return Math.round(clamped * 1000) / 1000;
  const stepped = Math.round(clamped / step) * step;
  return Math.round(clamp(stepped, range.min, range.max) * 1000) / 1000;
}

/** 位置比例（0~1，本身就是"从 min 端起算"）→ 值 */
export function valueFromRatio(ratio: number, range: SliderRange): number {
  return quantizeValue(range.min + clamp(ratio, 0, 1) * (range.max - range.min), range);
}

/**
 * 填充条几何：沿轴从 min 端起算的 `start` 与长度 `size`（都是 0~1 的比例）。
 * `centered`（±dB 这类双极控件）时从中线往两侧长 —— 这才是"离 0 有多远"。
 */
export function fillGeometry(ratio: number, centered: boolean): { start: number; size: number } {
  const position = clamp(ratio, 0, 1);
  if (!centered) return { start: 0, size: position };
  return { start: Math.min(0.5, position), size: Math.abs(position - 0.5) };
}

/**
 * 键盘步进：返回新值；没接的键返回 `null`（调用方据此决定要不要 `preventDefault`）。
 * ↑→ 加、↓← 减、Home 到 min、End 到 max；`shift` 时走 `bigStep`（缺省是步长的 10 倍）。
 */
export function stepValue(
  current: number,
  key: string,
  range: SliderRange & { bigStep?: number; shift?: boolean },
): number | null {
  const step = range.step ?? DEFAULT_STEP;
  const delta = range.shift === true ? (range.bigStep ?? step * 10) : step;
  switch (key) {
    case "ArrowUp":
    case "ArrowRight":
      return quantizeValue(current + delta, range);
    case "ArrowDown":
    case "ArrowLeft":
      return quantizeValue(current - delta, range);
    case "Home":
      return quantizeValue(range.min, range);
    case "End":
      return quantizeValue(range.max, range);
    default:
      return null;
  }
}
