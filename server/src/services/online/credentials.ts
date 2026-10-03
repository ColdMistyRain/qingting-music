import type { OnlineProfile } from "@qingting/shared";
import { createJsonStore } from "../jsonStore.js";

/**
 * 音源账号会话的落盘（ON-10，v6.30）：`data/online-auth.json`。
 *
 * **这是"整个 server 共享一份音源账号"**：私有部署里登录一次，家里所有人都能听
 * 这个账号能听的歌（含 VIP 曲目的直链）。会话是音源的登录 Cookie，
 * 存在部署者自己的服务器上、不离开这台机器。
 *
 * 写入走 jsonStore（原子写 + 串行队列）；文件里只存 cookie 数组与展示用的 profile，
 * 不存密码 —— 扫码登录本来也不经过密码。
 */

export interface ProviderCredentials {
  /** 音源登录 Cookie（`k=v` 字符串数组，原样来自音源登录应答） */
  cookie: string[];
  profile: OnlineProfile | null;
  /** 最近一次登录时间（展示用） */
  loggedInAt: string | null;
}

export interface OnlineAuthData {
  providers: Record<string, ProviderCredentials | undefined>;
}

const EMPTY_CREDENTIALS: ProviderCredentials = {
  cookie: [],
  profile: null,
  loggedInAt: null,
};

/** 解析时逐字段清洗：文件被手改过也不至于把脏数据带给上游 */
function parseCredentials(value: unknown): ProviderCredentials {
  if (!value || typeof value !== "object") return { ...EMPTY_CREDENTIALS };
  const raw = value as Record<string, unknown>;
  const cookie = Array.isArray(raw.cookie)
    ? raw.cookie.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  const profileRaw = raw.profile as Record<string, unknown> | null | undefined;
  const profile =
    profileRaw && typeof profileRaw.userId === "string" && typeof profileRaw.nickname === "string"
      ? {
          userId: profileRaw.userId,
          nickname: profileRaw.nickname,
          avatarUrl: typeof profileRaw.avatarUrl === "string" ? profileRaw.avatarUrl : null,
        }
      : null;
  return {
    cookie,
    profile,
    loggedInAt: typeof raw.loggedInAt === "string" ? raw.loggedInAt : null,
  };
}

const store = createJsonStore<OnlineAuthData>({
  fileName: "online-auth.json",
  fallback: () => ({ providers: {} }),
  parse: (value) => {
    if (!value || typeof value !== "object") throw new Error("online-auth.json 形状不对");
    const raw = value as { providers?: unknown };
    const providers: OnlineAuthData["providers"] = {};
    if (raw.providers && typeof raw.providers === "object") {
      for (const [id, credentials] of Object.entries(raw.providers as Record<string, unknown>)) {
        providers[id] = parseCredentials(credentials);
      }
    }
    return { providers };
  },
});

export function loadProviderCredentials(
  dataDir: string,
  provider: string,
): Promise<ProviderCredentials> {
  return store.load(dataDir).then((data) => data.providers[provider] ?? { ...EMPTY_CREDENTIALS });
}

export function saveProviderLogin(
  dataDir: string,
  provider: string,
  credentials: { cookie: string[]; profile: OnlineProfile | null },
): Promise<void> {
  return store
    .update(dataDir, (current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider]: {
          cookie: credentials.cookie,
          profile: credentials.profile,
          loggedInAt: new Date().toISOString(),
        },
      },
    }))
    .then(() => undefined);
}

export function clearProviderLogin(dataDir: string, provider: string): Promise<void> {
  return store
    .update(dataDir, (current) => {
      if (!(provider in current.providers)) return current;
      const next = { ...current.providers };
      delete next[provider];
      return { ...current, providers: next };
    })
    .then(() => undefined);
}
