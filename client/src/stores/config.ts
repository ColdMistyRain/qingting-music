import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchConfig } from "@/api/config";

/** 服务端功能开关（目前只有在线音源开关，ON-04） */
export const useConfigStore = defineStore("config", () => {
  const onlineEnabled = ref(false);
  /** 单文件上传上限（字节）；后端未提供时为 null，页面用兑底文案 */
  const maxUploadSize = ref<number | null>(null);
  const loaded = ref(false);

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const config = await fetchConfig();
      onlineEnabled.value = config.onlineEnabled;
      maxUploadSize.value = config.maxUploadSize ?? null;
    } catch {
      // 后端不可用时按"未配置"处理，界面提示配置指引而不是白屏
      onlineEnabled.value = false;
      maxUploadSize.value = null;
    } finally {
      loaded.value = true;
    }
  }

  return { onlineEnabled, maxUploadSize, loaded, load };
});
