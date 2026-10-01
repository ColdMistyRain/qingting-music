import { shallowRef } from "vue";

/**
 * 破坏性 / 批量动作的二次确认（v4.46 定入口，v5.53 换成应用内对话框）。
 *
 * 这里只管两件事：**排队**与**发答案**。界面在 `components/ConfirmDialog.vue`
 * （挂在 App.vue，全站只有一份）。调用方永远只写一行：
 * `if (!(await confirmAction({ title }))) return;`
 *
 * 为什么不各页面自己弹窗、也不用就地确认：确认必须有**唯一入口**，否则改文案 / 改样式要一处处改，
 * 迟早长出两套确认语言（开发约定 5.1）。
 * 为什么不“每次调用 new 一个组件”：那种做法要自己 createApp 挂载、样式与插件都得再来一份；
 * 而确认框是**模态**的 —— 同一时刻只该有一个，一个队列放在模块里就够了。
 * 队列本身也是保险：万一程序化地连来两条请求（模态框一出用户也点不到别处），第二条不会把第一条挤掉、
 * 更不会留下一条永远不 resolve 的 Promise。
 */
export type ConfirmTone = "danger" | "primary";

export interface ConfirmOptions {
  /** 一句短问句（对话框标题），如“删除《海阔天空》？” */
  title: string;
  /** 会发生什么、能不能撤销。把后果说清楚，别让用户猜 */
  description?: string;
  /** 确认键文案，默认“确定” */
  confirmText?: string;
  /** 取消键文案，默认“取消” */
  cancelText?: string;
  /** `danger`（默认）= 破坏性动作（红色）；`primary` = 普通批量动作（主题色） */
  tone?: ConfirmTone;
}

/** 交给界面的请求：调用方的选项 + 补好的默认值 + 一个自增 id */
export interface ConfirmRequest {
  id: number;
  title: string;
  description?: string;
  confirmText: string;
  cancelText: string;
  tone: ConfirmTone;
}

interface PendingConfirm {
  request: ConfirmRequest;
  resolve: (accepted: boolean) => void;
}

/** 待确认队列（FIFO）。模态框一出，用户点不到别的入口，所以通常只有一条 */
const queue: PendingConfirm[] = [];
let seq = 0;

/** 当前该显示的那条（没有就是 null）。界面直接读它 */
export const currentConfirm = shallowRef<ConfirmRequest | null>(null);

function sync(): void {
  currentConfirm.value = queue[0]?.request ?? null;
}

/** 问一句。resolve 成用户的选择（Esc / 点遮罩 / 点取消都算取消） */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    seq += 1;
    const request: ConfirmRequest = {
      id: seq,
      title: options.title,
      confirmText: options.confirmText ?? "确定",
      cancelText: options.cancelText ?? "取消",
      tone: options.tone ?? "danger",
    };
    if (options.description !== undefined) request.description = options.description;
    queue.push({ request, resolve });
    sync();
  });
}

/** 界面把用户的答案送回来（确定 / 取消 / Esc / 点遮罩都走这里）。没有待确认时是空操作 */
export function answerConfirm(accepted: boolean): void {
  const current = queue.shift();
  sync();
  current?.resolve(accepted);
}
