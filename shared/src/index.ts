/**
 * 轻听音乐 —— 前后端共享类型与纯函数
 *
 * 唯一事实来源：PRD 5.3 数据模型 / 5.6.1 命名与数据格式。
 * 约定：全链路 camelCase；时间用 ISO 8601（UTC）字符串；时长用秒（number）。
 */

/** 曲目来源：本地 Blob / 自建服务器 / 在线音源（PRD 3.1 统一曲目抽象） */
export type TrackSource = "local" | "server" | "online";

/** 访问角色三档（PRD 3.11）：未登录 / 访客 / 管理员 */
export type Role = "anonymous" | "visitor" | "admin";

/** 接口分级（PRD AC-03）：访客级 = visitor 及以上；管理级 = 必须 admin */
export type AccessLevel = "visitor" | "admin";

/** 播放器核心唯一处理的曲目抽象（PRD 5.3） */
export interface Track {
  id: string;
  source: TrackSource;
  /** local = Blob URL；server = /audio/xx；online = 第三方 URL */
  url: string;
  title: string;
  artist: string;
  album: string;
  cover: string | null;
  duration: number | null;
  /**
   * 歌词原文（LR-02 的第一优先级：音频内嵌）。
   * 本地曲目由客户端读标签时写入；云端曲目由客户端在开播时按需向
   * `GET /api/songs/:id/lyrics` 取回后回填（服务端只存一份原文，不做解析）。
   * 在线源与手动 .lrc 两条来源不经 Track（由 player store 的 lyricsText 承载）。
   */
  lyrics?: string | null;
  /** 服务端抽到内嵌歌词了吗（云端曲目才有；客户端据此决定要不要去拉） */
  hasLyrics?: boolean;
}

/** 服务端曲目记录（data/songs.json 的一条） */
export interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string | null;
  /** 上传时的原始文件名（仅用于展示与重复判定） */
  originalName: string;
  /** 落盘用的随机名，杜绝路径穿越 */
  storedName: string;
  size: number;
  uploadedAt: string;
  /** 服务端抽到内嵌歌词了吗（歌词正文在 `data/lyrics/<id>.lrc`，不进列表响应、按需取） */
  hasLyrics?: boolean;
}

/** 歌单内的一条曲目引用（跨来源，PS-02） */
export interface PlaylistItem {
  source: TrackSource;
  /**
   * 引用键（见铁律 4：在线曲目用 `provider:id`）：
   *   server → `Song.id`
   *   online → `provider:id`
   *   local  → 稳定键 `歌手|曲名`（本地曲目的 id 每次重新导入都会变，不能当引用；
   *            与歌词库 `lyricsLibrary` 同一口径）
   * 可选是因为早期只记文件名的数据也能读回来。
   */
  refId?: string;
  title: string;
  artist: string;
  /** 冗余存一份展示信息：原曲目从曲库删掉后，歌单里仍能显示它曾经是什么 */
  cover?: string | null;
  duration?: number | null;
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
  createdAt: string;
  updatedAt: string;
}

/** GET /api/playlists 的返回（PS-01）：侧栏与详情页一次拿全，量很小 */
export interface PlaylistListResult {
  playlists: Playlist[];
}

/** GET /api/songs 的返回（LB-04）：列表一次拿全，过滤/排序在客户端做（LB-07） */
export interface SongListResult {
  songs: Song[];
  /** 全部曲目占用空间（字节），概览统计用（LB-10 / AD-03） */
  totalSize: number;
}

/** 业务码：重复文件（同名 + 同大小），前端据此给“跳过 / 覆盖”分支（LB-02） */
export const SONG_DUPLICATE_CODE = 1001;

/** GET /api/auth/status 的返回（PRD 3.11 认证 API 草案） */
export interface AuthStatus {
  /** 门禁是否启用：两把密码都未配置时为 false（AC-05） */
  authEnabled: boolean;
  role: Role;
}

/** GET /api/config 的返回：前端功能开关 */
export interface AppConfig {
  /** 在线音源是否可用（未配置 NETEASE_API_BASE 时为 false，ON-04） */
  onlineEnabled: boolean;
  /** 单文件上传上限（字节，LB-02）：上传页据此提示；旧后端未返回时前端用兑底值 */
  maxUploadSize?: number;
}

/** 成功响应体（PRD 5.6.2） */
export interface ApiOk<T> {
  code: 0;
  data: T;
}

/** 失败响应体：HTTP 状态码承载语义，body 给人读信息 */
export interface ApiErr {
  code: number;
  message: string;
}

export type ApiResponse<T> = ApiOk<T> | ApiErr;

/** 未登录的角色常量，避免各处硬编码字符串 */
export const ANONYMOUS_ROLE: Role = "anonymous";

/** 上传白名单：音频扩展名（PRD LB-02 / LC-02） */
export const AUDIO_EXTENSIONS = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus"] as const;

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number];

/** 取小写扩展名（不含点）；无扩展名返回空串 */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/** 是否命中音频扩展名白名单 */
export function isAudioFileName(fileName: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(fileExtension(fileName));
}

/** 解析不出歌手时的占位（LB-03 / LC-03 共用同一套文案） */
export const UNKNOWN_ARTIST = "未知歌手";
/** 解析不出专辑时的占位 */
export const UNKNOWN_ALBUM = "未知专辑";

