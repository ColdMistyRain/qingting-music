import type { Component } from "vue";
import { computed, type ComputedRef } from "vue";
import IconClockCounterClockwise from "~icons/ph/clock-counter-clockwise";
import IconGlobe from "~icons/ph/globe";
import IconHeartStraight from "~icons/ph/heart-straight";
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
    // 收藏与最近播放（PS-05）：两件不同的事，各占一个一级入口 —— 曾经合成一页
    // 「我的音乐」+ 两个页签，需求方反馈“这种布局让你迷惑”（两页签装的不是同一件事，
    // 侧栅也因此少了一个入口）。顺序：我收下的在前，我听过的在后。
    // 两者都是服务器功能，未登录（本地模式）不出现。
    items.push({ name: "favorites", label: "我的收藏", icon: IconHeartStraight });
    items.push({ name: "recent", label: "最近播放", icon: IconClockCounterClockwise });
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
