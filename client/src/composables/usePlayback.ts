import { computed, type Component } from "vue";
import IconArrowRight from "~icons/ph/arrow-right";
import IconPause from "~icons/ph/pause";
import IconPlay from "~icons/ph/play";
import IconRepeat from "~icons/ph/repeat";
import IconRepeatOnce from "~icons/ph/repeat-once";
import IconShuffle from "~icons/ph/shuffle";
import { usePlayerStore } from "@/stores/player";
import type { PlayMode } from "@/utils/player";

/**
 * 播放控件的共用状态（播放条 `PlayerBar` 与沉浸页 `ImControls` 共用，v6.11）。
 *
 * 解决的是**同一套东西写两遍必然走偏**的老问题：模式图标、播放/暂停图标、总时长
 * 原先在两处各写了一份（v6.8 只留了一句“记得同步另一处”的注释）——
 * 例如以后新增一种播放模式，只改一边就会出现“播放条上有、沉浸页上没有”。
 *
 * 为什么不给这几行加单测：`MODE_ICONS` 的类型是 `Record<PlayMode, Component>`，
 * 漏一种模式**当场类型检查就报错**，比断言更硬；其余三行是从 store 派生的取值，
 * 真正有算法的部分（键盘跳转）已经收在 `utils/seek.ts` 并有单测。
 */
const MODE_ICONS: Record<PlayMode, Component> = {
  seq: IconArrowRight,
  list: IconRepeat,
  one: IconRepeatOnce,
  random: IconShuffle,
};

export function usePlayback() {
  const player = usePlayerStore();

  const modeIcon = computed(() => MODE_ICONS[player.mode]);
  const playIcon = computed(() => (player.playing ? IconPause : IconPlay));
  /** 总时长：优先用音频元素报上来的 `duration`，退回曲目自己的时长（还没解码时用） */
  const totalSeconds = computed(() => player.duration || player.currentTrack?.duration || 0);

  return { player, modeIcon, playIcon, totalSeconds };
}
