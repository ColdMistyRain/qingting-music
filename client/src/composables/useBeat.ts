import { onScopeDispose, watch } from "vue";
import { useEqualizerStore } from "@/stores/equalizer";
import { usePlayerStore } from "@/stores/player";
import { useThemeStore } from "@/stores/theme";
import {
  BASELINE_MS,
  SPREAD_MS,
  envelope,
  follow,
  lowBandEnergy,
  pulse,
} from "@/utils/audioReactive";

/**
 * 节奏起伏（v5.90 立项，v5.91 按需求方收窄）：算出「这一帧音乐有多强」（归一后 0~1），
 * 把它写成 CSS 变量 `--beat` 挂在目标元素上，**表达全部交给 CSS**。
 *
 * v5.90 曾做成「一个循环 + 订阅者回调 + 每次击打随机甩一团光」的 canvas 层；
 * v5.91 需求方把目标收窄为“光晕会随着音乐的节奏起伏就好了，其他不用做那么多” ——
 * 于是只留**一个数**（低频能量的包络，再归一成“比常态重多少”），
 * `transform: scale()` 与 `opacity` 就够了。canvas 因此撤掉：它的价值（任意形状、
 * 随机光斑）用不上了，而逐帧光栅化比合成层变换贵得多（要回到“按拍甩光斑”那一版，
 * 见 git 历史 v5.90）。
 *
 * ⚠️ 归一那一步（减基线、除以常态波动）不能省：实测用均值做原始强度时，
 * 整首歌的 `--beat` 都挤在 0.70~0.89，光晕缩放只差 1.3% —— 等于没动。
 *
 * 只做一件事的好处：**没有降级分支**。拿不到频谱（还没手势 / 跨域音源 / 关了开关 /
 * 减动效）时 `--beat` 一直是 0，CSS 里就是纯底光 —— 不报错、不空转、也不需要兜底样式。
 *
 * 三个门都要过才会跑：① 在播 ② 设置里开着「光晕跟随节奏」 ③ 没开「减弱动效」。
 * 音频图是**懒建**的（`equalizer.activate()` 要用户手势），所以开跑时顺手踢一下。
 */
export const BEAT_VAR = "--beat";
/** 每帧写变量的最小变化量：低于它就跳过 —— 省掉大量无意义的样式失效 */
const WRITE_EPSILON = 0.004;

let loopId: number | null = null;
/** 包络后的原始强度（0~1） */
let smoothed = 0;
/** 这首歌当前的常态强度，以及常态波动 —— 归一用（见 utils/audioReactive 的 pulse） */
let baseline = 0;
let spread = 0;
let lastTs = 0;
let nextTry = 0;
let written = -1;
let analyserData: Uint8Array<ArrayBuffer> | null = null;
let getTarget: (() => HTMLElement | null) | null = null;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** 写变量：JS 只写**数值**，颜色与形状一律留在 CSS（铁律 3 的同一条思路） */
function write(value: number, force = false): void {
  const element = getTarget?.();
  if (!element) return;
  if (!force && Math.abs(value - written) < WRITE_EPSILON) return;
  written = value;
  element.style.setProperty(BEAT_VAR, value.toFixed(3));
}

function schedule(): void {
  if (loopId === null) loopId = requestAnimationFrame(tick);
}

function tick(ts: number): void {
  loopId = null;
  const equalizer = useEqualizerStore();
  const analyser = equalizer.getAnalyser();
  const dt = lastTs ? Math.min(64, Math.max(1, ts - lastTs)) : 16.7;
  lastTs = ts;

  // 图还没接上（用户还没产生过播放手势）—— 每半秒再试一次，这一帧先不写。
  // ⚠️ 必须继续排帧：不然循环第一帧就死了（v5.90 最初就是这么写的，一直没动静）
  if (!analyser) {
    if (ts >= nextTry) {
      nextTry = ts + 500;
      void equalizer.activate();
    }
    schedule();
    return;
  }

  // 缓冲区按当前 fftSize 重建 —— 类型要写 `Uint8Array<ArrayBuffer>`：
  // TS 5.9 起 `getByteFrequencyData` 只收这个（默认的 ArrayBufferLike 不收）
  if (analyserData?.length !== analyser.frequencyBinCount) {
    analyserData = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(analyserData);
  const energy = lowBandEnergy(analyserData, analyser.context.sampleRate, analyser.fftSize);
  smoothed = envelope(smoothed, energy, dt);
  baseline = follow(baseline, smoothed, dt, BASELINE_MS);
  spread = follow(spread, Math.abs(smoothed - baseline), dt, SPREAD_MS);
  write(pulse(smoothed, baseline, spread));

  schedule();
}

function stop(): void {
  if (loopId !== null) {
    cancelAnimationFrame(loopId);
    loopId = null;
  }
  smoothed = 0;
  baseline = 0;
  spread = 0;
  lastTs = 0;
  nextTry = 0;
  write(0, true);
}

/**
 * 开启节奏起伏。`getTarget` 给承载 `--beat` 的元素（通常是布局根节点）——
 * 传函数而不是元素本身，是因为调用发生在 setup 里，元素那时还没挂上。
 * 自动跟随「在播 / 开关 / 减弱动效」三个门启停；全局只有一个循环（模块级单例）。
 */
export function useBeat(target: () => HTMLElement | null): void {
  getTarget = target;
  const player = usePlayerStore();
  const theme = useThemeStore();

  function sync(): void {
    if (player.playing && theme.glowBeat && !reducedMotion()) schedule();
    else stop();
  }

  watch(() => [player.playing, theme.glowBeat], sync, { immediate: true });

  /* 组件卸载（切到别的沉浸页布局、退出沉浸页）时把循环停掉。
     `watch` 会随组件销毁自动失效，但**已经排出去的那一帧不会** —— 不停的话这个循环
     会一直跑到会话结束，每帧还要取一次频谱、做一轮归一（移动端就是白耗电，
     v6.8 实测：离开彩胶布局后仍在跑）。`getTarget` 先置空：`stop()` 里那句 `write(0)`
     要允许目标已经不在。 */
  onScopeDispose(() => {
    getTarget = null;
    stop();
  });
}
