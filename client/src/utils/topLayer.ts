/**
 * “最上面那层”登记处（v5.40 踩过 Esc 一起关掉两层，v5.53 抽成这个小件）。
 *
 * 问题：Esc / 点遮罩这类**全局**交互，好几层都在同一个目标（`window`）上听。
 * 同一阶段里的监听器按**注册顺序**执行，而注册顺序取决于组件挂载顺序 —— 靠它不可控
 * （v5.40 实测：按一下 Esc，队列抽屉与沉浸页**一起**关了）。
 *
 * 做法：每层打开时 `pushTopLayer()` 领一个层号、关闭时 `popTopLayer(id)` 交回；
 * 处理按键前先问 `isTopLayer(id)` —— 不是最上面那层就**放行**（让上面的层去关）。
 * 这样一来，“谁该响应这个按键”就不再取决于谁先注册。
 *
 * 用法见 `ConfirmDialog.vue`（对话框）、`QueuePopover.vue`（手机抽屉）、
 * `ImmersiveView.vue`（沉浸页整页——它是最下面那层，上面有东西时就不该被 Esc 收起）。
 */
const stack: number[] = [];
let seq = 0;

/** 开一层，返回层号；关闭时把这个层号交回 `popTopLayer` */
export function pushTopLayer(): number {
  seq += 1;
  stack.push(seq);
  return seq;
}

/** 关掉某一层。从中间移除也安全：层号与先后由各自的 `push` 时刻决定，不看移除顺序 */
export function popTopLayer(id: number): void {
  const index = stack.indexOf(id);
  if (index >= 0) stack.splice(index, 1);
}

/** 这一层现在是不是最上面那层（没有登记过任何层时是 false） */
export function isTopLayer(id: number): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** 只给单测用：清空登记（某个用例中途失败时，不给后面的用例留脏状态） */
export function resetTopLayers(): void {
  stack.length = 0;
}
