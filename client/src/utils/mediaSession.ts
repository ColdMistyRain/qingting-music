/**
 * Media Session（RT-04）：锁屏 / 通知栏 / 耳机按键要拿到什么。
 *
 * 这里分两层，为的是**可测**：`buildXxx` 是纯函数（决定“写什么值”），
 * 下面的 applyXxx / attachActions 才是浏览器调用（navigator.mediaSession）。
 * Vitest 跑在 node 环境，没有 mediaSession / MediaMetadata，所以纯逻辑必须能单独跑，
 * 浏览器那一层必须能在缺接口时整体跳过（不是靠 try/catch 兜，而是先探测）。
 */

/** 元数据用到的字段子集（不全量依赖 Track，字段改名时这里只影响一处） */
export interface MediaTrackInfo {
  title: string;
  artist?: string;
  album?: string;
  cover?: string;
}

export interface MediaArtwork {
  src: string;
  sizes?: string;
}

export interface MediaMetadataInit {
  title: string;
  artist?: string;
  album?: string;
  artwork?: MediaArtwork[];
}

export interface MediaPositionState {
  duration: number;
  position: number;
  playbackRate: number;
}

/**
 * 曲目 → MediaMetadata 初始化参数；没有曲目返回 null（代表“不要写”）。
 * 空字段一律**省略**而不是给空串：锁屏会照实显示 title/artist 这一行，
 * 传空串会渲染出一条空行（“未知歌手”这种兜底文案由 Track 侧给全）。
 */
export function buildMetadata(track: MediaTrackInfo | null): MediaMetadataInit | null {
  if (!track) return null;
  const meta: MediaMetadataInit = { title: track.title };
  if (track.artist) meta.artist = track.artist;
  if (track.album) meta.album = track.album;
  // artwork 只在有封面时给：
  // · sizes 是“挑一张合适的”建议，不改变实际取到的图，给个常见值即可；
  // · type 不写 —— 封面是上传者给的原图（jpg / png / webp 都有可能），写死才是撒谎。
  if (track.cover) meta.artwork = [{ src: track.cover, sizes: "512x512" }];
  return meta;
}

/**
 * setPositionState 的参数；时长未知或位置非法时返回 null（不写）。
 *
 * ⚠️ 引擎对非法值**直接抛异常**（`position > duration`、NaN、`duration <= 0` 都算），
 * 而这条调用发生在 timeupdate（~4Hz）里，抛出来会一路冒到控制台。
 * 所以：非有限值直接放弃；越界的 position **夹取**而不是丢弃 ——
 * 夹取后锁屏进度仍然正确，丢弃只会让它停在旧值上。
 */
export function buildPositionState(duration: number, position: number): MediaPositionState | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(position)) return null;
  return {
    duration,
    position: Math.min(Math.max(position, 0), duration),
    // playbackRate 是必填成员（WebIDL 里是 required），缺它就抛；我们不支持变速，恒为 1
    playbackRate: 1,
  };
}

/** 系统媒体控制能派给我们的动作（RT-04 要求前四个；快退快进与 PL-08 的键盘同一诉求） */
export const MEDIA_ACTIONS = [
  "play",
  "pause",
  "nexttrack",
  "previoustrack",
  "seekbackward",
  "seekforward",
] as const;

export type MediaAction = (typeof MEDIA_ACTIONS)[number];

export interface MediaActionHandlers {
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seekBy(seconds: number): void;
}

/** 取 mediaSession，引擎没有（或 node 环境）时返回 null */
function mediaSession(): MediaSession | null {
  return typeof navigator !== "undefined" && "mediaSession" in navigator
    ? navigator.mediaSession
    : null;
}

/** 锁屏/通知栏的曲目信息（封面、歌名、歌手、专辑） */
export function applyMetadata(track: MediaTrackInfo | null): void {
  const session = mediaSession();
  const init = buildMetadata(track);
  if (!session || !init || typeof MediaMetadata === "undefined") return;
  session.metadata = new MediaMetadata(init);
}

/** 播放状态：锁屏按钮显示“播放”还是“暂停”跟着它走 */
export function applyPlaybackState(playing: boolean): void {
  const session = mediaSession();
  if (!session) return;
  // 只可能写 playing / paused（其它取值引擎会抛），所以不用 try
  session.playbackState = playing ? "playing" : "paused";
}

/** 播放进度：锁屏进度条。引擎在两次上报之间自己插值，所以 ~4Hz 的 timeupdate 足够 */
export function applyPosition(duration: number, position: number): void {
  const session = mediaSession();
  const state = buildPositionState(duration, position);
  if (!session || !state) return;
  try {
    session.setPositionState(state);
  } catch {
    // 极端情形（例如两次上报之间 duration 变了）引擎仍可能拒绝：
    // 锁屏进度掉的是一拍显示，不该让播放出错，所以吞掉。
  }
}

/**
 * 注册动作处理器，返回解绑函数。
 * 注意：一旦设了处理器，引擎就不再执行它自己的默认行为（例如 play 不会再自动播放），
 * 所以每个处理器都要真的把事做完（这里全部转给播放器 store 的同一套方法）。
 */
export function attachActions(handlers: MediaActionHandlers): () => void {
  const session = mediaSession();
  if (!session) return () => {};

  const map: Array<[MediaAction, () => void]> = [
    ["play", () => handlers.play()],
    ["pause", () => handlers.pause()],
    ["nexttrack", () => handlers.next()],
    ["previoustrack", () => handlers.prev()],
    ["seekbackward", () => handlers.seekBy(-5)],
    ["seekforward", () => handlers.seekBy(5)],
  ];

  for (const [action, fn] of map) {
    try {
      session.setActionHandler(action, fn);
    } catch {
      // 引擎不认识的动作（例如某些浏览器没有 seekforward）会抛，
      // 不该因为一个可选动作让整组注册失败。
    }
  }

  return () => {
    for (const [action] of map) {
      try {
        session.setActionHandler(action, null);
      } catch {
        /* 同上 */
      }
    }
  };
}
