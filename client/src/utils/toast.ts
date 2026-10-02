import { shallowRef } from "vue";

/**
 * 应用内提示条（Toast，v5.72）—— **"说一句就走"的唯一入口**。
 *
 * 为什么要有它：以前这类消息散在各处 —— 播放异常塞在播放条信息区的一行红字里（位置局促、
 * 手机上把两行信息挤成三行，而且没有关闭入口）。现在统一排到这里：自动消失（时长自带）、
 * 悬停或聚焦时暂停倒计时、可点关闭 / 滑动 / 按 Esc 收掉，出错的用状态色说出来。
 *
 * **什么时候用它**（判据写进开发约定）：**与用户当前操作无关、或消失掉也不影响继续操作**的消息 ——
 * 播放异常、后台任务的结果、一次性的成功/失败回执。
 * 反过来，**绑在某个控件或表单项上的错误留在原地**（表单校验、上传队列里某一行的失败、
 * 曲库加载失败那种带"重试"的失败面板）：那些信息要一直看得见，而且就该出现在出问题的地方。
 *
 * 结构上照 `utils/confirm` 的老规矩：模块里只放**队列**（`toasts` 是唯一数据源），
 * 界面在 `components/AppToast.vue`（挂在 App.vue，全站一份）。这样任何地方（store、路由守卫、
 * 工具函数）都能 `showToast(...)`，不必先拿到组件实例。
 */
export type ToastTone = "info" | "danger";

export interface ToastOptions {
  /** 一句话说清发生了什么 */
  title: string;
  /** 一句话说不清时才补 */
  description?: string;
  /** 只有**出错**用 `danger`；提示类一律 `info`（颜色只表达状态） */
  tone?: ToastTone;
  /** 覆盖默认停留时长（毫秒） */
  duration?: number;
}

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  duration: number;
}

/** 默认停留 5s：够看清一句话，又不至于赖着不走 */
export const TOAST_DURATION_MS = 5000;
/** 跨事件的提示（“这首歌加载失败，已自动跳到下一首”）给更长时间 —— 它说的事更重 */
export const TOAST_STICKY_DURATION_MS = 10000;
/** 同屏最多三条：再多会把播放条上方糊成一片，而且会互相盖住 */
export const TOAST_LIMIT = 3;

/** 当前该显示的提示（界面直接读它） */
export const toasts = shallowRef<ToastItem[]>([]);

let seq = 0;

/** 同一条 = 文案与色号都一样：重复触发不该堆出三条一模一样的提示 */
function isSame(a: ToastItem, b: ToastItem): boolean {
  return a.title === b.title && a.tone === b.tone;
}

/** 追加一条（纯函数）：同一条已经在了就换成新的那条（重新计时），超出上限从最早的丢 */
export function upsertToast(
  list: readonly ToastItem[],
  item: ToastItem,
  limit = TOAST_LIMIT,
): ToastItem[] {
  const rest = list.filter((existing) => !isSame(existing, item));
  const next = [...rest, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** 按 id 移除（纯函数）：找不到就原样返回**同一个数组**（调用方据此跳过渲染） */
export function removeToast(list: readonly ToastItem[], id: number): ToastItem[] {
  const next = list.filter((item) => item.id !== id);
  return next.length === list.length ? (list as ToastItem[]) : next;
}

/** 弹一条；返回它的 id（要收掉它时用 `dismissToast`） */
export function showToast(options: ToastOptions): number {
  seq += 1;
  const item: ToastItem = {
    id: seq,
    title: options.title,
    tone: options.tone ?? "info",
    duration: options.duration ?? TOAST_DURATION_MS,
  };
  if (options.description !== undefined) item.description = options.description;
  toasts.value = upsertToast(toasts.value, item);
  return item.id;
}

/** 收掉某一条（计时到点、点关闭、滑动、按 Esc 都会走到这里） */
export function dismissToast(id: number): void {
  toasts.value = removeToast(toasts.value, id);
}

/** 清空队列（单测用） */
export function resetToasts(): void {
  toasts.value = [];
  seq = 0;
}
