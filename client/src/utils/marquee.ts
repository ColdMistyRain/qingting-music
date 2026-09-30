/**
 * 长文本滚动（marquee）的节奏计算。
 * 抽成纯函数以便单测：时长由溢出宽度与恒定速度换算，并夹在合理区间内。
 */

/** 滚动速度（像素/秒）：慢一点更适合读文字 */
export const MARQUEE_SPEED_PX_PER_SECOND = 28;
export const MARQUEE_MIN_SECONDS = 6;
export const MARQUEE_MAX_SECONDS = 20;
/** 首尾停顿与往返的固定开销（秒） */
const MARQUEE_OVERHEAD_SECONDS = 2.4;

/**
 * 由溢出像素数算出一次完整滚动（去 → 停顿 → 回）所需秒数。
 * 溢出为 0（不需要滚动）时返回下限值，便于调用方统一处理。
 */
export function marqueeDuration(overflowPx: number, speed = MARQUEE_SPEED_PX_PER_SECOND): number {
  if (!Number.isFinite(overflowPx) || overflowPx <= 0) return MARQUEE_MIN_SECONDS;
  if (!Number.isFinite(speed) || speed <= 0) return MARQUEE_MAX_SECONDS;

  const roundTrip = (overflowPx / speed) * 2;
  return Math.min(MARQUEE_MAX_SECONDS, Math.max(MARQUEE_MIN_SECONDS, roundTrip + MARQUEE_OVERHEAD_SECONDS));
}
