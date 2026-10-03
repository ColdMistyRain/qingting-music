import { beforeEach, describe, expect, it } from "vitest";
import type { OnlineProfile } from "@qingting/shared";
import {
  clearOnlineSession,
  readOnlineSession,
  sessionHeaderValue,
  writeOnlineSession,
  type OnlineSession,
} from "./onlineSession";

/** 会话存浏览器的 localStorage（v6.31）：node 环境给一个够用的内存版 */
const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  globalThis.localStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  } as Storage;
});

const PROFILE: OnlineProfile = { userId: "77", nickname: "夜行客", avatarUrl: null };

function session(overrides: Partial<OnlineSession> = {}): OnlineSession {
  return {
    provider: "netease",
    cookie: ["MUSIC_U=abc", "__csrf_token=x"],
    profile: PROFILE,
    loggedInAt: "2026-10-03T06:00:00.000Z",
    ...overrides,
  };
}

describe("readOnlineSession / writeOnlineSession", () => {
  it("写入后原样读回（provider、cookie、profile、时间）", () => {
    writeOnlineSession(session());
    expect(readOnlineSession("netease")).toEqual(session());
  });

  it("按音源分槽：读别的音源拿不到", () => {
    writeOnlineSession(session());
    expect(readOnlineSession("kugou")).toBeNull();
  });

  it("没写过 / JSON 坏了 / 缺字段，都返回 null", () => {
    expect(readOnlineSession("netease")).toBeNull();

    memory.set("qt-online-session:netease", "{{{ 不是 JSON");
    expect(readOnlineSession("netease")).toBeNull();

    memory.set("qt-online-session:netease", JSON.stringify({ provider: "netease", cookie: [] }));
    expect(readOnlineSession("netease")).toBeNull();

    memory.set(
      "qt-online-session:netease",
      JSON.stringify({ provider: "netease", cookie: ["", 42], profile: { userId: 1 } }),
    );
    expect(readOnlineSession("netease")).toBeNull();
  });

  it("profile 形状不对整体置空，但 cookie 有效仍返回（资料可后补）", () => {
    memory.set(
      "qt-online-session:netease",
      JSON.stringify({ provider: "netease", cookie: ["MUSIC_U=abc"], profile: { nickname: "缺 id" } }),
    );
    const read = readOnlineSession("netease");
    expect(read?.cookie).toEqual(["MUSIC_U=abc"]);
    expect(read?.profile).toBeNull();
  });

  it("clearOnlineSession 只清那个音源", () => {
    writeOnlineSession(session());
    clearOnlineSession("kugou");
    expect(readOnlineSession("netease")).not.toBeNull();
    clearOnlineSession("netease");
    expect(readOnlineSession("netease")).toBeNull();
  });
});

describe("sessionHeaderValue", () => {
  it("cookie 数组按分号连接成头的值；没有会话给空串", () => {
    expect(sessionHeaderValue(session())).toBe("MUSIC_U=abc; __csrf_token=x");
    expect(sessionHeaderValue(null)).toBe("");
  });
});
