/**
 * 输入焦点判定（PRD PL-01：空格键切换播放/暂停）。
 * 用户在输入框里敲空格不应该触发播放，所以要先判断焦点落在哪。
 */

export interface EditableLike {
  tagName?: string;
  isContentEditable?: boolean;
}

const EDITABLE_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

/** 焦点是否在可编辑控件里（输入框 / 文本域 / 下拉 / contenteditable） */
export function isEditableTarget(target: EditableLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag !== undefined && EDITABLE_TAGS.includes(tag);
}
