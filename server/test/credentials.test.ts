import { describe, expect, it } from "vitest";
import {
  clearProviderLogin,
  loadProviderCredentials,
  saveProviderLogin,
} from "../src/services/online/credentials.js";
import { tempDirs } from "./helpers.js";

/** 音源账号会话的落盘（ON-10）：data/online-auth.json，走 jsonStore 的原子写 */
describe("音源凭据存取（ON-10）", () => {
  it("保存后能原样读回（cookie 数组 + profile + 时间）", async () => {
    const { dataDir } = await tempDirs();
    await saveProviderLogin(dataDir, "netease", {
      cookie: ["MUSIC_U=abc", "__csrf_token=xyz"],
      profile: { userId: "123", nickname: "夜行客", avatarUrl: "https://p1.music.126.net/a.jpg" },
    });

    const credentials = await loadProviderCredentials(dataDir, "netease");
    expect(credentials.cookie).toEqual(["MUSIC_U=abc", "__csrf_token=xyz"]);
    expect(credentials.profile).toEqual({
      userId: "123",
      nickname: "夜行客",
      avatarUrl: "https://p1.music.126.net/a.jpg",
    });
    expect(credentials.loggedInAt).toBeTruthy();
  });

  it("没登录过的音源是空凭据；各音源互不影响", async () => {
    const { dataDir } = await tempDirs();
    await saveProviderLogin(dataDir, "netease", {
      cookie: ["MUSIC_U=abc"],
      profile: { userId: "1", nickname: "a", avatarUrl: null },
    });

    const fresh = await loadProviderCredentials(dataDir, "kugou");
    expect(fresh.cookie).toEqual([]);
    expect(fresh.profile).toBeNull();
    expect((await loadProviderCredentials(dataDir, "netease")).cookie).toEqual(["MUSIC_U=abc"]);
  });

  it("清除只删那一家；重复清除是幂等的", async () => {
    const { dataDir } = await tempDirs();
    await saveProviderLogin(dataDir, "netease", {
      cookie: ["MUSIC_U=abc"],
      profile: { userId: "1", nickname: "a", avatarUrl: null },
    });

    await clearProviderLogin(dataDir, "netease");
    expect((await loadProviderCredentials(dataDir, "netease")).cookie).toEqual([]);
    await clearProviderLogin(dataDir, "netease");
    expect((await loadProviderCredentials(dataDir, "netease")).cookie).toEqual([]);
  });

  it("文件被手改坏时逐字段清洗：cookie 只留字符串，profile 缺字段就整体置空", async () => {
    const { dataDir, writeFile } = await tempDirs();
    await writeFile(
      "online-auth.json",
      JSON.stringify({
        providers: {
          netease: {
            cookie: ["MUSIC_U=ok", 42, null, ""],
            profile: { userId: 99, nickname: "无昵称" },
            loggedInAt: "not-a-date-but-kept-as-string",
          },
        },
      }),
    );

    const credentials = await loadProviderCredentials(dataDir, "netease");
    expect(credentials.cookie).toEqual(["MUSIC_U=ok"]);
    expect(credentials.profile).toBeNull();
  });
});
