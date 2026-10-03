/**
 * 频谱可视化（VS-05）的频段映射：把 AnalyserNode 的频率直方图压成 `count` 条
 * 条形图的能量值（0~1）。纯函数，输入输出都是普通数组，好测。
 *
 * 频段按**对数**分布：人耳对频率是对数感知，音乐的能量又集中在中低频 ——
 * 线性分布会让左半边狂跳、右半边整场死平。范围取 40Hz ~ 16kHz：
 * 40Hz 以下是直流/隆隆声，16kHz 以上音乐能量几乎为零，两端都是浪费条数。
 */

/** 对数频谱的下/上边界（Hz） */
export const SPECTRUM_MIN_HZ = 40;
export const SPECTRUM_MAX_HZ = 16000;

export function spectrumBands(
  freq: Uint8Array<ArrayBuffer>,
  sampleRate: number,
  count: number,
): number[] {
  if (count <= 0 || freq.length === 0) return [];
  // AnalyserNode 的频率直方图：bin 数 = fftSize / 2，第 b 个 bin 中心在 b * nyquist / bins
  const bins = freq.length;
  const hzPerBin = sampleRate / 2 / bins;
  const span = SPECTRUM_MAX_HZ / SPECTRUM_MIN_HZ;
  const out: number[] = [];
  // 划分式（不是各自取边界）：上一段的末端就是这一段的起点 —— 对数边界落不到整数 bin 上，
  // 各算各的会让边界 bin 的能量被相邻两段双计（单测抓过：41Hz 的能量漏进第二段）
  let prevHiBin = 1;
  for (let i = 0; i < count; i++) {
    const loHz = SPECTRUM_MIN_HZ * Math.pow(span, i / count);
    const hiHz = SPECTRUM_MIN_HZ * Math.pow(span, (i + 1) / count);
    const loBin = i === 0 ? Math.max(1, Math.floor(loHz / hzPerBin)) : prevHiBin;
    const hiBin = Math.max(loBin + 1, Math.min(bins, Math.ceil(hiHz / hzPerBin)));
    prevHiBin = hiBin;
    let sum = 0;
    for (let b = loBin; b < hiBin; b++) sum += freq[b] ?? 0;
    out.push(Math.min(1, sum / (hiBin - loBin) / 255));
  }
  return out;
}
