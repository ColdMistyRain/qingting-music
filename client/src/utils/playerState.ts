/**
 * 播放状态的存盘与读盘（PL-07：刷新后恢复上次的曲目与进度）。
 *
 * 单独一个模块的理由：这里有两件**必须被单测覆盖**的判断——
 * ① 哪些曲目刷新后真的还能续上；② 存档损坏 / 旧版本 / 被手改时怎么退。
 * 两者都是纯数据变换，不碰 store 与 DOM（PRD 11.2）。
 */
import type { Track } from "@qingting/shared";
import { PLAY_MODE_LABELS, type PlayMode } from "./player";

/** 存盘时要提供的字段：`droppedLocalTracks` 是**算出来的**，不由调用方填 */
export type SnapshotInput = Omit<PlayerSnapshot, "droppedLocalTracks">;

/** 存档上限：队列再长也不至于把 localStorage 塞爆（一首曲目约 1~3KB） */
export const MAX_PERSISTED_TRACKS = 300;

export interface PlayerSnapshot {
  mode: PlayMode;
  volume: number;
  muted: boolean;
  /** 只含**可恢复**的曲目（见 `isResumableUrl`） */
  queue: Track[];
  currentIndex: number;
  /** 当前曲目的播放位置（秒） */
  seconds: number;
  /**
   * 存盘时被丢掉的**本地曲目数**（Blob 地址刷新后失效）。
   * 存这个数是为了刷新后能告诉用户“有几首本地曲目没恢复成”，
   * 而不是默默少几行（试过在恢复时事后统计：存盘时就已经滤掉了，算不出来）。
   */
  droppedLocalTracks: number;
}

/**
 * 这个地址刷新后还活着吗。
 *
 * 本地文件走 Blob URL，页面一刷新就失效（浏览器不给持久文件句柄），
 * 存下来只会得到一排点了没反应的死行——所以只存非 `blob:` 的地址。
 * 云端曲目是服务器路径，刷新后照样能放。
 */
export function isResumableUrl(url: string): boolean {
  return typeof url === "string" && url.length > 0 && !url.startsWith("blob:");
}

/**
 * 这首曲目刷新后续得上吗（存档的准入判断）。
 *
 * **在线曲目是特例**：它的 id 是 `provider:id` 稳定键，随时能重新解析直链 ——
 * 所以就算 `url` 是空串（在线曲目本来就不存直链，见 `utils/onlineTracks`）也放行；
 * 本地/云端仍看地址本身。
 */
function isPersistableTrack(track: Track): boolean {
  if (track.source === "online") return true;
  return isResumableUrl(track.url);
}

/**
 * 存档里的在线曲目一律不携带直链（音源给的是会过期的签名地址，存下来就是死链）：
 * 置空，恢复后第一次按播放时由 store 现解析（ON-03）。
 */
function stripOnlineUrl(track: Track): Track {
  return track.source === "online" && track.url ? { ...track, url: "" } : track;
}

function isTrackLike(value: unknown): value is Track {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<Track>;
  return (
    typeof track.id === "string" && typeof track.url === "string" && typeof track.title === "string"
  );
}

function isPlayMode(value: unknown): value is PlayMode {
  return typeof value === "string" && value in PLAY_MODE_LABELS;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** 进度只能是 `0 ~ 时长`；时长还没解析出来时只保证非负 */
function clampSeconds(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return duration > 0 ? Math.min(seconds, duration) : seconds;
}

/**
 * 存盘前整理：丢掉不可恢复的曲目、把 `currentIndex` 重新对到**同一个曲目**、夹取进度。
 * 当前曲目自己也要可恢复，否则"续上进度"无从谈起（此时退到"没有当前曲目"）。
 */
export function sanitizeSnapshot(input: SnapshotInput): PlayerSnapshot {
  const currentId = input.queue[input.currentIndex]?.id ?? null;
  const valid = input.queue.filter(isTrackLike);
  const queue = valid
    .filter(isPersistableTrack)
    .map(stripOnlineUrl)
    .slice(0, MAX_PERSISTED_TRACKS);
  const index = currentId === null ? -1 : queue.findIndex((track) => track.id === currentId);
  const seconds = index < 0 ? 0 : clampSeconds(input.seconds, queue[index].duration ?? 0);

  return {
    mode: isPlayMode(input.mode) ? input.mode : "list",
    volume: clamp01(input.volume),
    muted: Boolean(input.muted),
    queue,
    currentIndex: index,
    seconds,
    droppedLocalTracks: valid.filter((track) => !isPersistableTrack(track)).length,
  };
}

/**
 * 读盘：容错解析——缺失字段用默认值、类型不对就忽略、JSON 坏了返回 `null`。
 * 返回 `null` 的语义是"没有可用的存档"，调用方保持自己的默认状态。
 */
export function parseSnapshot(raw: string | null): PlayerSnapshot | null {
  if (!raw) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;

  const stored = data as Partial<PlayerSnapshot>;
  // 不在这里过滤：`currentIndex` 是相对**原数组**的位置，先过滤会让它指到别的曲目上
  // （实测：队列 [缺字段, null, 缺 url, 好曲目] + currentIndex 3 → 过滤后索引越界，当前曲目丢了）
  const queue = Array.isArray(stored.queue) ? (stored.queue as Track[]) : [];

  const snapshot = sanitizeSnapshot({
    mode: isPlayMode(stored.mode) ? stored.mode : "list",
    volume: typeof stored.volume === "number" ? stored.volume : 1,
    muted: typeof stored.muted === "boolean" ? stored.muted : false,
    queue,
    currentIndex: typeof stored.currentIndex === "number" ? stored.currentIndex : -1,
    seconds: typeof stored.seconds === "number" ? stored.seconds : 0,
  });

  // “有几首本地曲目没恢复成”取的是**存档里记下的数**，不让 sanitize 从队列重算——
  // 队列里那些本地曲目早就被丢掉了，重算永远是 0，提示就再也不会出现。
  return typeof stored.droppedLocalTracks === "number"
    ? { ...snapshot, droppedLocalTracks: Math.max(0, stored.droppedLocalTracks) }
    : snapshot;
}
