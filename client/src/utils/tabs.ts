/**
 * 切 Tab 时「内容往哪边滑」的方向（v5.7）。
 *
 * 抽成纯函数是为了能单测：方向只跟“新旧的先后”有关，跟具体是哪几个 Tab 无关，
 * 而“按身份多一个 Tab”“同一项被再点一次”这些边界最容易写错（早期版本用
 * `>=` 之外还写过 `>`，结果同一项被重选会把方向翻过去）。
 *
 * @param keys 当前 Tab 的顺序（key 数组）
 * @param to 新选中的 key
 * @param from 原来选中的 key
 * @returns +1 = 从右边进来（在列表里往后走）；-1 = 从左边进来
 */
export function tabSlideDirection(keys: readonly string[], to: string, from: string): 1 | -1 {
  const next = keys.indexOf(to);
  const prev = keys.indexOf(from);
  // 任一侧找不到（首次渲染、Tab 刚被移除）一律当作“往后走”，不要翻方向
  if (next < 0 || prev < 0) return 1;
  return next >= prev ? 1 : -1;
}
