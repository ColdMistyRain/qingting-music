/**
 * 指针/手势判定（纯函数，便于单测）。
 * 与 utils/keyboard.ts 同一分工：判“这次事件算不算用户意图”的逻辑抽出来，
 * 组件里只留调用与副作用。
 */

/**
 * 这次点击是不是**触摸**点出来的？
 *
 * 用途：触摸屏既没有“悬浮”也没有双击习惯（手机上双击是缩放），所以凡是要区分
 * “这一下是触摸还是鼠标”的地方都问它 —— 迷你条与沉浸页的左右滑切歌、播放条的长按进沉浸、
 * 手机左侧抽屉的边缘右滑。
 * （曲目行**不再**用它：v5.96 起“点行即播”鼠标与触摸同一套，行里的播放键也撤了。）
 *
 * 为什么用 pointerType 而不是 `@media (hover: none)`：
 * ① 事件里带着真实来源，不用去猜设备；② 桌面浏览器窗口调窄不该改变交互；
 * ③ 浏览器本就会在滚动/拖拽之后**不派发** click，不必自己再加位移阈值。
 * 现代引擎（Chromium / Firefox / Safari 13+）的 click 都是 PointerEvent 且带 pointerType；
 * 拿不到类型（老引擎是 MouseEvent）时返回 false，保持原行为。
 */
export function isTouchTap(pointerType: string | undefined): boolean {
  return pointerType === "touch";
}

/** 能用指针捕获的最小形状（写宽一点：单测可以传真元素，不必上 jsdom） */
export type PointerCaptureTarget = {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

/**
 * 指针捕获 / 释放的统一入口（两个方向都包了 try/catch）。
 *
 * 两边都可能抛：指针已经没了、被系统/手势收走、元素刚好被重渲染卸载。而调用点的顺序
 * 常常是「先放捕获、再做正事」—— 一抛就把正事吞了。实测两个坑（v6.22）：
 * ① 歌词行——释放排在“跳转”前面，一抛白点一下；
 * ② 播放进度条——释放排在 `endSeek()` 前面，一抛 `seeking` 就永远挂着（进度条会跟着串）。
 * 抢不到 / 放不掉捕获都能继续拖动，只是指针移出元素后可能丢事件，所以吞掉即可。
 */
export function togglePointerCapture(
  target: PointerCaptureTarget | null,
  pointerId: number,
  on: boolean,
): void {
  try {
    if (on) target?.setPointerCapture?.(pointerId);
    else target?.releasePointerCapture?.(pointerId);
  } catch {
    // 见函数注释：捕获只是“更稳”，不是“必需”
  }
}