/** 曲序前缀："01. " / "1 - " / "03_" / "12)" */
const TRACK_NUMBER_PREFIX = /^\s*\d{1,3}\s*[-._)]\s*/;
/** 首选分隔符：空格包围的连字符（"周杰伦 - 晴天"） */
const SPACED_SEPARATOR = /\s+[-–—]\s+/;
/** 备选：最后一个连字符，覆盖 "BEYOND-海阔天空" 这类无空格命名 */
const ANY_DASH = /[-–—]/g;

/**
 * 文件名回退解析（LC-03 本地 / LB-03 服务端共用）：按 "歌手-歌名" 拆分；
 * 识别不出歌手时标题用整段文件名，歌手记为“未知歌手”。
 */
export function parseTrackFileName(fileName: string): { title: string; artist: string } {
  const extension = fileExtension(fileName);
  const withoutExtension = extension
    ? fileName.slice(0, fileName.length - extension.length - 1)
    : fileName;
  const cleaned = withoutExtension.replace(TRACK_NUMBER_PREFIX, "").trim();

  const spaced = SPACED_SEPARATOR.exec(cleaned);
  if (spaced) {
    const artist = cleaned.slice(0, spaced.index).trim();
    const title = cleaned.slice(spaced.index + spaced[0].length).trim();
    if (artist && title) return { title, artist };
  }

  return splitOnLastDash(cleaned) ?? { title: cleaned || fileName.trim(), artist: UNKNOWN_ARTIST };
}

/**
 * 按最后一个连字符拆分。
 * 两侧都要求 ≥ 2 个字符：既能拆 "Adele-Rolling in the Deep"，
 * 又不会把本身就是连字符的歌手名（"A-Lin"）拆成 A / Lin。
 */
function splitOnLastDash(text: string): { title: string; artist: string } | null {
  const matches = [...text.matchAll(ANY_DASH)];
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return null;

  const artist = text.slice(0, last.index).trim();
  const title = text.slice(last.index + 1).trim();
  if (artist.length < 2 || title.length < 2) return null;
  return { title, artist };
}

/** 角色是否满足所需访问级别（AC-03：不足 403 的依据） */
export function hasAccess(role: Role, required: AccessLevel): boolean {
  if (required === "admin") return role === "admin";
  return role === "visitor" || role === "admin";
}

/* ---------- 内嵌歌词（LR-02）：前后端共用一份归一化 ---------- */

/**
 * 从 music-metadata 的 `common.lyrics` 里挑出**第一段非空**歌词。
 *
 * 各容器给出来的形状不一样（同一个库、不同格式）：
 *   MP3/ID3  → `{ language, descriptor, text }`
 *   FLAC/Vorbis → `{ contentType, timeStampFormat, text }`
 *   偶尔也有旧版本直接给字符串数组
 * 所以这里只认 `text` 字段（或字符串元素），别的都忽略。客户端读本地文件、
 * 服务端读上传文件都用这一份，避免两边挑出不同的那一段。
 */
export function pickEmbeddedLyrics(lyrics: unknown): string | null {
  if (!Array.isArray(lyrics)) return null;
  for (const entry of lyrics) {
    const text =
      typeof entry === "string"
        ? entry
        : entry &&
            typeof entry === "object" &&
            typeof (entry as { text?: unknown }).text === "string"
          ? (entry as { text: string }).text
          : "";
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/* ---------- 歌单（PS-01~04）：纯函数，前后端共用 ---------- */

/** 歌单名长度上限 */
export const PLAYLIST_NAME_MAX_LENGTH = 40;
/** 歌单名校验：去首尾空白后不能为空、不能超长（无名或长到看不清的歌单在侧栏上没法认） */
export function validatePlaylistName(
  raw: unknown,
): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof raw !== "string") return { ok: false, message: "歌单名不能为空" };
  const name = raw.trim();
  if (!name) return { ok: false, message: "歌单名不能为空" };
  if (name.length > PLAYLIST_NAME_MAX_LENGTH) {
    return { ok: false, message: `歌单名最多 ${PLAYLIST_NAME_MAX_LENGTH} 个字` };
  }
  return { ok: true, name };
}

/** 曲目引用的身份键：优先用 refId，没有就退到“来源 + 歌手|曲名”（本地曲目与旧数据走这条） */
export function playlistItemKey(item: PlaylistItem): string {
  return `${item.source}:${item.refId || `${item.artist}|${item.title}`}`;
}

/** 去重：同一首歌重复加进歌单只留一条（保留先加的那条，其余顺序不变） */
export function dedupePlaylistItems(items: readonly PlaylistItem[]): PlaylistItem[] {
  const seen = new Set<string>();
  const result: PlaylistItem[] = [];
  for (const item of items) {
    const key = playlistItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** 把播放器曲目转成歌单引用（PS-02：本地 / 云端 / 在线三种来源都支持） */
export function toPlaylistItem(track: Track): PlaylistItem {
  const item: PlaylistItem = {
    source: track.source,
    title: track.title,
    artist: track.artist,
    cover: track.cover,
    duration: track.duration,
  };
  // server → Song.id；online → `provider:id`（铁律 4 已经保证在线曲目的 id 就是这个形状）；
  // local 的 id 每次重新导入都会变，改用“歌手|曲名”稳定键
  item.refId = track.source === "local" ? `${track.artist}|${track.title}` : track.id;
  return item;
}
