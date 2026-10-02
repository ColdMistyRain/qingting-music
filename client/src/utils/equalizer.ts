/**
 * 均衡器与音效（PL-13）的纯逻辑：频段、预设、取值清洗。
 *
 * 10 段固定中心频率 31Hz~16kHz（PRD 的清单；正式实现走 Web Audio 的
 * BiquadFilterNode 链，见 `stores/equalizer.ts`）。界面上做的是 ±12dB 的
 * 图形 EQ 加一个整体增益，预设之外的曲线可以存成自定义预设。
 *
 * 与原型（mockup 的音效 Tab）保持同一组频率与曲线，但两处实现方式不同：
 * 原型是**视觉模拟**（原生 range 旋转 + 假数据），这里是给真音频用的数据层。
 */

/** 10 段中心频率（Hz），顺序就是界面从左到右的顺序 */
export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;
export const EQ_GAIN_STEP = 1;
/** 整体增益（相当于 EQ 之后的音量微调） */
export const EQ_MASTER_MIN = -10;
export const EQ_MASTER_MAX = 10;

/** 每段的增益（dB），长度与 EQ_BANDS 一致 */
export type EqBandGains = number[];

export interface EqPreset {
  name: string;
  gains: EqBandGains;
}

export const EQ_FLAT_NAME = "平直";
/** 手动改过任意一段之后，预设名就落到这个“虚拟预设”上（不参与匹配） */
export const EQ_CUSTOM_NAME = "自定义";

export const EQ_PRESETS: readonly EqPreset[] = [
  { name: EQ_FLAT_NAME, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "流行", gains: [-1, 1, 2, 3, 2, 0, -1, -1, 1, 2] },
  { name: "摇滚", gains: [3, 2, -1, -2, 0, 2, 3, 3, 2, 1] },
  { name: "爵士", gains: [2, 1, 0, 1, -1, 0, 1, 2, 2, 3] },
  { name: "古典", gains: [2, 2, 0, 0, 0, 0, -1, -1, 0, 2] },
];

export function flatGains(): EqBandGains {
  return new Array(EQ_BANDS.length).fill(0);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 单段增益：取整 + 夹到 ±12（界面的滑块是 1dB 步长） */
export function clampGain(value: number): number {
  return clamp(value, EQ_GAIN_MIN, EQ_GAIN_MAX);
}

/** 整体增益：夹到 ±10 */
export function clampMaster(value: number): number {
  return clamp(value, EQ_MASTER_MIN, EQ_MASTER_MAX);
}

/** 一整条曲线：长度不对或含脏值就整条退回平直（半条曲线只会让人以为坏了） */
export function sanitizeBandGains(value: unknown): EqBandGains {
  if (!Array.isArray(value) || value.length !== EQ_BANDS.length) return flatGains();
  return value.map((entry) => clampGain(Number(entry)));
}

export function normalizeGains(gains: readonly number[]): EqBandGains {
  return sanitizeBandGains([...gains]);
}

/** 界面上给频段用的短标签：1000 → 1k，其余原样 */
export function bandLabel(freq: number): string {
  return freq >= 1000 ? `${freq / 1000}k` : String(freq);
}

/** 增益读数：正数带 +，0 不带符号（单位 dB 由调用方拼） */
export function formatGain(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

export function presetByName(name: string): EqPreset | undefined {
  return EQ_PRESETS.find((preset) => preset.name === name);
}

/**
 * 这条曲线对应哪个预设名：与内置预设或自定义预设逐段相等就算命中，
 * 否则就是「自定义」。这样拖动任意一段之后，下拉框会自己从“流行”跳到“自定义”。
 */
export function matchPresetName(
  gains: readonly number[],
  custom: Record<string, EqBandGains> = {},
): string {
  const target = normalizeGains(gains).join(",");
  for (const preset of EQ_PRESETS) {
    if (preset.gains.join(",") === target) return preset.name;
  }
  for (const [name, curve] of Object.entries(custom)) {
    if (curve.join(",") === target) return name;
  }
  return EQ_CUSTOM_NAME;
}

export interface EqSettings {
  /** A/B 对比开关：关闭时音频直通（PL-13） */
  on: boolean;
  preset: string;
  gains: EqBandGains;
  master: number;
  /** 自定义预设：名字 → 曲线 */
  custom: Record<string, EqBandGains>;
}

export function defaultEqSettings(): EqSettings {
  return { on: false, preset: EQ_FLAT_NAME, gains: flatGains(), master: 0, custom: {} };
}

/**
 * 从本地存储读回来的东西一律过这里：手改坏的 JSON、旧版本的结构、
 * 名字重复/超长的自定义预设都不该让设置页崩。
 */
export function sanitizeEqSettings(value: unknown): EqSettings {
  const base = defaultEqSettings();
  if (!value || typeof value !== "object") return base;
  const raw = value as Record<string, unknown>;

  const custom: Record<string, EqBandGains> = {};
  if (raw.custom && typeof raw.custom === "object") {
    for (const [name, curve] of Object.entries(raw.custom as Record<string, unknown>)) {
      const key = name.trim().slice(0, 20);
      if (!key || key === EQ_CUSTOM_NAME) continue;
      custom[key] = sanitizeBandGains(curve);
    }
  }

  const gains = sanitizeBandGains(raw.gains);
  return {
    on: raw.on === true,
    preset: matchPresetName(gains, custom),
    gains,
    master: clampMaster(Number(raw.master ?? 0)),
    custom,
  };
}
