/**
 * 节奏分析（v5.90，供“光晕跟随节奏”用）：把 AnalyserNode 的频谱变成两个数 ——
 * **这一帧有多强**（0~1）与**这一下是不是击打**。
 *
 * 为什么不是“音量映射到亮度”：总音量跟着人声、副歌、淡出起伏，亮起来像随便呼吸，
 * 不是跟着节奏。所以分三层，全在这里做（都是纯函数，可单测）：
 *  ① **低频能量**：只取 40~160Hz（底鼓 + 贝斯基频，避开人声与镲片）
 *  ② **包络**：快起慢落（起 40ms / 落 350ms）—— 这一层才像“心跳”
 *  ③ **自适应击打**：与该曲目最近的滑动平均比，超出一个倍数才算一次击打
 *     （固定阈值在安静段落永不触发、在炸的段落一直触发）
 */

/** 低频段：40~160Hz */
export const LOW_BAND_HZ = [40, 160] as const;
/** 包络时间常数（毫秒）：起得快、落得慢 */
export const ENVELOPE = { attackMs: 40, releaseMs: 350 } as const;
/** 判定为一次击打：超过滑动平均的这个倍数 */
export const ONSET_RATIO = 1.35;
/** 滑动平均的窗口（帧数，约 0.5s @60fps） */
export const ONSET_WINDOW = 30;
/** 判定击打的最低强度：静音 / 底噪不触发 */
export const ONSET_FLOOR = 0.12;
/** 基准至少要攒这么多帧才允许判定（否则开头会连着一串“击打”） */
export const ONSET_MIN_HISTORY = 8;

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
 * 取该频段的**均值**而不是和：频段宽度会随采样率变，用和会让高采样率设备偏大。
 */
export function lowBandEnergy(
  data: Uint8Array | Uint8ClampedArray,
  sampleRate: number,
  fftSize: number,
): number {
  const range = bandRange(data.length, sampleRate, fftSize, LOW_BAND_HZ[0], LOW_BAND_HZ[1]);
  if (!range) return 0;
  const [start, end] = range;
  let sum = 0;
  for (let i = start; i <= end; i += 1) sum += data[i] ?? 0;
  return Math.min(1, sum / (end - start + 1) / 255);
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
 * 自适应击打判定：拿**包络值**与最近窗口的均值比。
 * 基准不足（开头几帧）或强度低于地板值时一律不算 —— 否则一进歌就炸一串。
 */
export function isOnset(
  history: readonly number[],
  value: number,
  ratio = ONSET_RATIO,
  floor = ONSET_FLOOR,
): boolean {
  if (value < floor) return false;
  if (history.length < ONSET_MIN_HISTORY) return false;
  let sum = 0;
  for (const item of history) sum += item;
  const average = sum / history.length;
  return value > average * ratio;
}

/**
 * 画布用的基础光斑参数（纯函数，便于单测与“每次都是同一张底图”的确定性）：
 * 角度均分、角速度两两不同且与大小交替 —— 拼出来的形状才会缓慢变形而不是整体转。
 */
export function baseBlobs(count: number): { angle: number; speed: number; size: number }[] {
  const total = Math.max(1, Math.floor(count));
  return Array.from({ length: total }, (_, index) => ({
    angle: (index / total) * Math.PI * 2,
    // 速度取质数比，互不相同 → 相对相位一直在变（周期极长）
    speed: (index % 2 === 0 ? 1 : -1) * (0.06 + (index % 3) * 0.017),
    size: 0.5 + ((index * 7) % 5) * 0.08,
  }));
}
