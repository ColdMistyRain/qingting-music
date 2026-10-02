/**
 * 节奏分析（v5.90，供“光晕跟随节奏”用）：把 AnalyserNode 的频谱变成**一个数** ——
 * 这一帧有多强（0~1）。
 *
 * 为什么不是“音量映射到亮度”：总音量跟着人声、副歌、淡出起伏，亮起来像随便呼吸，
 * 不是跟着节奏。所以分三层（都是纯函数，可单测）：
 *  ① **低频能量**：只取 40~160Hz（底鼓 + 贝斯基频，避开人声与镲片），而且取该频段的**峰值**
 *  ② **包络**：快起慢落（起 40ms / 落 350ms）—— 这一层才像“心跳”
 *  ③ **相对常态归一**：减掉慢跟随的基线、再除以常态波动 → “这一下比常态重多少”
 *
 * v5.91 需求方把目标收窄为“光晕随着节奏起伏就好，其他不用做那么多”，
 * 于是删掉了「自适应击打判定」与光斑几何（原来给 canvas 层用，见 git 历史 v5.90）；
 * 但①②③三层一个都不能少 —— 少了③只有 1.3% 的缩放变化（实测见 v5.91 记录），等于没动。
 */

/** 低频段：40~160Hz */
export const LOW_BAND_HZ = [40, 160] as const;
/** 包络时间常数（毫秒）：起得快、落得慢 */
export const ENVELOPE = { attackMs: 40, releaseMs: 350 } as const;
/** 基线（“这首歌现在有多响”）的跟随时间常数：慢到不会把鼓点自己吸进基线 */
export const BASELINE_MS = 2200;
/** 常态波动（“平时起伏多大”）的跟随时间常数 */
export const SPREAD_MS = 1400;
/** 波动下限：整段几乎没起伏（纯人声 / 弱鼓）时不要把噪声放大成闪烁 */
export const SPREAD_FLOOR = 0.05;
/** 归一的跨度 = 常态波动 × 这个倍数（取到 1 = 最重的那一下） */
export const SPREAD_GAIN = 1.6;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * 频段 → 频谱数组的下标范围（闭区间）。数据为空或换算不出有效区间时给 null。
 * 换算：每个 bin 的带宽 = 采样率 / fftSize。
 */
export function bandRange(
  bins: number,
  sampleRate: number,
  fftSize: number,
  from: number,
  to: number,
): [number, number] | null {
  if (!bins || !sampleRate || !fftSize || to <= from) return null;
  const perBin = sampleRate / fftSize;
  const start = Math.max(0, Math.floor(from / perBin));
  const end = Math.min(bins - 1, Math.ceil(to / perBin));
  return end > start ? [start, end] : null;
}

/**
 * 低频能量 → 0~1。`data` 是 `getByteFrequencyData` 填的字节数组（0~255）。
 *
 * 取该频段的**峰值**（不是均值、更不是和）：
 *  - 和/均值都会被频段宽度影响（频段宽度随采样率变），峰值两样都不受影响；
 *  - 均值还会把鼓点摊平 —— 一条 bin 从 120 冲到 220（0.47 → 0.86）时，
 *    5 条 bin 的均值只动 0.08。实测（v5.91，光辉岁月）：用均值时整首 `--beat`
 *    一直挤在 0.70~0.89，光晕的缩放只差 1.3%，肉眼等于没动。
 */
export function lowBandEnergy(
  data: Uint8Array | Uint8ClampedArray,
  sampleRate: number,
  fftSize: number,
): number {
  const range = bandRange(data.length, sampleRate, fftSize, LOW_BAND_HZ[0], LOW_BAND_HZ[1]);
  if (!range) return 0;
  let peak = 0;
  for (let i = range[0]; i <= range[1]; i += 1) {
    const value = data[i] ?? 0;
    if (value > peak) peak = value;
  }
  return peak / 255;
}

/**
 * 单极包络：上升用 attack、下降用 release（指数逼近，与帧率无关）。
 * 传进来的 `value` 是这一帧的原始强度，返回包络后的值。
 */
export function envelope(previous: number, value: number, dtMs: number): number {
  const tau = value > previous ? ENVELOPE.attackMs : ENVELOPE.releaseMs;
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return previous + (value - previous) * alpha;
}

/**
 * 一阶低通（指数逼近，与帧率无关）。估“常态”用：`tauMs` 越大越迟钝。
 */
export function follow(previous: number, value: number, dtMs: number, tauMs: number): number {
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));
  return previous + (value - previous) * alpha;
}

/**
 * 起伏 → 0~1：这一帧比**常态**重多少。
 *
 * 为什么非要减基线：同一首歌里主歌与副歌的绝对强度差很多，直接用绝对值的话
 * 要么整段常亮、要么整段不亮（音量大小也会整体影响它）。减掉基线之后量的是
 * “比平时重多少”，对音量与段落都不敏感 —— 安静的歌、响的歌都有一样的起伏。
 *
 * `spread` 是常态波动（慢慢跟随的 |值 − 基线|）：用它当跨度就自动适配了这首歌
 * 鼓点的强弱（这叫自动量程，不是击打判定 —— 没有阈值、没有历史窗口、不挑“哪一下算拍”）。
 * 波动太小时用下限兜住，免得把噪声放大成闪烁。
 */
export function pulse(value: number, baseline: number, spread: number): number {
  const span = Math.max(SPREAD_FLOOR, spread * SPREAD_GAIN);
  return clamp01((value - baseline) / span);
}
