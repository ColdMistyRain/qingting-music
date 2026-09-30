import path from "node:path";

/** 环境变量来源（process.env 或测试用的普通对象） */
export type EnvSource = Record<string, string | undefined>;

/** 登录限速参数（AC-06：15 分钟窗口内最多 10 次失败，暂不暴露为环境变量） */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES = 10;

const DEFAULT_PORT = 3000;
const DEFAULT_MAX_UPLOAD_SIZE = 300 * 1024 * 1024; // 300MB
const DEFAULT_AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 ** 2,
  gb: 1024 ** 3,
};

const TIME_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export interface AppConfig {
  port: number;
  dataDir: string;
  uploadDir: string;
  /** 单文件上传上限（字节） */
  maxUploadSize: number;
  /** 访客密码；未配置为 null（无访客档） */
  userPassword: string | null;
  /** 管理员密码；未配置为 null（无管理档） */
  adminPassword: string | null;
  /** Cookie 签名密钥；留空表示待启动时生成并持久化 */
  authSecret: string;
  /** 登录有效期（毫秒，AUTH_TTL） */
  authTtlMs: number;
  /** 门禁是否启用：两把密码都未配置时为 false（AC-05） */
  authEnabled: boolean;
  /** 网易云 API 服务地址；未配置为 null */
  neteaseApiBase: string | null;
  /** 在线音源功能开关（ON-04） */
  onlineEnabled: boolean;
}

/** 门禁组合形态（AC-05），用于启动日志与前端提示 */
export type AuthMode = "closed" | "admin-only" | "visitor-only" | "full";

/**
 * 解析 "300MB" / "1.5GB" / "1024" 形式的大小，非法或缺失时用兜底值。
 * 无单位按字节处理。
 */
export function parseSize(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const matched = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(input);
  if (!matched) return fallback;
  const value = Number(matched[1]);
  const unit = (matched[2] ?? "b").toLowerCase();
  const factor = SIZE_UNITS[unit];
  if (!Number.isFinite(value) || factor === undefined) return fallback;
  return Math.round(value * factor);
}

/** 解析 "30d" / "12h" / "60m" / "45s" 形式的时长，非法或缺失时用兜底值（毫秒）。无单位按毫秒处理。 */
export function parseTtl(input: string | undefined, fallbackMs: number): number {
  if (!input) return fallbackMs;
  const matched = /^\s*(\d+)\s*(ms|s|m|h|d)?\s*$/i.exec(input);
  if (!matched) return fallbackMs;
  const value = Number(matched[1]);
  const unit = (matched[2] ?? "ms").toLowerCase();
  const factor = TIME_UNITS[unit];
  if (!Number.isFinite(value) || factor === undefined) return fallbackMs;
  return value * factor;
}

/** 归一化字符串型环境变量：空白与纯空格视为未配置 */
function readString(input: string | undefined): string | null {
  const value = input?.trim();
  return value ? value : null;
}

/** 判定门禁组合形态（AC-05） */
export function describeAuthMode(
  userPassword: string | null,
  adminPassword: string | null,
): AuthMode {
  if (!userPassword && !adminPassword) return "closed";
  if (!userPassword) return "admin-only";
  if (!adminPassword) return "visitor-only";
  return "full";
}

/**
 * 由环境变量装配服务配置（PRD 5.5 全量清单）。
 * 全部变量可选：最小配置 = 一条启动命令即可运行（门禁关闭、无在线音源）。
 */
export function loadConfig(env: EnvSource): AppConfig {
  const userPassword = readString(env.USER_PASSWORD);
  const adminPassword = readString(env.ADMIN_PASSWORD);
  const neteaseApiBase = readString(env.NETEASE_API_BASE);
  const port = Number(readString(env.PORT) ?? DEFAULT_PORT);

  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    dataDir: path.resolve(readString(env.DATA_DIR) ?? "./data"),
    uploadDir: path.resolve(readString(env.UPLOAD_DIR) ?? "./uploads"),
    maxUploadSize: parseSize(env.MAX_UPLOAD_SIZE, DEFAULT_MAX_UPLOAD_SIZE),
    userPassword,
    adminPassword,
    authSecret: readString(env.AUTH_SECRET) ?? "",
    authTtlMs: parseTtl(env.AUTH_TTL, DEFAULT_AUTH_TTL_MS),
    authEnabled: describeAuthMode(userPassword, adminPassword) !== "closed",
    neteaseApiBase,
    onlineEnabled: neteaseApiBase !== null,
  };
}
