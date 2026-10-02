import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { usePlayerStore } from "@/stores/player";
import {
  EQ_BANDS,
  EQ_CUSTOM_NAME,
  EQ_FLAT_NAME,
  EQ_PRESETS,
  clampGain,
  clampMaster,
  defaultEqSettings,
  flatGains,
  matchPresetName,
  normalizeGains,
  presetByName,
  sanitizeEqSettings,
  type EqBandGains,
  type EqSettings,
} from "@/utils/equalizer";

/**
 * 均衡器与音效（PL-13）。
 *
 * 音频路径：`<audio>` → MediaElementSource → 10 段 BiquadFilterNode 链 → 整体增益
 * → 限幅器（DynamicsCompressorNode）→ 输出。
 *
 * 三条要紧的取舍：
 * 1. **设置存本地**（`localStorage`，每设备一份）：均衡器是“这套设备 + 这套耳机”的事，
 *    换台机器不该跟着走（PRD 也是这么写的）。
 * 2. **懒建图 + 只在跑起来之后才接线**：`AudioContext` 没拿到用户手势时是 suspended，
 *    把 `<audio>` 接进一个挂起的图里 = **静音**（最容易踩的坑）。所以建图、`resume()`、
 *    接线分三步，`resume()` 没成功就原样不动 —— 顶多是均衡器没生效，绝不会没声音。
 * 3. **A/B 关闭 = 真直通**：把 source 直接连输出，连限幅器都不经过；
 *    开启时才把它接进滤波链（PRD：“关闭时音频直通”）。
 */
const STORAGE_KEY = "qt-eq";
/** 每段的 Q：0.9~1.2 最接近“图形 EQ”的手感，太窄会像在挑单音 */
const BAND_Q = 1.1;
/** 参数变化用短斜坡推过去，拖动时不会有“咔哒” */
const RAMP_SECONDS = 0.02;

function loadSettings(): EqSettings {
  try {
    return sanitizeEqSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return defaultEqSettings();
  }
}

/** dB → 线性增益（整体增益用的就是普通 GainNode，它的单位是倍数） */
function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export const useEqualizerStore = defineStore("equalizer", () => {
  const player = usePlayerStore();
  const settings = ref<EqSettings>(loadSettings());

  const enabled = computed(() => settings.value.on);
  /** 下拉框里的全部预设：内置 → 自定义（虚拟项）→ 用户存下来的 */
  const presetNames = computed(() => [
    ...EQ_PRESETS.map((preset) => preset.name),
    EQ_CUSTOM_NAME,
    ...Object.keys(settings.value.custom),
  ]);
  const customNames = computed(() => Object.keys(settings.value.custom));

  /* ---------- Web Audio 图（懒建；浏览器没有 AudioContext 时整块功能静默不生效） ---------- */
  let ctx: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let filters: BiquadFilterNode[] = [];
  let master: GainNode | null = null;
  let limiter: DynamicsCompressorNode | null = null;

  function build(): void {
    if (ctx) return;
    if (typeof AudioContext === "undefined") return;
    ctx = new AudioContext();
    filters = EQ_BANDS.map((frequency, index) => {
      const filter = ctx!.createBiquadFilter();
      // 两端用搁架、中间用峰值：图形 EQ 的常规做法，两端拉起来更像“加低音/提空气感”
      filter.type =
        index === 0 ? "lowshelf" : index === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = frequency;
      if (filter.type === "peaking") filter.Q.value = BAND_Q;
      filter.gain.value = 0;
      return filter;
    });
    master = ctx.createGain();
    limiter = ctx.createDynamicsCompressor();
    // 限幅（PL-13：增益过大时限幅防爆音）：高压缩比 + 快启动，接近砖墙
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
  }

  /** 接线：A/B 开启 → 依次串滤波链；关闭 → 直通输出 */
  function route(): void {
    if (!ctx || !source) return;
    source.disconnect();
    if (!settings.value.on) {
      source.connect(ctx.destination);
      return;
    }
    let node: AudioNode = source;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(master!);
    master!.connect(limiter!);
    limiter!.connect(ctx.destination);
  }

  function pushValues(): void {
    if (!ctx) return;
    const now = ctx.currentTime;
    filters.forEach((filter, index) => {
      filter.gain.setTargetAtTime(settings.value.gains[index] ?? 0, now, RAMP_SECONDS);
    });
    master?.gain.setTargetAtTime(dbToGain(settings.value.master), now, RAMP_SECONDS);
  }

  /**
   * 让图真正开始工作。**必须由用户手势触发**（点开关 / 拖滑块 / 点播放）——
   * `resume()` 失败或状态还不是 running 时，我们什么都不接：宁可均衡器不生效，也不能静音。
   */
  async function activate(): Promise<void> {
    build();
    if (!ctx) return;
    try {
      await ctx.resume();
    } catch {
      /* 没有手势就等下一次（点播放时会再来一遍） */
    }
    if (ctx.state !== "running") return;

    const element = player.ensureAudio();
    if (!element) return;
    if (!source) source = ctx.createMediaElementSource(element);
    route();
    pushValues();
  }

  // 设置一变：存盘 + 应用到图上（没在图里就什么都不做）
  watch(
    settings,
    () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value));
      } catch {
        /* 存不进去也不影响本次使用 */
      }
      if (settings.value.on) void activate();
      else route();
      pushValues();
    },
    { deep: true },
  );

  // 打开均衡器之后第一次播放：借这个手势把图接上（此前一直被挂起）
  watch(
    () => player.playing,
    (playing) => {
      if (playing && settings.value.on) void activate();
    },
  );

  function syncPreset(): void {
    settings.value.preset = matchPresetName(settings.value.gains, settings.value.custom);
  }

  function setBand(index: number, gain: number): void {
    const gains = [...settings.value.gains];
    if (index < 0 || index >= gains.length) return;
    gains[index] = clampGain(gain);
    settings.value.gains = normalizeGains(gains);
    syncPreset();
  }

  function setMaster(gain: number): void {
    settings.value.master = clampMaster(gain);
  }

  /** 选预设：内置的直接取曲线，自定义的取存下来的那一条 */
  function applyPreset(name: string): void {
    const builtin = presetByName(name);
    if (builtin) {
      settings.value.gains = [...builtin.gains];
      settings.value.preset = builtin.name;
      return;
    }
    const custom = settings.value.custom[name];
    if (custom) {
      settings.value.gains = [...custom];
      settings.value.preset = name;
    }
  }

  /** 把当前曲线存成自定义预设（重名就覆盖，名字长度与空白都收一下） */
  function saveCustom(rawName: string): boolean {
    const name = rawName.trim().slice(0, 20);
    if (!name || name === EQ_CUSTOM_NAME || presetByName(name)) return false;
    settings.value.custom = { ...settings.value.custom, [name]: [...settings.value.gains] };
    settings.value.preset = name;
    return true;
  }

  function removeCustom(name: string): void {
    if (!settings.value.custom[name]) return;
    const custom: Record<string, EqBandGains> = { ...settings.value.custom };
    delete custom[name];
    settings.value.custom = custom;
    syncPreset();
  }

  /** A/B 对比开关 */
  function toggle(): void {
    settings.value.on = !settings.value.on;
  }

  /** 回到平直（保留开关状态，方便继续比） */
  function reset(): void {
    settings.value.gains = flatGains();
    settings.value.master = 0;
    settings.value.preset = EQ_FLAT_NAME;
  }

  return {
    settings,
    enabled,
    presetNames,
    customNames,
    setBand,
    setMaster,
    applyPreset,
    saveCustom,
    removeCustom,
    toggle,
    reset,
  };
});
