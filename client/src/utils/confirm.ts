/**
 * 破坏性动作的二次确认（v4.46）。
 *
 * 目前是**占位实现**：交给宿主环境的原生对话框。等设计好应用内的弹窗组件后，
 * 只改这一个函数（保持 `Promise<boolean>` 的签名即可），所有调用点不用动——
 * 这也是为什么不让各页面自己弹窗、自己搞就地确认：确认必须有唯一入口，
 * 否则将来换弹窗要一处处改，还容易出现两套确认语言。
 *
 * 用 `globalThis.confirm` 而不是 `window.confirm`：单测跑在 Node 环境里没有 `window`，
 * 而“环境里没有对话框”这件事本身就该按**取消**处理（宁可不删，不可误删）。
 */
export async function confirmAction(message: string): Promise<boolean> {
  const ask = globalThis.confirm;
  if (typeof ask !== "function") return false;
  return ask(message);
}
