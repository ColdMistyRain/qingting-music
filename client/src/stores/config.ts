import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchConfig } from "@/api/config";

/** 服务端功能开关（目前只有在线音源开关，ON-04） */
export const useConfigStore = defineStore("config", () => {
  const onlineEnabled = ref(false);
  const loaded = ref(false);

  async function load(): Promise<void> {
    if (loaded.value) return;
    try {
      const config = await fetchConfig();
      onlineEnabled.value = config.onlineEnabled;
    } catch {
      // 后端不可用时按"未配置"处理，界面提示配置指引而不是白屏
      onlineEnabled.value = false;
    } finally {
      loaded.value = true;
    }
  }

  return { onlineEnabled, loaded, load };
});
