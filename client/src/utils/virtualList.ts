/**
 * 长列表虚拟滚动的几何（LB-08：曲目超过 500 条时保证列表流畅）。
 *
 * 为什么是虚拟滚动、而不是服务端分页（PRD 决策记录 v6.27）：搜索（LB-07）、排序（LB-04）
 * 与“点播时把眼前这段整份当队列”都要**整份数据**，接口一旦分页，搜索就只搜得到当前页。
 * 所以这里只收窄**渲染**（只把可见的十几行放进 DOM），数据契约一个字都不动。
 *
 * 口径：本文件只管数学（纯函数 + 单测）；DOM 与事件在 `composables/useVirtualList`。
 * 与 `utils/scrollbar.ts`、`utils/slider.ts` 同族。
 */

/** 少于这么多行就整份渲染：目标场景（500 首）远在这之上，小列表不必引入任何几何假设 */
export const VIRTUAL_THRESHOLD = 100;

/** 视口外上下各多渲染几行：滚动时不至于看见空白 */
export const VIRTUAL_OVERSCAN = 6;

/** 首帧先渲染几行（那会儿还没量到行距）：够量出行距就行，不必铺满一屏 */
export const VIRTUAL_MIN_ROWS = 24;

/**
 * 行距估值（曲目行 64 + 行间 12 = 76；宽屏那条细线的 4px 也在 12 里）。
 * 只用在首帧 —— 量到真值就换掉（控制台那档没有行间，是 64）。
 */
export const ROW_PITCH_FALLBACK = 76;

/** 一个窗口：渲染 `[start, end)`，上下用垫片把没渲染的行“占住地方” */
export interface VirtualWindow {
  start: number;
  /** 开区间上界（含缓冲） */
  end: number;
  /** 列表顶部的垫片高度（px） */
  padTop: number;
  /** 列表底部的垫片高度（px） */
  padBottom: number;
}

export interface VirtualGeometry {
  /** 行数 */
  count: number;
  /** 行距：行高 + 行间（量出来的，见 `pitchFromTops`） */
  pitch: number;
  /** 列表容器的行间距（flex `row-gap`）：垫片住在同一个 flex 流里，每插一个就多吃一份行距，得扣掉 */
  gap: number;
  /** 滚动区可视高度（clientHeight） */
  viewport: number;
  /** 列表顶相对“滚动内容原点”的位移（滚动区自己滚到 0 时列表顶在那里） */
  listTop: number;
  /** 滚动区当前 scrollTop */
  scrollTop: number;
  /** 上下各多渲染几行（默认 VIRTUAL_OVERSCAN） */
  overscan?: number;
}

const EMPTY_WINDOW: VirtualWindow = { start: 0, end: 0, padTop: 0, padBottom: 0 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 整份渲染（不虚拟化）：几何没量到、列表不够长、找不到能滚的祖先时都走这条 */
export function fullWindow(count: number): VirtualWindow {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return total === 0 ? { ...EMPTY_WINDOW } : { start: 0, end: total, padTop: 0, padBottom: 0 };
}

/**
 * 算出一屏该渲染哪几行，以及上下垫片多高。
 *
 * ⚠️ 垫片高度**不是**简单的一份行距相乘：垫片也是列表容器的 flex 子元素，
 * 它两侧照样吃 `row-gap`（宽屏 4px 那档、窄屏 12px 那档、控制台宽屏 0），
 * 所以每块垫片要减掉一份 gap —— 否则滚过一屏就会累积出“每行偏一点”的漂移。
 */
export function computeVirtualWindow(geometry: VirtualGeometry): VirtualWindow {
  const count = Number.isFinite(geometry.count) ? Math.max(0, Math.floor(geometry.count)) : 0;
  if (count <= 0) return { ...EMPTY_WINDOW };
  // 几何还没量到（首帧、容器还没上屏、页面不可见）：整份渲染。
  // 宁可多渲染也不能少渲染 —— 少渲染的行在“滚不动”的容器里就永远看不到了。
  if (!(geometry.pitch > 0) || !(geometry.viewport > 0)) return fullWindow(count);

  const gap = Number.isFinite(geometry.gap) ? Math.max(0, geometry.gap) : 0;
  const overscan = Math.max(0, Math.floor(geometry.overscan ?? VIRTUAL_OVERSCAN));
  const listTop = Number.isFinite(geometry.listTop) ? geometry.listTop : 0;
  const scrollTop = Number.isFinite(geometry.scrollTop) ? geometry.scrollTop : 0;

  // 总高 = count * pitch − gap（最后一行后面没有行间）。筛完只剩几行时浏览器会把 scrollTop
  // 夹回去，这里先自己夹一次，免得窗口按“已经不存在的滚动位置”算到列表外面去。
  const maxScroll = Math.max(0, count * geometry.pitch - gap - geometry.viewport);
  const scrolled = clamp(scrollTop - listTop, 0, maxScroll);

  const first = Math.floor(scrolled / geometry.pitch);
  const visible = Math.max(1, Math.ceil(geometry.viewport / geometry.pitch));
  const start = Math.max(0, Math.min(first - overscan, count - 1));
  const end = Math.min(count, Math.max(start + 1, first + visible + overscan));

  return {
    start,
    end,
    padTop: start > 0 ? Math.max(0, start * geometry.pitch - gap) : 0,
    padBottom: end < count ? Math.max(0, (count - end) * geometry.pitch - gap) : 0,
  };
}

/**
 * 从“已渲染那几行的 offsetTop”里量出行距。
 *
 * 为什么要量而不是写死：行距由行高（64）+ 行间（宽屏 4+4+1px 细线、窄屏 12）拼出来，
 * 还要随断点、字体、缩放变；行距一旦估错，垫片就会一行一行地偏。
 * 行是兄弟节点，`offsetTop` 的差值就是行距（与 offsetParent 是谁无关）。
 * 少于两行、或者量到非正数（行还没上屏）时返回 0 = “没量到”。
 */
export function pitchFromTops(tops: readonly number[]): number {
  if (tops.length < 2) return 0;
  const pitch = (tops[1] ?? 0) - (tops[0] ?? 0);
  return Number.isFinite(pitch) && pitch > 0 ? pitch : 0;
}
