/**
 * 自绘浮层滚动条的几何（纯函数，`directives/overlayScroll.ts` 与单测共用）。
 *
 * 为什么要有它：原生滚动条**占位**，于是我们得靠 `scrollbar-gutter: stable` + 到处补偿
 * 那一条宽度（表头与行各留一份、侧栏与控制台把槽挪进内边距、`--scrollbar-size` 还要在
 * 启动时实测一次），只为让同一岛上的两块对齐。换成**浮在内容上**的自绘条之后，
 * 这一整套补偿都可以拆掉 —— 代价是几何得自己算，所以规则收在这里、按“数 → 位置”的口径写。
 *
 * 与 `utils/slider.ts` 同族：只做纯计算，不碰 DOM（PRD 11.2 要求基础函数配单测）。
 */

/** 滚动条要用的四个数（都是 px） */
export interface ThumbInput {
  /** 视口尺寸（客户区高度） */
  clientSize: number;
  /** 内容尺寸（scrollHeight） */
  scrollSize: number;
  /** 当前滚动位置（scrollTop） */
  scrollPos: number;
  /** 滑块的最小长度：列表再长也不能细成一根线（点不着、看着也像条缝） */
  minThumb?: number;
}

export interface ThumbMetrics {
  /** 滑块长度（px） */
  length: number;
  /** 滑块在轨道内的偏移（px，从轨道顶端算） */
  offset: number;
  /** 压根不需要滚动条（内容装得下）时 true，调用方直接把整条藏掉 */
  hidden: boolean;
}

const DEFAULT_MIN_THUMB = 28;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 算出滑块的长度与位置。
 * 长度按“视口 / 内容”的比例映射到轨道上，但**不小于 `minThumb`**；
 * 长度被抬起来的那些情况下，位置区间也跟着缩小，否则滚到底时滑块会冲出轨道。
 */
export function thumbMetrics(input: ThumbInput): ThumbMetrics {
  const clientSize = Math.max(0, Number(input.clientSize) || 0);
  const scrollSize = Math.max(0, Number(input.scrollSize) || 0);

  // 装得下（或量不到）：没有可滚的行程
  if (clientSize <= 0 || scrollSize <= clientSize) {
    return { length: clientSize, offset: 0, hidden: true };
  }

  const minThumb = Math.max(1, input.minThumb ?? DEFAULT_MIN_THUMB);
  const length = clamp(
    (clientSize / scrollSize) * clientSize,
    Math.min(minThumb, clientSize),
    clientSize,
  );
  const maxOffset = clientSize - length;
  const maxScroll = scrollSize - clientSize;
  const ratio = maxScroll > 0 ? clamp((Number(input.scrollPos) || 0) / maxScroll, 0, 1) : 0;

  return { length, offset: maxOffset * ratio, hidden: false };
}

/**
 * 拖滑块时的反算：由“滑块偏移”得到 `scrollTop`。
 * 与上面互逆（拖到某处 → 内容滚到对应比例），同样按**可用的偏移区间**归一，
 * 所以滑块长度被 `minThumb` 抬起时也不会出现“拖到底却没滚到底”。
 */
export function scrollOffsetFromThumb(
  thumbOffset: number,
  input: Omit<ThumbInput, "scrollPos">,
): number {
  const clientSize = Math.max(0, Number(input.clientSize) || 0);
  const scrollSize = Math.max(0, Number(input.scrollSize) || 0);
  const maxScroll = scrollSize - clientSize;
  if (clientSize <= 0 || maxScroll <= 0) return 0;

  const { length } = thumbMetrics({ ...input, scrollPos: 0 });
  const maxOffset = clientSize - length;
  if (maxOffset <= 0) return 0;

  return clamp((Number(thumbOffset) || 0) / maxOffset, 0, 1) * maxScroll;
}
