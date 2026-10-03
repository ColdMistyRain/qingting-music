import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import type { Track } from "@qingting/shared";
import { fetchLyrics } from "@/api/songs";
import { fetchOnlineLyrics, fetchOnlineStreamUrl } from "@/api/online";
import {
  nextMode as nextPlayMode,
  PLAY_MODE_LABELS,
  resolveNextIndex,
  resolvePrevIndex,
  shouldRestartTrack,
  type PlayMode,
} from "@/utils/player";
import { applyCoverColors } from "@/utils/coverColor";
import { forgetLocalSource } from "@/utils/localFiles";
import {
  lyricsKey,
  pickLyricsSource,
  sanitizeImportedLyrics,
  withImportedLyric,
  withoutImportedLyric,
  type ImportedLyrics,
} from "@/utils/lyricsLibrary";
import { markCollectionTrackUnavailable } from "@/utils/onlineCollectionCache";
import { parseOnlineTrackId } from "@/utils/onlineTracks";
import { parseSnapshot, sanitizeSnapshot } from "@/utils/playerState";
import {
  AUTO_SKIP_DELAY_MS,
  createSkipScheduler,
  isServerTrack,
  serverReachable,
} from "@/utils/playbackFailure";
import {
  TOAST_DURATION_MS,
  TOAST_STICKY_DURATION_MS,
  dismissToast,
  showToast,
  type ToastTone,
} from "@/utils/toast";

const STORAGE_KEY = "qt-player";
/** 手动歌词库单独一份：它是偏好类数据，不该混进播放存档（存档要保持“小”） */
const IMPORTED_LYRICS_KEY = "qt-lyrics";
/** PL-07：进度存盘节流（timeupdate 约 4Hz，每 5 秒写一次就够；写得再勤只是浪费） */
const PROGRESS_PERSIST_INTERVAL_MS = 5000;
/** PL-02：播放超过该秒数后按"上一首"回到本曲开头 */
const RESTART_THRESHOLD_SECONDS = 3;
/**
 * 从 0 音量取消静音时的兜底音量。
 * 正常情况下会恢复到“上次能听见的音量”（lastAudibleVolume），
 * 这个值只在“一上来就是 0 音量”（例如存档里就是 0）时才用得上。
 */
const DEFAULT_AUDIBLE_VOLUME = 0.8;

