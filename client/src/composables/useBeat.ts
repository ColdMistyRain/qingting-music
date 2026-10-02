import { ref, watch, type Ref } from "vue";
import { useEqualizerStore } from "@/stores/equalizer";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";
import { ONSET_WINDOW, envelope, isOnset, lowBandEnergy } from "@/utils/audioReactive";

/**
 * 节奏（v5.90）：把音频分析成「这一帧多强 + 这一下是不是击打」，逐帧喂给订阅者。
 *
 * 为什么是「一个循环 + 订阅」而不是每个消费者各跑一个 rAF：
 * 分析只该做一次（同一份频谱），画面那边按帧画就行 —— 两处各跑一圈既重复又难同步。
 *
 * 三个门都要过才会跑：
 *  ① 在播（暂停就停：画面留住最后一帧，回调不再来）
 *  ② 设置里「光晕跟随节奏」开着（`theme.glowBeat`）
 *  ③ 没开「减弱动效」
 * 另外音频图是**懒建**的（`equalizer.activate()` 需要用户手势），所以这里在开跑时顺手
 * 踢一下 —— 拿不到分析节点就安静地不跑，画面退回纯 CSS 柔光（不报错、不空转）。
 *
 * 静音 / 拿到全零数据时 energy = 0，包络自然落到 0，击打也不会触发（见 audioReactive 单测）。
 */
export interface BeatFrame {
  /** 包络后的强度 0~1（快起慢落） */
  level: number;
  /** 这一帧是不是一次击打 */
  onset: boolean;
  /** 与上一帧的间隔（毫秒）：画布用它算衰减，别自己猜 16.7 */
  dt: number;
}

type BeatListener = (frame: BeatFrame) => void;

/** 当前强度（给需要响应式读的地方用；画布走订阅，不必每帧触发 Vue 更新） */
const level = ref(0);
const listeners = new Set<BeatListener>();

let loopId: number | null = null;
let history: number[] = [];
let current = 0;
let lastTs = 0;
let nextTry = 0;
let analyserData: Uint8Array<ArrayBuffer> | null = null;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function tick(ts: number): void {
  loopId = null;
  const equalizer = useEqualizerStore();
  const analyser = equalizer.getAnalyser();
  const dt = lastTs ? Math.min(64, Math.max(1, ts - lastTs)) : 16.7;
  lastTs = ts;

  // 图还没接上（用户还没产生过播放手势）—— 每半秒再试一次，这一帧先不画。
  // ⚠️ 必须继续排帧：不然循环第一帧就死了（最初就是这么写的，一直没动静）
  if (!analyser) {
    if (ts >= nextTry) {
      nextTry = ts + 500;
      void equalizer.activate();
    }
    schedule();
    return;
  }
  // 缓冲区按当前 fftSize 重建（换分析器 / 改 fftSize 时长度会变）——
  // 类型要写 `Uint8Array<ArrayBuffer>`：TS 5.9 起 `getByteFrequencyData` 只收这个（默认的 ArrayBufferLike 不收）
  if (analyserData?.length !== analyser.frequencyBinCount) {
    analyserData = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(analyserData);
  const energy = lowBandEnergy(analyserData, analyser.context.sampleRate, analyser.fftSize);
  current = envelope(current, energy, dt);

  history.push(current);
  if (history.length > ONSET_WINDOW) history.shift();
  const onset = isOnset(history, current);

  level.value = current;
  const frame: BeatFrame = { level: current, onset, dt };
  for (const listener of listeners) listener(frame);

  schedule();
}

function schedule(): void {
  if (loopId === null) loopId = requestAnimationFrame(tick);
}

function stop(): void {
  if (loopId !== null) {
    cancelAnimationFrame(loopId);
    loopId = null;
  }
  history = [];
  current = 0;
  lastTs = 0;
  nextTry = 0;
  level.value = 0;
}

/**
 * 订阅节奏帧。返回取消订阅的函数（组件卸载时调用）。
 * 组件里用：`const off = onBeat((f) => draw(f))`。
 */
export function onBeat(listener: BeatListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 在组件（或 App 级）里开启节奏分析。返回当前强度 ref，并自动跟随
 * 「在播 / 开关 / 减弱动效」三个门启停。
 */
export function useBeat(): { level: Ref<number> } {
  const player = usePlayerStore();
  const theme = useThemeStore();

  function sync(): void {
    if (player.playing && theme.glowBeat && !reducedMotion()) schedule();
    else stop();
  }

  watch(() => [player.playing, theme.glowBeat], sync, { immediate: true });

  return { level };
}
