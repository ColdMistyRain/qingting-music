/**
 * 指针/手势判定（纯函数，便于单测）。
 * 与 utils/keyboard.ts 同一分工：判“这次事件算不算用户意图”的逻辑抽出来，
 * 组件里只留调用与副作用。
 */

/**
 * 这次点击是不是**触摸**点出来的？
 *
 * 用途：曲目行的桌面手势是双击（鼠标习惯），但触摸屏既没有“悬浮”也没有双击习惯
 * （手机上双击是缩放），所以行的 `@click` 里靠它把“点一下”当成“播这首”。
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
