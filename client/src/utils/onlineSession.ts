import type { OnlineProfile } from "@qingting/shared";

/**
 * 音源账号会话的**浏览器端**存储（ON-10 / v6.31，需求方定）。
 *
 * 会话（音源 Cookie + 账号资料）存在**各浏览器自己的 localStorage** ——
 * 普通网站的形态：换浏览器要重新扫码，两个人各自扫码互不串号（服务端单槽会互相覆盖）。
 * 服务端不落盘任何会话副本；每次在线请求把它经 `X-Online-Auth` 头带给自家后端，
 * 后端转交给音源。撤销 = 页面上退出登录，或清浏览器数据，或网易云设备管理里踢掉。
 *
 * 除 localStorage 的读写守卫外全是纯逻辑，便于单测（node 环境没有 localStorage）。
 */

/** localStorage 键：按音源分槽（将来 QQ/酷狗各自一份） */
function storageKey(provider: string): string {
  return `qt-online-session:${provider}`;
}

export interface OnlineSession {
  provider: string;
  /** 音源登录 Cookie（原样来自音源登录应答的 Set-Cookie 数组） */
  cookie: string[];
  profile: OnlineProfile | null;
  /** 最近一次登录时间（展示用） */
  loggedInAt: string | null;
}

function isProfile(value: unknown): value is OnlineProfile {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.userId === "string" && typeof raw.nickname === "string";
}

/** profile 从存储里读回来时补齐 vip（旧格式没有这个字段） */
function normalizeProfile(raw: OnlineProfile): OnlineProfile {
  return { ...raw, vip: raw.vip === true };
}

function parse(raw: string | null, provider: string): OnlineSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const candidate = data as Partial<OnlineSession>;
  if (candidate.provider !== provider) return null;
  if (!Array.isArray(candidate.cookie)) return null;
  const cookie = candidate.cookie.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  if (cookie.length === 0) return null;
  return {
    provider,
    cookie,
    profile: isProfile(candidate.profile) ? normalizeProfile(candidate.profile) : null,
    loggedInAt: typeof candidate.loggedInAt === "string" ? candidate.loggedInAt : null,
  };
}

/** 读某个音源的会话；没有 / 形状不对 / 不是这个音源的，都返回 null */
export function readOnlineSession(provider: string): OnlineSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return parse(localStorage.getItem(storageKey(provider)), provider);
  } catch {
    // 隐私模式 / 配额异常：当没有登录
    return null;
  }
}

/** 写入（覆盖同音源的旧会话） */
export function writeOnlineSession(session: OnlineSession): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(session.provider), JSON.stringify(session));
  } catch {
    // 存不上（隐私模式）就不存：这次会话只在内存里，刷新后需重新扫码
  }
}

/** 清掉某个音源的会话（退出登录） */
export function clearOnlineSession(provider: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storageKey(provider));
  } catch {
    // 清不掉就算了：下次读到坏数据会被 parse 拒掉
  }
}

/** Cookie 数组 → 请求头的值（后端按分号拆回去） */
export function sessionHeaderValue(session: OnlineSession | null): string {
  return session ? session.cookie.join("; ") : "";
}
