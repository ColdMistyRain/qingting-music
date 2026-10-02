import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchConfig } from "@/api/config";

export type ConfigStatus = "idle" | "loading" | "ready" | "error";

/** 服务端功能开关（目前只有在线音源开关，ON-04） */
export const useConfigStore = defineStore("config", () => {
  const onlineEnabled = ref(false);
  /** 单文件上传上限（字节）；后端未提供时为 null，页面用兑底文案 */
  const maxUploadSize = ref<number | null>(null);
  const status = ref<ConfigStatus>("idle");
  /** 读取失败的原因（与“真的没配音源”必须分开：后者要引导去改环境变量，前者重试就行） */
  const error = ref("");

  async function load(force = false): Promise<void> {
    if (status.value === "loading") return;
    if (status.value === "ready" && !force) return;

    status.value = "loading";
    try {
      const config = await fetchConfig();
      onlineEnabled.value = config.onlineEnabled;
      maxUploadSize.value = config.maxUploadSize ?? null;
      error.value = "";
      status.value = "ready";
    } catch {
      // v6.10 改：原先这里把失败也当成“未配置”（`onlineEnabled = false` + 永不重试），
      // 于是后端没起来也会让界面说“在线音源未配置、去改环境变量”，指错方向。
      // 现在只记错误：界面要么给“读取失败 + 重试”，要么用上一次的已知值。
      error.value = "配置没读出来";
      status.value = "error";
    }
  }

  return { onlineEnabled, maxUploadSize, status, error, load };
});
