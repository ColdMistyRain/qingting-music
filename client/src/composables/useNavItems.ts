import type { Component } from "vue";
import { computed, type ComputedRef } from "vue";
import IconGlobe from "~icons/ph/globe";
import IconHouse from "~icons/ph/house";
import IconMusicNotes from "~icons/ph/music-notes";
import { useAuthStore } from "@/stores/auth";
import { useConfigStore } from "@/stores/config";

export interface NavItem {
  name: string;
  label: string;
  icon: Component;
}

/**
 * 一级导航项：侧栏与手机底部标签栏**共用一份**（RT-02）。
 * 两处各写一份必然漂 —— 加一个入口得记得改两个地方，早晚漏一个。
 * 只放“一级入口”；**设置不在其中**：侧栏把它放页脚、手机放标签栏最后一位，
 * 位置由调用方决定（见 AppSidebar / MobileTabBar）。
 */
export function pickNavItems(opts: { canUseServer: boolean; onlineEnabled: boolean }): NavItem[] {
  const items: NavItem[] = [{ name: "local", label: "本地播放", icon: IconHouse }];
  // AC-01：未登录只留本地播放；ON-04：音源未配置时连入口都不出现
  if (opts.canUseServer) {
    items.push({ name: "library", label: "音乐库", icon: IconMusicNotes });
    if (opts.onlineEnabled) items.push({ name: "online", label: "在线搜索", icon: IconGlobe });
  }
  return items;
}

/** 把上面那份接上身份与音源配置（纯函数在 pickNavItems 里，便于单测） */
export function useNavItems(): ComputedRef<NavItem[]> {
  const auth = useAuthStore();
  const config = useConfigStore();
  return computed(() =>
    pickNavItems({ canUseServer: auth.canUseServer, onlineEnabled: config.onlineEnabled }),
  );
}
