import { describe, expect, it } from "vitest";
import { describeAuthMode, loadConfig, parseSize, parseTtl } from "../src/config.js";

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

describe("parseSize", () => {
  it("解析带单位的常见写法", () => {
    expect(parseSize("300MB", 1)).toBe(300 * MB);
    expect(parseSize("1.5GB", 1)).toBe(Math.round(1.5 * 1024 * MB));
    expect(parseSize("512kb", 1)).toBe(512 * 1024);
  });

  it("无单位按字节处理", () => {
    expect(parseSize("1024", 1)).toBe(1024);
  });

  it("缺失或非法值回落到兜底值", () => {
    expect(parseSize(undefined, 42)).toBe(42);
    expect(parseSize("", 42)).toBe(42);
    expect(parseSize("abc", 42)).toBe(42);
    expect(parseSize("300 MB 额外文本", 42)).toBe(42);
  });
});

describe("parseTtl", () => {
  it("解析 d/h/m/s 单位", () => {
    expect(parseTtl("30d", 1)).toBe(30 * DAY);
    expect(parseTtl("12h", 1)).toBe(12 * 60 * 60 * 1000);
    expect(parseTtl("60m", 1)).toBe(60 * 60 * 1000);
  });

  it("无单位按毫秒处理，非法值回落", () => {
    expect(parseTtl("500", 1)).toBe(500);
    expect(parseTtl("下周", 7)).toBe(7);
  });
});

describe("describeAuthMode", () => {
  it("覆盖 AC-05 的四种组合", () => {
    expect(describeAuthMode(null, null)).toBe("closed");
    expect(describeAuthMode(null, "admin")).toBe("admin-only");
    expect(describeAuthMode("user", null)).toBe("visitor-only");
    expect(describeAuthMode("user", "admin")).toBe("full");
  });
});

describe("loadConfig", () => {
  it("空环境下给出可运行的最小配置（门禁关闭、无在线音源）", () => {
    const config = loadConfig({});
    expect(config.port).toBe(3000);
    expect(config.maxUploadSize).toBe(300 * MB);
    expect(config.authTtlMs).toBe(30 * DAY);
    expect(config.authEnabled).toBe(false);
    // v6.29：音源内嵌默认可用（NETEASE_API_BASE 只是"改走外接服务"的开关）
    expect(config.onlineEnabled).toBe(true);
    expect(config.neteaseApiBase).toBeNull();
    expect(config.userPassword).toBeNull();
    expect(config.adminPassword).toBeNull();
  });

  it("空白字符串视为未配置（避免 .env 里留空导致门禁被误开）", () => {
    const config = loadConfig({ USER_PASSWORD: "   ", NETEASE_API_BASE: "" });
    expect(config.authEnabled).toBe(false);
    // 空白外接地址视为未配置 → 仍走内嵌，在线功能照样可用
    expect(config.neteaseApiBase).toBeNull();
    expect(config.onlineEnabled).toBe(true);
  });

  it("配置密码后启用门禁，配置音源后开启在线功能", () => {
    const config = loadConfig({
      USER_PASSWORD: "guest",
      ADMIN_PASSWORD: "root",
      NETEASE_API_BASE: "http://localhost:4000",
      MAX_UPLOAD_SIZE: "50MB",
      PORT: "8080",
    });
    expect(config.authEnabled).toBe(true);
    expect(config.onlineEnabled).toBe(true);
    expect(config.maxUploadSize).toBe(50 * MB);
    expect(config.port).toBe(8080);
  });

  it("非法 PORT 回落到默认端口", () => {
    expect(loadConfig({ PORT: "70000" }).port).toBe(3000);
    expect(loadConfig({ PORT: "abc" }).port).toBe(3000);
  });
});
