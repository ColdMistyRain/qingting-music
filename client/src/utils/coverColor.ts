/**
 * 封面取色（VS-02）。
 *
 * 职责边界（铁律 3）：本模块只做一件事——**从封面像素里量出两个原始色源**（hex）。
 * 亮度/彩度夹取、`--cv1/--cv2`、页面环境光、彩胶盘体漩涡、主题色、逐字发光
 * 全部在 CSS 用 OKLCH 相对颜色派生；JS 一个内联 background 都不写（原型踩过两次）。
 *
 * 拆成两半：
 * - `extractCoverColors` 是**纯函数**（不碰 DOM，可单测）；
 * - `applyCoverColors` 负责加载图片 → 画进 canvas → 把两个变量写到 `<html>`。
 */

export interface CoverColors {
  /** 主色源：封面里权重最高的色族 */
  primary: string;
  /** 次色源：与主色**异族**的第二色族；封面只有一个色族时取同色相的浅一档 */
  secondary: string;
}

/** 采样边长：32×32 足够量出主色，也只需要读 1024 个像素 */
const SAMPLE_SIZE = 32;
/** 色相分桶数（每桶 30°） */
const HUE_BUCKETS = 12;
const HUE_PER_BUCKET = 360 / HUE_BUCKETS;
/** 彩度低于此的像素不投票：灰阶背景、白底不该决定整页配色 */
const MIN_SATURATION = 0.1;
/** 太暗/太亮的像素同样排除（纯黑边框、高光溢出） */
const MIN_LIGHTNESS = 0.08;
const MAX_LIGHTNESS = 0.95;
/** 两色族的色相差小于此值视为同族（一桶 30°，所以要隔一桶以上） */
const FAMILY_HUE_GAP = 40;
/** 只有一个色族时，次色源取**同色相**的浅一档（色相不旋转） */
const SECONDARY_LIGHTNESS_STEP = 0.14;
const SECONDARY_CHROMA_SCALE = 0.9;
/** 第二色族至少占这么多权重才算数，否则只是零星的杂色点 */
const SECONDARY_MIN_SHARE = 0.12;
/** 取色结果缓存上限：长会话换很多封面也不至于一直涨 */
const CACHE_LIMIT = 64;

/** RGB(0~255) → HSL（h 0~360，s/l 0~1） */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return [h, s, l];
}

/** HSL（h 0~360）→ RGB(0~255)，色相超出范围自动绕回 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hue);
  const [r1, g1, b1] =
    seg === 0
      ? [c, x, 0]
      : seg === 1
        ? [x, c, 0]
        : seg === 2
          ? [0, c, x]
          : seg === 3
            ? [0, x, c]
            : seg === 4
              ? [x, 0, c]
              : [c, 0, x];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/** 分量取整 + 夹到 0~255：色族平均出来的是浮点数，不取整会拼出坏 hex（`80.8` 这种） */
export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** 两个色相的夹角（0~180） */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * 从 RGBA 像素里取两个色源。
 *
 * 算法（简单到能解释）：按色相分 12 桶，每像素按「饱和度 × 中间调偏好」投票，
 * 得票最高的一族当主色；第二色源优先取**异族**里得票最高的（且占比 ≥ 12%），
 * 没有异族就取主色**同色相**的浅一档（**不旋转色相**——实测 +45° 在暖色封面上会转出
 * 橄榄绿这种脏色：肤色棕 #c8aba2 一转就成了 #c8c8a2，页脚那束环境光直接发浑）。
 *
 * 拿不到可用颜色时返回 `null`（纯灰阶 / 全透明 / 数据非法），**不拿灰去凑一个色**——
 * 灰的色相是 0，CSS 那边会把彩度补齐，于是得到莫名其妙的红主题。
 */
