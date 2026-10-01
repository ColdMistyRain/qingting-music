import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Track } from "@qingting/shared";
import {
  nextMode as nextPlayMode,
  PLAY_MODE_LABELS,
  resolveNextIndex,
  resolvePrevIndex,
  shouldRestartTrack,
  type PlayMode,
} from "@/utils/player";
import { applyCoverColors } from "@/utils/coverColor";

const STORAGE_KEY = "qt-player";
/** PL-02：播放超过该秒数后按"上一首"回到本曲开头 */
const RESTART_THRESHOLD_SECONDS = 3;
/** 播放条提示的存活时间：瞬时信息（自动播放被拦、加载失败）不该长期占用位置 */
export const NOTICE_TTL_MS = 8000;
/**
 * 从 0 音量取消静音时的兜底音量。
 * 正常情况下会恢复到“上次能听见的音量”（lastAudibleVolume），
 * 这个值只在“一上来就是 0 音量”（例如存档里就是 0）时才用得上。
 */
const DEFAULT_AUDIBLE_VOLUME = 0.8;

interface PersistedPlayer {
  mode: PlayMode;
  volume: number;
  muted: boolean;
}

/**
 * 播放器单例 store（PRD 3.2）。
 * - 队列与模式等在 store 里统一维护，播放动作全部经由这里的四个纯函数（`utils/player.ts`）；
 * - 只创建一个 `<audio>` 元素，避免多曲目叠播；
 * - 无 DOM 环境（单测）下不创建 audio，只维护状态，所有动作自行降级。
 */