/** 存档格式见 `utils/playerState.ts`（PL-04 偏好 + PL-07 队列与进度） */

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
  const seeking = ref(false);
  const seekTarget = ref(0);
  /**
   * 当前曲目的歌词原文（LR-02 的数据入口：内嵌 > 在线 > 手动上传，管线稍后接入）。
   * 沉浸页只从这里取，不自己去找文件/接口——数据来源变了，页面不用动。
   */
  const lyricsText = ref("");
  /**
   * 当前曲目的**翻译歌词**原文（v6.40，网易 tlyric；与 lyricsText 同时间轴的 LRC）。
   * 沉浸页在原文下方渲染。只有在线来源带翻译；切歌即清。
   */
  const lyricsTranslation = ref("");
  /**
   * 手动导入的歌词（LR-02 的第三条来源，v4.87）：按曲目存，刷新后还在。
   * 键的推导见 `utils/lyricsLibrary`：服务器/在线用 id，本地曲目用“歌手|曲名”（id 每次重生成）。
   */
  const importedLyrics = ref<ImportedLyrics>({});

  let audio: HTMLAudioElement | null = null;
  /** 最近一条**瞬时**提示的 id：播放真的起来了就把它收掉（粘性提示不受影响） */
  let transientToastId: number | null = null;
  /** 从存档恢复出来的进度：等元数据加载完才能 seek（设太早会被忽略） */
  let pendingSeconds = 0;
  /**
   * 加载失败后的**延时跳过**（v6.26）：等 3 秒再跳，用户在这段时间里自己换了歌就把它取消。
   * 为什么不是立刻跳：一首歌坏掉时，那 3 秒是用户唯一能“选别的听”的机会。
   */
  const autoSkip = createSkipScheduler(AUTO_SKIP_DELAY_MS, () => next());

  /**
   * 播放异常 / 状态提示（PL-09）—— 走应用内的**提示条**（v5.72，`utils/toast`）。
   *
   * 以前它是长在播放条信息区里的一行红字：位置局促、手机上把两行信息挤成三行，而且没有关闭入口。
   * 换成提示条之后，时长 / 悬停暂停 / 点关闭 / 滑动 / Esc 都由 `AppToast` 那套给，播放条一行都不用改。
   *
   * `sticky`：跨事件的提示（“这首歌无法播放，3 秒后跳下一首”）给更长的停留时间 ——
   * 它不能被“播放真的起来了”那句清掉。
   * `tone`：只有**出错**用 `danger`。颜色只表达状态，提示类一律中性色。
   * `description`：一句话说不完时才用（比如再补一句“该怎么办”）。
   */
  function notify(
    text: string,
    sticky = false,
    tone: ToastTone = "info",
    description?: string,
  ): void {
    if (!text) {
      clearTransientNotice();
      return;
    }
    const id = showToast({
      title: text,
      tone,
      duration: sticky ? TOAST_STICKY_DURATION_MS : TOAST_DURATION_MS,
      ...(description ? { description } : {}),
    });
    transientToastId = sticky ? null : id;
  }

  /** 播放真的起来了：收掉“点一下即可”这类瞬时提示，粘性提示保留 */
  function clearTransientNotice(): void {
    if (transientToastId === null) return;
    dismissToast(transientToastId);
    transientToastId = null;
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

  /* ---------- 手动歌词库（LR-02「用户手动上传 .lrc」的落点） ---------- */
  /** 当前曲目的手动歌词键；没有曲目时是空串 */
  const importedKey = computed(() => (currentTrack.value ? lyricsKey(currentTrack.value) : ""));
  /** 当前这首带手动歌词吗（菜单据此决定要不要给“恢复自带歌词”） */
  const hasImportedLyrics = computed(
    () => importedKey.value !== "" && importedKey.value in importedLyrics.value,
  );
  /**
   * 沉浸页只看这一个来源（优先级：手动 > 内嵌 > 在线，理由见 `utils/lyricsLibrary`）。
   * 页面不自己去找文件/接口——数据来源变了，页面不用动。
   */
  const lyricsSource = computed(() =>
    pickLyricsSource({
      imported: importedLyrics.value[importedKey.value],
      embedded: currentTrack.value?.lyrics,
      online: lyricsText.value,
    }),
  );

  /** 导入一份歌词文本；解析不出任何行时返回 false（调用方据此提示用户） */
  function importLyrics(text: string): boolean {
    const next = withImportedLyric(importedLyrics.value, importedKey.value, text);
    if (next === importedLyrics.value) return false;
    importedLyrics.value = next;
    notify("已导入歌词，这首歌将优先使用它");
    return true;
  }

  /** 清掉当前曲目的手动歌词，退回曲目自带/在线那份 */
  function clearImportedLyrics(): void {
    const next = withoutImportedLyric(importedLyrics.value, importedKey.value);
    if (next === importedLyrics.value) return;
    importedLyrics.value = next;
    notify("已恢复曲目自带的歌词");
  }

  /** 载入手动歌词库（读回来的东西一律过一遍 sanitize） */
  function restoreImportedLyrics(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(IMPORTED_LYRICS_KEY);
      importedLyrics.value = sanitizeImportedLyrics(raw ? JSON.parse(raw) : null);
    } catch {
      importedLyrics.value = {};
    }
  }

  // 改了就存（每次都是换新对象，浅监听就够）
  watch(importedLyrics, (map) => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(IMPORTED_LYRICS_KEY, JSON.stringify(map));
    } catch {
      // 配额满就不存：手动歌词是锦上添花，不该影响播放
    }
  });

  /** 换曲即清空歌词：歌词永远属于当前曲目，留着会挂在新歌上 */
  watch(currentIndex, () => {
    lyricsText.value = "";
    lyricsTranslation.value = "";
  });

  /* ---------- 云端曲目的内嵌歌词（LR-02）：开播时按需拉一次 ---------- */
  /** 已经去服务端问过的曲目：来回切歌不重复请求（问过没有就是没有） */
  const askedCloudLyrics = new Set<string>();

  /**
   * 拉取并回填内嵌歌词。
   * 回填到那条 Track 的 `lyrics` 上之后，它自然落进 `pickLyricsSource` 的「内嵌」档——
   * 优先级判定与沉浸页一行都不用改（手动导入仍然优先于它）。
   * 拿不到就安静地当这首歌没内嵌歌词：手动导入与在线两条路仍然可用。
   */
  async function loadCloudLyrics(track: Track | null): Promise<void> {
    if (!track || track.source !== "server" || !track.hasLyrics) return;
    if (track.lyrics != null || askedCloudLyrics.has(track.id)) return;
    askedCloudLyrics.add(track.id);
    try {
      const { lyrics } = await fetchLyrics(track.id);
      if (lyrics) patchTrack(track.id, { lyrics });
    } catch {
      // 服务端不可用/这首歌已被删：不影响播放，也不影响手动与在线来源
    }
  }

  /* ---------- 在线曲目的歌词（ON-05 / LR-02 第三优先级）---------- */
  /** 问过、**确实没有**歌词的曲目：切来切去不重复请求（失败不记，下次还会试） */
  const askedOnlineLyrics = new Set<string>();
  /**
   * 拉到过的歌词按曲目存一份（会话级、有上限）：`lyricsText` 在切歌时会被清空，
   * 不缓存的话“切走再切回”就得重新发请求，来回听歌的体验是歌词时有时无。
   */
  const onlineLyricsCache = new Map<string, { lyrics: string; translation: string }>();
  /** 上限的理由与手动歌词库一致：歌词很小，但架不住攒得多 */
  const ONLINE_LYRICS_CACHE_LIMIT = 30;

  function cacheOnlineLyrics(id: string, entry: { lyrics: string; translation: string }): void {
    if (onlineLyricsCache.has(id)) onlineLyricsCache.delete(id);
    onlineLyricsCache.set(id, entry);
    while (onlineLyricsCache.size > ONLINE_LYRICS_CACHE_LIMIT) {
      const oldest = onlineLyricsCache.keys().next().value;
      if (oldest === undefined) break;
      onlineLyricsCache.delete(oldest);
    }
  }

  /**
   * 在线曲目的歌词进的是 `lyricsText`（`pickLyricsSource` 里的「在线」档）：
   * 优先级仍是 手动 > 内嵌 > 在线，沉浸页与菜单一行都不用改。
   * 音源拿不到就安静地当这首歌没歌词；失败也不打扰播放。
   */
  async function loadOnlineLyrics(track: Track | null): Promise<void> {
    if (!track || track.source !== "online") return;
    const parsed = parseOnlineTrackId(track.id);
    if (!parsed) return;

    // 缓存命中直接给：这一步是同步的，切回来马上就有
    const cached = onlineLyricsCache.get(track.id);
    if (cached !== undefined) {
      lyricsText.value = cached.lyrics;
      lyricsTranslation.value = cached.translation;
      return;
    }
    if (askedOnlineLyrics.has(track.id)) return;

    try {
      const { lyrics, translation } = await fetchOnlineLyrics(parsed.provider, parsed.nativeId);
      // 请求回来时可能已经切歌：歌词永远属于当前曲目
      if (currentTrack.value?.id !== track.id) return;
      if (lyrics) cacheOnlineLyrics(track.id, { lyrics, translation: translation ?? "" });
      else askedOnlineLyrics.add(track.id);
      lyricsText.value = lyrics ?? "";
      lyricsTranslation.value = translation ?? "";
    } catch {
      // 音源不可用就不给歌词，不影响播放与手动导入；下次切回还会再试
    }
  }

  watch(
    currentTrack,
    (track) => {
      void loadCloudLyrics(track);
      void loadOnlineLyrics(track);
    },
    { immediate: true },
  );

  /* ---------- 在线曲目的播放直链（ON-03）：开播前现解析 ---------- */
  /**
   * 解析结果：`unavailable` = 音源明确说没有（VIP / 无版权，业务结果）；
   * `failed` = 请求本身没成（后端断了 / 音源 502）。两种提示不一样。
   */
  type OnlineResolution =
    | { ok: true; url: string }
    | { ok: false; reason: "unavailable" | "failed" };

  /** 同一首的并发解析只发一次请求（快速连点 / 连续切歌都会撞上） */
  const streamResolutions = new Map<string, Promise<OnlineResolution>>();

  /**
   * 拿到**可播**的地址（队列/存档里的在线曲目 url 是空串 —— 直链是会过期的签名地址）。
   * 解析成功回填到那条 Track 上，下次播它就不用再问了。
   */
  async function resolveOnlineUrl(track: Track): Promise<OnlineResolution> {
    if (track.url) return { ok: true, url: track.url };
    const parsed = parseOnlineTrackId(track.id);
    if (!parsed) return { ok: false, reason: "unavailable" };

    let pending = streamResolutions.get(track.id);
    if (!pending) {
      pending = fetchOnlineStreamUrl(parsed.provider, parsed.nativeId)
        .then((url): OnlineResolution => {
          if (url) patchTrack(track.id, { url });
          return url ? { ok: true, url } : { ok: false, reason: "unavailable" };
        })
        .catch((): OnlineResolution => ({ ok: false, reason: "failed" }))
        .finally(() => streamResolutions.delete(track.id));
      streamResolutions.set(track.id, pending);
    }
    return pending;
  }

  /** 直链解析失败的两种说法（ON-03：VIP/无版权要给明确提示） */
  function notifyStreamFailure(reason: "unavailable" | "failed"): void {
    notify(
      reason === "unavailable" ? "这首歌需要 VIP 或暂无版权，暂时无法播放" : "在线音源暂时连不上，这首先放不了",
      true,
      "danger",
    );
  }

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
      // 暂停即存：下次打开就停在离开的地方（PL-07）
      persist();
    });

    audio.addEventListener("timeupdate", () => {
      if (!seeking.value) progress.value = audio?.currentTime ?? 0;
      scheduleProgressPersist();
    });
    audio.addEventListener("loadedmetadata", () => {
      duration.value = audio?.duration ?? 0;
      // 存档里的进度到这里才能落地（元数据没加载时设 currentTime 会被忽略）
      if (pendingSeconds > 0 && audio) {
        audio.currentTime = Math.min(pendingSeconds, duration.value || pendingSeconds);
        progress.value = audio.currentTime;
        pendingSeconds = 0;
      }
    });
    audio.addEventListener("ended", () => {
      handleEnded();
    });
    // PL-09（v6.26 修订）：失败要**先分清“这一首坏了”还是“服务器断了”**，再决定跳不跳。
    // 服务器断线还一首首往下跳，等于把“后端挂了”演成“整个列表都坏了”（列表循环下永远停不下来）。
    audio.addEventListener("error", () => {
      void handlePlaybackFailure();
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
    // 存档恢复的在线曲目没有直链（url 已置空，src 也没设）：按播放键时现解析
    const track = currentTrack.value;
    if (track && track.source === "online" && !track.url) {
      const resolved = await resolveOnlineUrl(track);
      if (currentTrack.value?.id !== track.id) return;
      if (!resolved.ok) {
        notifyStreamFailure(resolved.reason);
        return;
      }
      element.src = resolved.url;
    }
    try {
      await element.play();
      playing.value = true;
      // 只清"点一下即可"这类瞬时提示；加载失败的粘性提示要留着让用户看见
      clearTransientNotice();
    } catch {
      playing.value = false;
      // 加载失败（服务器断了 / 文件坏了）也会让这个 promise 被拒：那条路有自己的说法
      // （`handlePlaybackFailure`），**别把它误报成“浏览器拦住自动播放”** —— 那会把人指到错方向
      if (element.error) return;
      // 浏览器自动播放策略（iOS 尤其严格）：需要一次用户手势
      notify("浏览器阻止了自动播放，点一下播放按钮即可");
    }
  }

  /**
   * 加载失败的收尾（PL-09，v6.26 修订）。
   *
   * 两件事：① **分清“这一首坏了”还是“服务器断了”**（云端曲目才问服务器，本地是 Blob 不涉及）；
   * ② 这一首坏了 → 排一次 **3 秒后**的跳过，把选择权交回用户。
   */
  async function handlePlaybackFailure(): Promise<void> {
    const track = currentTrack.value;
    if (!track) return;
    // 加载失败会让 `play()` 的 promise 被拒，那里可能刚弹了一条“浏览器拦住自动播放”——先收掉它
    clearTransientNotice();
    // 同一首又失败一次（浏览器会重复派 error）：别重排、也别把提示又叠一遍
    if (autoSkip.pending()) return;

    if (isServerTrack(track.source) && !(await serverReachable())) {
      // 探测是异步的，回来时用户可能已经自己换了歌 —— 换了就当这次失败没发生过
      if (currentTrack.value?.id !== track.id) return;
      autoSkip.cancel();
      notify(
        "连接不上服务器，云端曲目暂时无法播放",
        true,
        "danger",
        "请确认后端已启动；恢复后点一下播放就能接着听",
      );
      pause();
      return;
    }
    if (currentTrack.value?.id !== track.id) return;
    scheduleAutoSkip();
  }

  /** 这一首坏了：等 3 秒再跳（这 3 秒是用户换歌的机会） */
  function scheduleAutoSkip(): void {
    const index = resolveNextIndex(queue.value.length, currentIndex.value, mode.value);
    // `-1` = 顺序播到末尾；**等于当前下标** = 单曲循环（那里的“下一首”就是本曲）——
    // 两种都没有别的可跳，否则坏文件会每 3 秒重试一次，又成了另一种“永远跳不完”
    if (index < 0 || index === currentIndex.value) {
      notify("这首歌无法播放，先停在这里", true, "danger", "可以点列表里别的曲目，或换个播放模式");
      pause();
      return;
    }
    notify("这首歌无法播放，3 秒后跳下一首", true, "danger", "想听别的，现在点列表里那一首就行");
    autoSkip.schedule();
  }

  function pause(): void {
    // 用户按了暂停 = 他自己接管了：把那个“3 秒后跳下一首”撤销（否则刚暂停就被跳走）
    autoSkip.cancel();
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

  /**
   * 播放队列中的某一首（PL-06 列表点击播放）。
   * 在线曲目在这里**现解析播放直链**（ON-03）——队列/存档里的在线曲目没有地址，
   * 直链是会过期的签名地址，提前解析只会存下放不出的死链。
   */
  async function playAt(index: number, autoplay = true): Promise<void> {
    const track = queue.value[index];
    if (!track) return;
    // 用户自己点了某一首（也可能就是自动跳过自己）：无论哪种，先前那个待跳都不再需要
    autoSkip.cancel();
    currentIndex.value = index;
    progress.value = 0;
    duration.value = track.duration ?? 0;
    pendingSeconds = 0;
    notify("");
    persist();

    if (track.source === "online" && !track.url) {
      const resolved = await resolveOnlineUrl(track);
      // 解析是异步的，回来时用户可能已经点了别的歌 —— 不是这首了就当这次没发生
      if (currentTrack.value?.id !== track.id) return;
      if (!resolved.ok) {
        // 回写真实可播状态（v6.35 补 6 的留白落地）：标着「试听」却连试听片段
        // 都没拿到（账号/区域策略），行内标当场从「试听」翻成「无版权」，
        // 不让徽标继续过度承诺；队列与播放存档都带这个标记
        patchTrack(track.id, { unavailable: true });
        // 集合缓存里的同一条目也标上（跨刷新持久，v6.36 留白落地）
        const parsedId = parseOnlineTrackId(track.id);
        if (parsedId) markCollectionTrackUnavailable(parsedId.provider, parsedId.nativeId);
        // 不自动跳（对比坏文件的 3 秒跳过）：VIP/无版权是这首歌**已知**的属性，
        // 一首首自动跳下去就成了另一种"自己换歌"，提示说清楚、停在这里即可
        notifyStreamFailure(resolved.reason);
        pause();
        return;
      }
      track.url = resolved.url;
    }

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
    // 跳过之后就存：用户很可能就是停在跳过去的那段听的（PL-07）
    persist();
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

  /**
   * 整单替换并开播（PS-03 播放歌单）：先清空（释放旧的 Blob URL / 登记），再放进新的一批。
   * 从 `startIndex` 那一首开始播；越界时夹回合法范围。
   */
  function setQueue(tracks: readonly Track[], startIndex = 0): void {
    clear();
    if (tracks.length === 0) return;
    queue.value = [...tracks];
    const index = Math.min(Math.max(startIndex, 0), tracks.length - 1);
    currentIndex.value = index;
    persist();
    playAt(index);
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
    persist();
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
      return;
    }
    persist();
  }

  /** 清空队列并释放本地 Blob URL（LC-06：不留存，同时避免内存泄漏） */
  function clear(): void {
    for (const track of queue.value) releaseTrack(track);
    queue.value = [];
    currentIndex.value = -1;
    progress.value = 0;
    duration.value = 0;
    pendingSeconds = 0;
    notify("");
    pause();
    if (audio) audio.removeAttribute("src");
    persist();
  }

  /** 释放 Blob URL（本地音频、内嵌封面），避免反复拖入后内存堆积 */
  function releaseTrack(track: Track): void {
    revokeBlob(track.url);
    if (track.cover) revokeBlob(track.cover);
    // LC-07：原始 File 也跟着忘掉（登记处与 Blob URL 的生命周期保持一致，
    // 否则转存时拿着一个早已移除的曲目的 File）
    forgetLocalSource(track.id);
  }

  function revokeBlob(url: string): void {
    const canRevoke = typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function";
    if (canRevoke && url.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  /** 存盘（PL-04 偏好 + PL-07 队列与进度）：只存**刷新后能续上**的曲目，见 utils/playerState */
  function persist(): void {
    if (typeof localStorage === "undefined") return;
    const snapshot = sanitizeSnapshot({
      mode: mode.value,
      volume: volume.value,
      muted: muted.value,
      queue: queue.value,
      currentIndex: currentIndex.value,
      seconds: progress.value,
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // 隐私模式 / 配额满：存不上就不存，不影响播放
    }
  }

  /** 进度存盘的节流（timeupdate 触发得太密） */
  let lastPersistAt = 0;
  function scheduleProgressPersist(): void {
    const now = Date.now();
    if (now - lastPersistAt < PROGRESS_PERSIST_INTERVAL_MS) return;
    lastPersistAt = now;
    persist();
  }

  /**
   * 读盘（PL-07）：偏好 + 队列 + 进度。
   * **恢复后不自动播放**：浏览器本来也会拦自动播放，而且用户没点播放，
   * 摆好曲目与进度、等用户按一下即可。
   */
  function restore(): void {
    restoreImportedLyrics();
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    const snapshot = parseSnapshot(raw);
    if (!snapshot) return;

    mode.value = snapshot.mode;
    volume.value = Math.min(1, Math.max(0, snapshot.volume));
    muted.value = snapshot.muted;
    // 存档里音量 > 0 就把它当作可恢复音量，静音后取消静音不会突然跳到默认值
    if (volume.value > 0) lastAudibleVolume.value = volume.value;
    syncVolumeToAudio();

    // 本地曲目是 Blob 地址，刷新后文件已经不在了——丢掉它们是诚实的，但要告诉用户
    const dropped = snapshot.droppedLocalTracks;

    queue.value = snapshot.queue;
    currentIndex.value = snapshot.currentIndex;
    const track = currentTrack.value;
    if (track) {
      duration.value = track.duration ?? 0;
      progress.value = snapshot.seconds;
      pendingSeconds = snapshot.seconds;
      const element = ensureAudio();
      // 只预载元数据把时长与进度摆好，不 play()。
      // 在线曲目的直链在存档里是空串（会过期的签名地址）：src 不设，
      // 等用户按播放时现解析（`play()` 里的那段）；这时长直接用存档里带的。
      if (element && track.url) element.src = track.url;
    }

    if (dropped > 0) {
      notify(`本地曲目刷新后无法自动恢复，已去掉 ${dropped} 首，需要时重新选文件`, true, "danger");
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
    seeking,
    // 派生
    currentTrack,
    hasTrack,
    modeLabel,
    displaySeconds,
    displayRatio,
    lyricsText,
    lyricsTranslation,
    importedLyrics,
    hasImportedLyrics,
    lyricsSource,
    sampleTime,
    setLyrics,
    importLyrics,
    clearImportedLyrics,
    // 动作
    ensureAudio,
    play,
    pause,
    toggle,
    notify,
    playAt,
    setQueue,
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
