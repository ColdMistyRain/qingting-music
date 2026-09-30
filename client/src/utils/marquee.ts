/**
 * 连续单向循环滚动（marquee）的节奏计算。
 * 抽成纯函数以便单测：时长 = 一屏距离 / 恒定速度，并夹在合理区间内。
 */

/** 滚动速度（像素/秒）：慢一点更适合读文字 */
export const MARQUEE_SPEED_PX_PER_SECOND = 30;
export const MARQUEE_MIN_SECONDS = 8;
export const MARQUEE_MAX_SECONDS = 30;

/**
 * 触发滚动所需的最小溢出量（像素）。
 * 只溢出一两个字时滚动反而像渲染坏了（长时停在断层上，用户报过 bug），
 * 这种情况宁可省略号截断 + 悬浮提示（title）让人看到全文。
 */
export const MARQUEE_MIN_OVERFLOW_PX = 24;

/**
 * 由"一份副本的宽度"（循环一次要走的距离，含副本之间的间隔）算出单圈秒数。
 * 距离为 0 / 非法时返回下限，便于调用方统一处理。
 */
export function marqueeDuration(distancePx: number, speed = MARQUEE_SPEED_PX_PER_SECOND): number {
  if (!Number.isFinite(distancePx) || distancePx <= 0) return MARQUEE_MIN_SECONDS;
  if (!Number.isFinite(speed) || speed <= 0) return MARQUEE_MAX_SECONDS;

  const seconds = distancePx / speed;
  return Math.min(MARQUEE_MAX_SECONDS, Math.max(MARQUEE_MIN_SECONDS, seconds));
}

/**
 * 是否值得滚动：溢出量要超过阈值（默认 24px）
 * 容器还没布局（宽度 0）或数值非法时一律不滚。
 */
export function shouldMarquee(
  textWidth: number,
  boxWidth: number,
  minOverflowPx = MARQUEE_MIN_OVERFLOW_PX,
): boolean {
  if (!Number.isFinite(textWidth) || !Number.isFinite(boxWidth) || boxWidth <= 0) return false;
  return textWidth - boxWidth >= minOverflowPx;
}

/** 离屏测宽所需的宿主能力（注入以便单测，无需真实 DOM） */
export interface MeasureHost {
  createElement(tag: string): HTMLElement;
  append(element: HTMLElement): void;
  remove(element: HTMLElement): void;
}

/**
 * 用离屏探针量一段文字在指定字体下的渲染宽度（自带字体回退处理，比 canvas 可靠）。
 *
 * 为什么不用模板里的元素量：那样必须把“测量用元素”长期挂在模板里（隐藏 span），
 * 渲染分支与测量会互相耦合；v4.22 踩过这个坑——多加一个隐藏 span 就让 vue-tsc
 * 生成了错误的虚拟代码（4 个莫须有的 TS6133）。探针用完即删，模板保持干净。
 */
export function measureTextWidth(text: string, font: string, host: MeasureHost): number {
  if (!text) return 0;

  const probe = host.createElement("span");
  probe.textContent = text;
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.top = "-9999px";
  probe.style.left = "-9999px";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "nowrap";
  probe.style.pointerEvents = "none";
  if (font) probe.style.font = font;

  host.append(probe);
  const rect = probe.getBoundingClientRect();
  const width = Math.ceil(rect.width || probe.offsetWidth || 0);
  host.remove(probe);

  return Number.isFinite(width) && width > 0 ? width : 0;
}
