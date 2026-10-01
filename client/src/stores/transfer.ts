import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * 本地列表 → 管理台上传页的**文件交接**（LC-07 快捷转存）。
 *
 * 两个页面不互相引用：本地页把 File 放进来，上传页 `take()` 取走并清空。
 * 一次性交接的好处是刷新/后退都不会重复上传，也不用把 File 塞进路由或 URL。
 */
export const useTransferStore = defineStore("transfer", () => {
  /** 待转存的文件（等上传页来取） */
  const pending = ref<File[]>([]);

  function queue(files: readonly File[]): void {
    pending.value = [...files];
  }

  /** 取走并清空（只会被上传页调用一次） */
  function take(): File[] {
    const files = pending.value;
    pending.value = [];
    return files;
  }

  return { pending, queue, take };
});
