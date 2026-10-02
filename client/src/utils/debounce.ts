/**
 * 尾部防抖（v6.9）：连续调用只在**停止调用** `delayMs` 之后执行最后一次。
 *
 * 用途：列表页的搜索框。过滤是“每敲一个字全量 filter + map / 排序”
 * （369 首 ≈ 每次按键几百次 `encodeURIComponent` 或 `localeCompare`），
 * 连打几个字就是几十毫秒的主线程工作；而输入框自己仍要即时回显 ——
 * 所以拆成「输入框绑即时值 + 过滤读防抖值」，而不是去防抖输入框本身
 * （把输入框绑在防抖 ref 上会让它显示旧值、光标乱跳）。
 *
 * 语义（有单测）：`call` 采用掉首次、只保留最后一次参数；`cancel` 清掉待执行的那次；
 * 被取消之后 `call` 依旧可用（不是一次性的）；`delayMs <= 0` 时退化成同步执行。
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): { call: (...args: Args) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Args | null = null;

  const cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  const call = (...args: Args): void => {
    if (delayMs <= 0) {
      fn(...args);
      return;
    }
    pending = args;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const last = pending;
      pending = null;
      if (last) fn(...last);
    }, delayMs);
  };

  return { call, cancel };
}