export const usePlayerStore = defineStore("player", () => {
  const queue = ref<Track[]>([]);
  const currentIndex = ref(-1);
  const playing = ref(false);
  const mode = ref<PlayMode>("list");
  const volume = ref(1);
  const muted = ref(false);
  /** 最近一次“能听见”的音量：静音 / 归零后解除静音时恢复到它，避免“取消了静音却仍听不见” */
  const lastAudibleVolume = ref(DEFAULT_AUDIBLE_VOLUME);
  const progress = ref(0);
  const duration = ref(0);
  /** 面向用户的即时提示（加载失败、自动播放被拦截等，PL-09） */
  const notice = ref("");
  const seeking = ref(false);
  const seekTarget = ref(0);
  /**
   * 当前曲目的歌词原文（LR-02 的数据入口：内嵌 > 在线 > 手动上传，管线稍后接入）。
   * 沉浸页只从这里取，不自己去找文件/接口——数据来源变了，页面不用动。
   */
  const lyricsText = ref("");

  let audio: HTMLAudioElement | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 粘性提示（如"加载失败已跳到下一首"）不会被"播放成功"清掉，但仍受超时限制 */
  let noticeSticky = false;

  /**
   * 设置播放条提示；传空串即清除，非空则在 NOTICE_TTL_MS 后自动消失。
   * sticky 用于跨事件的提示：加载失败的提示必须在自动跳到下一首后仍然看得见。
   */
  function notify(text: string, sticky = false): void {
    notice.value = text;
    noticeSticky = sticky && text !== "";
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    if (!text) return;
    noticeTimer = setTimeout(() => {
      notice.value = "";
      noticeSticky = false;
      noticeTimer = null;
    }, NOTICE_TTL_MS);
  }

  /** 播放真的起来了：清掉"点一下即可"这类瞬时提示，粘性提示保留 */
  function clearTransientNotice(): void {
    if (!noticeSticky) notify("");
  }

  const currentTrack = computed<Track | null>(() => queue.value[currentIndex.value] ?? null);
  const hasTrack = computed(() => currentTrack.value !== null);
  const modeLabel = computed(() => PLAY_MODE_LABELS[mode.value]);
  /** 拖拽进度条期间显示手指位置，松手才真正跳转（PL-03） */
  const displaySeconds = computed(() => (seeking.value ? seekTarget.value : progress.value));
  const displayRatio = computed(() => {
    const total = duration.value;
    if (!(total > 0)) return 0;
    return Math.min(1, Math.max(0, displaySeconds.value / total));
  });

  /**
   * 此刻的真实播放时间（秒）：沉浸页逐字填充要每帧取值，
   * 而 timeupdate 只有 ~4Hz，直接用 progress 会一跳一跳。
   */
  function sampleTime(): number {
    if (seeking.value) return seekTarget.value;
    return audio?.currentTime ?? progress.value;
  }

  function setLyrics(text: string): void {
    lyricsText.value = text;
  }

  /** 换曲即清空歌词：歌词永远属于当前曲目，留着会挂在新歌上 */
  watch(currentIndex, () => {
    lyricsText.value = "";
  });

  /**
   * VS-02：切歌时把封面的两个**原始色源**写到 <html> 上——
   * 页面环境光、彩胶盘体、主题色、逐字发光全部在 CSS 里从这两个值派生
   * （铁律 3：JS 不写内联 background）。
   * 曲目没有封面就撤掉变量、回到默认配色：按曲名去“编造”一个颜色是没有依据的。
   */
  watch(
    () => currentTrack.value?.cover ?? null,
    (url) => void applyCoverColors(url),
    { immediate: true },
  );

  function ensureAudio(): HTMLAudioElement | null {
    if (typeof Audio === "undefined") return null;
    if (audio) return audio;

    audio = new Audio();
    audio.preload = "metadata";
    audio.volume = volume.value;
    audio.muted = muted.value;
    // 挂进文档（隐藏）：便于在开发者工具里查看状态，后续 Media Session（RT-04）也依赖它在文档中
    if (typeof document !== "undefined" && document.body) {
      audio.style.display = "none";
      document.body.appendChild(audio);
    }

    // playing 以 audio 元素的实际状态为准：
    // 光靠命令式赋值会在"play() 被拦后音频又被放行"这类情况下与真实状态脱节
    audio.addEventListener("play", () => {
      playing.value = true;
      clearTransientNotice();
    });
    audio.addEventListener("pause", () => {
      playing.value = false;
    });

    audio.addEventListener("timeupdate", () => {
      if (!seeking.value) progress.value = audio?.currentTime ?? 0;
    });
    audio.addEventListener("loadedmetadata", () => {
      duration.value = audio?.duration ?? 0;
    });
    audio.addEventListener("ended", () => {
      handleEnded();
    });
    // PL-09：加载失败提示并自动跳下一曲，不打断整张列表的播放。
    // 先跳转再提示——playAt 会重置提示，反过来的话这条提示会被立刻清掉。
    audio.addEventListener("error", () => {
      next();
      notify("这首歌加载失败，已自动跳到下一首", true);
    });
    return audio;
  }

  /** 自然播完：单曲循环重播本曲，其余按模式取下一首 */
  function handleEnded(): void {
    if (mode.value === "one" && currentTrack.value) {
      seekTo(0);
      void play();
      return;
    }
    next();
  }

  async function play(): Promise<void> {
    const element = ensureAudio();
    if (!element || !hasTrack.value) return;
    try {
      await element.play();
      playing.value = true;
      // 只清"点一下即可"这类瞬时提示；加载失败的粘性提示要留着让用户看见
      clearTransientNotice();
    } catch {
      // 浏览器自动播放策略（iOS 尤其严格）：需要一次用户手势
      playing.value = false;
      notify("浏览器阻止了自动播放，点一下播放按钮即可");
    }
  }

  function pause(): void {
    if (audio) audio.pause();
    playing.value = false;
  }

  function toggle(): void {
    if (!hasTrack.value) {
      if (queue.value.length > 0) playAt(0);
      return;
    }
    if (playing.value) pause();
    else void play();
  }

  /** 播放队列中的某一首（PL-06 列表点击播放） */
  function playAt(index: number, autoplay = true): void {
    const track = queue.value[index];
    if (!track) return;
    currentIndex.value = index;
    progress.value = 0;
    duration.value = track.duration ?? 0;
    notify("");

    const element = ensureAudio();
    if (!element) return;
    element.src = track.url;
    if (autoplay) void play();
  }

  /** 下一曲（PL-05）：顺序播放到末尾即停止 */
  function next(): void {
    const index = resolveNextIndex(queue.value.length, currentIndex.value, mode.value);
    if (index < 0) {
      pause();
      progress.value = 0;
      return;
    }
    playAt(index);
  }

  /** 上一曲（PL-02）：播放超过 3 秒先回本曲开头，否则切上一曲 */
  function prev(): void {
    if (audio && shouldRestartTrack(audio.currentTime, RESTART_THRESHOLD_SECONDS)) {
      seekTo(0);
      return;
    }
    const index = resolvePrevIndex(queue.value.length, currentIndex.value, mode.value);
    if (index < 0) return;
    playAt(index);
  }

  function seekTo(seconds: number): void {
    const target = Math.max(0, duration.value > 0 ? Math.min(seconds, duration.value) : seconds);
    progress.value = target;
    if (audio) audio.currentTime = target;
  }

  function beginSeek(ratio: number): void {
    seeking.value = true;
    updateSeek(ratio);
  }

  function updateSeek(ratio: number): void {
    seekTarget.value = Math.min(1, Math.max(0, ratio)) * duration.value;
  }

  function endSeek(): void {
    if (!seeking.value) return;
    seeking.value = false;
    seekTo(seekTarget.value);
  }

  /** 音量/静音只影响 audio 的这两个属性，集中一处，避免漏同步 */
  function syncVolumeToAudio(): void {
    if (!audio) return;
    audio.volume = volume.value;
    audio.muted = muted.value;
  }

  /**
   * 音量（PL-04）。全局语义统一为“**音量为 0 就是静音**”，不再有“0%”与“已静音”两种说法：
   * - 拖到 0 → 直接按静音表现（图标/读数/滑杆与点静音键完全一致）；
   * - 拖到非 0 → 立即解除静音，并记住这个能听见的音量。
   */
  function setVolume(value: number): void {
    const next = Math.min(1, Math.max(0, value));
    volume.value = next;
    muted.value = next === 0;
    if (next > 0) lastAudibleVolume.value = next;
    syncVolumeToAudio();
    persist();
  }

  /**
   * 静音键：静音时（或被拉到 0 时）再点一下 = 恢复音量，而不是把 0 音的静音状态再翻一次
   * （否则会出现“点了取消静音还是没声音”）。
   */
  function toggleMute(): void {
    if (muted.value || volume.value === 0) {
      volume.value = lastAudibleVolume.value > 0 ? lastAudibleVolume.value : DEFAULT_AUDIBLE_VOLUME;
      muted.value = false;
    } else {
      lastAudibleVolume.value = volume.value;
      muted.value = true;
    }
    syncVolumeToAudio();
    persist();
  }

  function cycleMode(): void {
    mode.value = nextPlayMode(mode.value);
    persist();
  }

  /** 追加曲目；同 ID 视为重复，直接跳过并释放其 Blob URL，返回新增条数 */
  function addTracks(tracks: readonly Track[]): number {
    const existing = new Set(queue.value.map((track) => track.id));
    const fresh: Track[] = [];
    for (const track of tracks) {
      if (existing.has(track.id)) {
        releaseTrack(track);
        continue;
      }
      existing.add(track.id);
      fresh.push(track);
    }
    if (fresh.length === 0) return 0;
    queue.value = [...queue.value, ...fresh];
    return fresh.length;
  }

  /** 标签解析完成后回填曲目信息（LC-04：覆盖 LC-03 的文件名回退结果） */
  function patchTrack(id: string, patch: Partial<Track>): void {
    const track = queue.value.find((item) => item.id === id);
    if (!track) return;
    Object.assign(track, patch);
    if (currentTrack.value?.id === id && typeof patch.duration === "number") {
      duration.value = patch.duration;
    }
  }

  /** 时长回填的简写（读不出标签时的兜底） */
  function patchDuration(id: string, seconds: number): void {
    patchTrack(id, { duration: seconds });
  }

  function removeAt(index: number): void {
    const [removed] = queue.value.splice(index, 1);
    if (removed) releaseTrack(removed);

    if (queue.value.length === 0) {
      clear();
      return;
    }
    if (index < currentIndex.value) {
      currentIndex.value -= 1;
    } else if (index === currentIndex.value) {
      playAt(Math.min(index, queue.value.length - 1));
    }
  }

  /** 清空队列并释放本地 Blob URL（LC-06：不留存，同时避免内存泄漏） */
  function clear(): void {
    for (const track of queue.value) releaseTrack(track);
    queue.value = [];
    currentIndex.value = -1;
    progress.value = 0;
    duration.value = 0;
    notify("");
    pause();
    if (audio) audio.removeAttribute("src");
  }

  /** 释放 Blob URL（本地音频、内嵌封面），避免反复拖入后内存堆积 */
  function releaseTrack(track: Track): void {
    revokeBlob(track.url);
    if (track.cover) revokeBlob(track.cover);
  }

  function revokeBlob(url: string): void {
    const canRevoke = typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function";
    if (canRevoke && url.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  /** 持久化用户偏好（PL-04 音量记忆；曲目与进度见 PL-07，等云端曲目可用后再补） */
  function persist(): void {
    if (typeof localStorage === "undefined") return;
    const payload: PersistedPlayer = { mode: mode.value, volume: volume.value, muted: muted.value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  function restore(): void {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as Partial<PersistedPlayer>;
      if (data.mode && PLAY_MODE_LABELS[data.mode]) mode.value = data.mode;
      if (typeof data.volume === "number") volume.value = Math.min(1, Math.max(0, data.volume));
      if (typeof data.muted === "boolean") muted.value = data.muted;
      // 存档里音量 > 0 就把它当作可恢复音量，静音后取消静音不会突然跳到默认值
      if (volume.value > 0) lastAudibleVolume.value = volume.value;
      syncVolumeToAudio();
    } catch {
      // 存档损坏（手改 / 旧版本）时忽略，用默认值继续
    }
  }

  return {
    // 状态
    queue,
    currentIndex,
    playing,
    mode,
    volume,
    muted,
    lastAudibleVolume,
    progress,
    duration,
    notice,
    seeking,
    // 派生
    currentTrack,
    hasTrack,
    modeLabel,
    displaySeconds,
    displayRatio,
    lyricsText,
    sampleTime,
    setLyrics,
    // 动作
    play,
    pause,
    toggle,
    notify,
    playAt,
    next,
    prev,
    seekTo,
    beginSeek,
    updateSeek,
    endSeek,
    setVolume,
    toggleMute,
    cycleMode,
    addTracks,
    patchTrack,
    patchDuration,
    removeAt,
    clear,
    restore,
  };
});
