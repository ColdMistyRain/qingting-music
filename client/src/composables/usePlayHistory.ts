import { watch } from "vue";
import { toPlaylistItem } from "@qingting/shared";
import { usePlayerStore } from "@/stores/player";
import { useListeningStore } from "@/stores/listening";

/**
 * 把“正在播什么”接给收藏 / 最近播放（PS-05）。挂在 `App.vue`（播放器是单例，
 * 挂到某个布局里一进控制台就断了 —— 与 `useMediaSession` 同一个理由）。
 *
 * 两件事：
 * 1. 启动时把收藏与最近播放拉下来（播放条上的收藏键要立刻显示对的状态）；
 * 2. **切歌时记一条历史**：看的是`当前曲目 id` 的变化，所以暂停/恢复不会重复记，
 *    同一首从头再播也不会凭空多一条（服务端那边同样按身份键去重 + 置顶）。
 */
export function usePlayHistory(): void {
  const player = usePlayerStore();
  const listening = useListeningStore();

  void listening.load();

  watch(
    () => player.currentTrack?.id ?? null,
    (id, previous) => {
      if (!id || id === previous) return;
      const track = player.currentTrack;
      if (!track) return;
      void listening.recordPlay(toPlaylistItem(track));
    },
  );
}
