import { onUnmounted, watch } from "vue";
import { usePlayerStore } from "@/stores/player";
import {
  applyMetadata,
  applyPlaybackState,
  applyPosition,
  attachActions,
  type MediaTrackInfo,
} from "@/utils/mediaSession";

/**
 * RT-04：把播放器状态接到系统媒体控制（锁屏 / 通知栏 / 耳机按键）。
 *
 * 在 App.vue 里挂一次即可 —— 播放器 store 是单例，控制台页面下音乐照样在播，
 * 挂在 PlayerLayout 里会一进控制台就解绑。
 * 状态全部**从 store 单向流出**：这里不自己存一份“现在播的是哪首”，
 * 免得两处状态打架（Media Session 只是播放器状态的显示面）。
 */
export function useMediaSession(): void {
  const player = usePlayerStore();

  const detach = attachActions({
    play: () => void player.play(),
    pause: () => player.pause(),
    next: () => player.next(),
    prev: () => player.prev(),
    // 与键盘的「左右方向键 ±5 秒」同一档（PL-08）；锁屏进度条拖动不走这里
    seekBy: (seconds) => player.seekTo(player.progress + seconds),
  });

  watch(
    () => player.currentTrack,
    (track) => {
      const info: MediaTrackInfo | null = track
        ? {
            title: track.title,
            artist: track.artist,
            album: track.album,
            // Track.cover 是 string | null（本地文件可能没有内嵌封面），
            // MediaTrackInfo 用“可有可无”表达，所以在边界上归一成 undefined
            cover: track.cover ?? undefined,
          }
        : null;
      applyMetadata(info);
    },
    { immediate: true },
  );

  watch(
    () => player.playing,
    (playing) => applyPlaybackState(playing),
    { immediate: true },
  );

  // 进度：跟着 timeupdate（~4Hz）上报即可，引擎在两次上报之间自己插值。
  // 不额外节流 —— 4Hz 本身已经很稀，再抽一层只会让锁屏更容易停住不动。
  watch([() => player.duration, () => player.progress], ([duration, position]) =>
    applyPosition(duration, position),
  );

  onUnmounted(detach);
}
