import { onScopeDispose } from "vue";
import { useEqualizerStore } from "@/stores/equalizer";
import { usePlayerStore } from "@/stores/player";

/**
 * 频谱可视化（VS-05）的数据管线：全局只有一个 rAF 循环（与 useBeat 同一原则）。
 * ⚠️ **留库未接线（v6.55）**：需求方裁决频谱不上线，挂载已拆、管线保留备用（见 SpectrumBars）。
 * 每帧从**均衡器那份** AnalyserNode 读频率直方图，广播给订阅者（播放条迷你指示、
 * 沉浸页大图共用一份）。订阅者拿到原始直方图后各自用 `spectrumBands` 压成自己
 * 要的频段数 —— 循环不关心谁要几根条。
 *
 * 三种状态（组件按状态决定形态，需求原文"取不到数据自动隐藏"）：
 * - `live`：在播且有数据（有的曲目整段安静会短暂全 0，1 秒内不当断线，免得闪）
 * - `idle`：暂停 / 音频图还没建（还没有过播放手势）→ 条子落到地板高度，**不藏**
 * - `dead`：在播但数据持续全 0（跨域拿不到分析数据，v6.54 实测线上音源走
 *   crossOrigin 修复后正常有数据；这是兜底）→ 整体隐藏
 *
 * 音频图是懒建的：开跑时没图就每半秒踢一次 `equalizer.activate()`（useBeat 同款）。
 */

export type SpectrumState = "live" | "idle" | "dead";

export interface SpectrumFrame {
  /** 频率直方图；null = 没数据（订阅者应把条子落到地板高度） */
  data: Uint8Array<ArrayBuffer> | null;
  state: SpectrumState;
  sampleRate: number;
}

type SpectrumSubscriber = (frame: SpectrumFrame) => void;

/** 在播但频谱持续全 0 超过这个时长 → 判定"拿不到数据"（dead） */
const DEAD_AFTER_MS = 1000;

const subscribers = new Set<SpectrumSubscriber>();
let loopId: number | null = null;
let data: Uint8Array<ArrayBuffer> | null = null;
let zeroSince = 0;
let nextTry = 0;

function emit(frame: SpectrumFrame): void {
  for (const sub of subscribers) sub(frame);
}

function schedule(): void {
  if (loopId === null) loopId = requestAnimationFrame(tick);
}

function tick(ts: number): void {
  loopId = null;
  const equalizer = useEqualizerStore();
  const player = usePlayerStore();
  const analyser = equalizer.getAnalyser();

  // 图还没接上（没有过播放手势）：每半秒踢一次激活；这一帧按 idle 广播
  if (!analyser) {
    if (ts >= nextTry) {
      nextTry = ts + 500;
      void equalizer.activate();
    }
    data = null;
    emit({ data: null, state: "idle", sampleRate: 48000 });
    schedule();
    return;
  }

  if (data?.length !== analyser.frequencyBinCount) {
    data = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(data);

  if (!player.playing) {
    zeroSince = 0;
    emit({ data: null, state: "idle", sampleRate: analyser.context.sampleRate });
    schedule();
    return;
  }

  let allZero = true;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (!allZero) zeroSince = 0;
  else if (zeroSince === 0) zeroSince = ts;
  const dead = allZero && ts - zeroSince >= DEAD_AFTER_MS;

  emit({
    data,
    state: dead ? "dead" : "live",
    sampleRate: analyser.context.sampleRate,
  });
  schedule();
}

function start(): void {
  schedule();
}

function stop(): void {
  if (loopId !== null) {
    cancelAnimationFrame(loopId);
    loopId = null;
  }
  data = null;
  zeroSince = 0;
  nextTry = 0;
}

/** 订阅频谱帧；最后一个订阅者退订时停循环（组件 onScopeDispose 自动退） */
export function useSpectrum(subscriber: SpectrumSubscriber): void {
  subscribers.add(subscriber);
  start();
  onScopeDispose(() => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stop();
  });
}