export function extractCoverColors(data: Uint8ClampedArray): CoverColors | null {
  if (!data || data.length < 4 || data.length % 4 !== 0) return null;

  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));

  for (let i = 0; i < data.length; i += 4) {
    // PNG 封面的透明边、半透明水印不参与
    if (data[i + 3] < 125) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue;
    // 越饱和越算数；亮度越偏（近黑/近白）越降权——中间调才是封面真正的主色
    const weight = s * Math.max(0.15, 1 - Math.abs(l - 0.5) * 1.2);
    const bucket = buckets[Math.min(HUE_BUCKETS - 1, Math.floor(h / HUE_PER_BUCKET))];
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
  }

  const total = buckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  if (total <= 0) return null;

  const ranked = buckets
    .map((bucket, index) => ({ ...bucket, index }))
    .filter((bucket) => bucket.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const top = ranked[0];

  const primaryRgb: [number, number, number] = [
    top.r / top.weight,
    top.g / top.weight,
    top.b / top.weight,
  ];
  const [ph, ps, pl] = rgbToHsl(...primaryRgb);

  const second = ranked.find(
    (bucket) =>
      bucket.index !== top.index &&
      hueGap(bucket.index * HUE_PER_BUCKET + HUE_PER_BUCKET / 2, ph) >= FAMILY_HUE_GAP &&
      bucket.weight >= total * SECONDARY_MIN_SHARE,
  );
  const secondaryRgb: [number, number, number] = second
    ? [second.r / second.weight, second.g / second.weight, second.b / second.weight]
    : hslToRgb(ph, ps * SECONDARY_CHROMA_SCALE, Math.min(0.92, pl + SECONDARY_LIGHTNESS_STEP));

  return {
    primary: toHex(primaryRgb[0], primaryRgb[1], primaryRgb[2]),
    secondary: toHex(secondaryRgb[0], secondaryRgb[1], secondaryRgb[2]),
  };
}

/** 跨域封面会污染 canvas（`getImageData` 抛 SecurityError）时才需要 CORS 请求头；同源/blob 不必 */
function needsCors(url: string): boolean {
  if (typeof location === "undefined") return false;
  try {
    const origin = new URL(url, location.href).origin;
    return origin !== "" && origin !== "null" && origin !== location.origin;
  } catch {
    return false;
  }
}

/** 把封面画小之后取像素（这一步必须走 DOM，逻辑都在 `extractCoverColors` 里） */
export async function loadCoverColors(url: string): Promise<CoverColors | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;

  const img = new Image();
  if (needsCors(url)) img.crossOrigin = "anonymous";
  img.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("cover load failed"));
  });
  img.src = url;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

  try {
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return extractCoverColors(data);
  } catch {
    // 读不到就保持默认配色：诚实降级，不猜（v4.49 同款原则）
    return null;
  }
}

const cache = new Map<string, CoverColors | null>();
/** 竞态守卫：切歌很快时，慢的那次取色不许覆盖新歌的颜色 */
let requestSeq = 0;

/** 把两个原始色源写到目标元素（默认 `<html>`）；没有颜色就撤掉变量，回到默认配色 */
function writeColors(target: HTMLElement | null, colors: CoverColors | null): void {
  if (!target) return;
  if (!colors) {
    target.style.removeProperty("--cover-src");
    target.style.removeProperty("--cover-src-2");
    return;
  }
  target.style.setProperty("--cover-src", colors.primary);
  target.style.setProperty("--cover-src-2", colors.secondary);
}

/**
 * 按封面地址更新页面配色源（切歌时调用）。
 * `url` 为空（曲目没封面）会撤掉变量 → 回到 CSS 里的默认配色。
 */
export async function applyCoverColors(
  url: string | null,
  target: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): Promise<void> {
  const seq = ++requestSeq;
  if (!url) {
    writeColors(target, null);
    return;
  }

  let colors = cache.get(url);
  if (colors === undefined) {
    colors = await loadCoverColors(url).catch(() => null);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(url, colors);
  }

  if (seq !== requestSeq) return;
  writeColors(target, colors);
}
