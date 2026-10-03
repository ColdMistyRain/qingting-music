/**
 * 播放器纯逻辑（PRD 3.2 PL-02/05）。
 * 这些函数不碰 DOM 与 store，是"播放模式状态机 + 选取下一首"的唯一实现处，
 * 因此可以把四种模式的边界情况全部单测覆盖（PRD 11.2 要求）。
 */

/** 播放模式（PL-05：顺序 / 列表循环 / 单曲循环 / 随机） */
export type PlayMode = "seq" | "list" | "one" | "random";

/** 单按钮循环切换顺序：顺序 → 列表循环 → 单曲循环 → 随机 → 顺序 */
export const PLAY_MODE_ORDER: readonly PlayMode[] = ["seq", "list", "one", "random"];

export const PLAY_MODE_LABELS: Record<PlayMode, string> = {
  seq: "顺序播放",
  list: "列表循环",
  one: "单曲循环",
  random: "随机播放",
};

/** 切换到下一个播放模式（PL-05） */
export function nextMode(mode: PlayMode): PlayMode {
  const index = PLAY_MODE_ORDER.indexOf(mode);
  return PLAY_MODE_ORDER[(index + 1) % PLAY_MODE_ORDER.length] ?? "list";
}

/** 上一首规则（PL-02）：已播放超过阈值秒数 → 回到本曲开头，而不是切上一曲 */
export function shouldRestartTrack(currentTime: number, threshold = 3): boolean {
  return Number.isFinite(currentTime) && currentTime > threshold;
}

/**
 * 随机挑一个"非当前"的索引（PL-05 随机播放不重复当前曲）。
 * 队列只有一首时只能返回 0；random 注入以便单测固定结果。
 */
export function pickRandomIndex(
  count: number,
  exclude: number,
  random: () => number = Math.random,
): number {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  // 把 count-1 个候选（跳过当前曲）映射回真实索引
  const pick = Math.floor(random() * (count - 1));
  const safe = Math.min(Math.max(pick, 0), count - 2);
  return safe >= exclude ? safe + 1 : safe;
}

/**
 * 下一曲（PL-05）。返回 -1 表示“到此为止”（顺序播放到末尾停止）。
 *
 * ⚠️ **单曲循环下这里返回的就是本曲下标**（“下一首”不换歌，重播本曲只在自然播完时发生，
 * 见 store 的 `handleEnded`）—— 调用方若在“坏文件要不要跳”这类地方判“有没有下一首”，
 * 除了 `-1` 还要判**是否等于当前下标**，否则会原地无限重试（v6.26 实测踩到）。
 */
export function resolveNextIndex(
  count: number,
  index: number,
  mode: PlayMode,
  random: () => number = Math.random,
): number {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  if (mode === "one") return Math.min(index, count - 1);
  if (mode === "random") return pickRandomIndex(count, index, random);
  const next = index + 1;
  if (next < count) return next;
  return mode === "list" ? 0 : -1;
}

/** 上一曲（PL-02）：顺序播放停在第一首，列表循环与随机都在两端回绕 */
export function resolvePrevIndex(
  count: number,
  index: number,
  mode: PlayMode,
  random: () => number = Math.random,
): number {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  if (mode === "random") return pickRandomIndex(count, index, random);
  if (index === 0) return mode === "list" ? count - 1 : 0;
  return index - 1;
}
