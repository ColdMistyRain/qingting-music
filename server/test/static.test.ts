import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hasStaticSite, staticCacheControl } from "../src/static.js";
import { tempDirs, testConfig } from "./helpers.js";

/** 造一个像 vite 构建产物那样的临时目录（含入口、哈希资源、SW 与图标） */
async function fakeDist(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "qingting-dist-"));
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(path.join(dir, "index.html"), "<html>APP-MARKER</html>", "utf8");
  await writeFile(path.join(dir, "assets", "index-abc12345.js"), "console.log(1)", "utf8");
  await writeFile(path.join(dir, "assets", "glow-nPTynAVM.png"), "png", "utf8");
  await writeFile(path.join(dir, "sw.js"), "// sw", "utf8");
  await writeFile(path.join(dir, "manifest.webmanifest"), "{}", "utf8");
  await writeFile(path.join(dir, "pwa-192.png"), "png", "utf8");
  return dir;
}

async function appWithStatic() {
  const dirs = await tempDirs();
  const dist = await fakeDist();
  return createApp(testConfig({ ...dirs, staticDir: dist }));
}

describe("前端静态托管（生产形态：一个域名同时服务前端与 /api）", () => {
  it("根路径与前端路由都给 index.html（刷新 /library 不会白屏）", async () => {
    const app = await appWithStatic();

    const root = await request(app).get("/");
    expect(root.status).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.text).toContain("APP-MARKER");

    const deep = await request(app).get("/playlist/abc");
    expect(deep.status).toBe(200);
    expect(deep.text).toContain("APP-MARKER");
  });

  it("目录不存在（开发期）：照旧只有接口，前端路由不兜底", async () => {
    const dirs = await tempDirs();
    const app = createApp(testConfig({ ...dirs, staticDir: path.join(dirs.dataDir, "nope") }));

    // 落回 Express 自己的 404（开发期前端在 5173，没人会拿 :3000 当前端用），
    // 要紧的是别拿一份 index.html 冒充页面
    const res = await request(app).get("/library");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("APP-MARKER");
  });

  it("接口、音频、封面不被 SPA 兜底成 HTML（与 SW 的 deny 名单同一份）", async () => {
    const app = await appWithStatic();

    const api = await request(app).get("/api/nope");
    expect(api.status).toBe(404);
    expect(api.headers["content-type"]).toContain("application/json");
    expect(api.text).not.toContain("APP-MARKER");

    const audio = await request(app).get("/audio/nope.mp3");
    expect(audio.status).toBe(404);
    expect(audio.text).not.toContain("APP-MARKER");

    const cover = await request(app).get("/covers/nope.jpg");
    expect(cover.status).toBe(404);
    expect(cover.text).not.toContain("APP-MARKER");
  });

  it("只有 GET/HEAD 兜底：POST 一个前端路由不会被当成页面", async () => {
    const app = await appWithStatic();

    const res = await request(app).post("/library");
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("APP-MARKER");
  });

  it("哈希产物长缓存，入口与 SW 不缓存（否则更新推不下去）", async () => {
    const app = await appWithStatic();

    const asset = await request(app).get("/assets/index-abc12345.js");
    expect(asset.status).toBe(200);
    expect(asset.headers["cache-control"]).toContain("immutable");

    for (const filePath of ["/index.html", "/sw.js", "/manifest.webmanifest", "/pwa-192.png"]) {
      const res = await request(app).get(filePath);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-cache");
    }
  });
});

describe("hasStaticSite（目录里到底有没有可托管的前端产物）", () => {
  it("没配目录 / 目录里没有 index.html 都算没有", async () => {
    expect(hasStaticSite(null)).toBe(false);
    expect(hasStaticSite(path.join(tmpdir(), "qingting-不存在的目录"))).toBe(false);

    const empty = await mkdtemp(path.join(tmpdir(), "qingting-empty-"));
    expect(hasStaticSite(empty)).toBe(false);
  });

  it("有 index.html 才算有（构建过一次就是这条路径）", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qingting-dist-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html>", "utf8");
    expect(hasStaticSite(dir)).toBe(true);
  });
});

describe("staticCacheControl（纯函数）", () => {
  it("assets 下的哈希文件给长缓存", () => {
    expect(staticCacheControl("/dist/assets/index-N7ZAQylm.js")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(staticCacheControl(path.join("dist", "assets", "glow-nPTynAVM.png"))).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("入口、SW、manifest、根目录下的图标都不缓存", () => {
    for (const file of [
      "index.html",
      "sw.js",
      "registerSW.js",
      "manifest.webmanifest",
      "pwa-512.png",
      "apple-touch-icon.png",
    ]) {
      expect(staticCacheControl(path.join("/dist", file))).toBe("no-cache");
    }
  });

  it("assets 里没带哈希的文件也不长缓存（宁可多问一次服务器）", () => {
    expect(staticCacheControl("/dist/assets/plain.js")).toBe("no-cache");
  });
});
