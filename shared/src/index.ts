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
}

/** 歌单内的一条曲目引用（跨来源） */
export interface PlaylistItem {
  source: TrackSource;
  /** source = server 时为 Song.id；online 为 "provider:id"；local 仅记文件名 */
  refId?: string;
  title: string;
  artist: string;
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
export const AUDIO_EXTENSIONS = [
  "mp3",
  "flac",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "opus",
] as const;

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

/** 角色是否满足所需访问级别（AC-03：不足 403 的依据） */
export function hasAccess(role: Role, required: AccessLevel): boolean {
  if (required === "admin") return role === "admin";
  return role === "visitor" || role === "admin";
}
