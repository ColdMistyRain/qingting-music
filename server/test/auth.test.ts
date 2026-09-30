import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTH_SECRET_FILE,
  loadOrCreateSecret,
  matchPassword,
  resolveRole,
  signToken,
  verifyToken,
} from "../src/services/auth.js";

const SECRET = "unit-test-secret";
const HOUR = 60 * 60 * 1000;

describe("matchPassword", () => {
  const candidates = [
    { role: "visitor" as const, password: "guest-pass" },
    { role: "admin" as const, password: "root-pass" },
  ];

  it("命中访客密码返回 visitor，命中管理员密码返回 admin（AC-02）", () => {
    expect(matchPassword("guest-pass", candidates)).toBe("visitor");
    expect(matchPassword("root-pass", candidates)).toBe("admin");
  });

  it("不匹配与空密码返回 null", () => {
    expect(matchPassword("wrong", candidates)).toBeNull();
    expect(matchPassword("", candidates)).toBeNull();
  });

  it("门禁未配置时无候选，任何输入都不得放行", () => {
    expect(matchPassword("anything", [])).toBeNull();
  });
});

describe("signToken / verifyToken", () => {
  it("签发的凭证可验签回原角色", () => {
    const token = signToken("admin", SECRET);
    expect(verifyToken(token, SECRET, HOUR)).toBe("admin");
  });

  it("被篡改的角色或签名一律无效", () => {
    const token = signToken("visitor", SECRET);
    const [issuedAt, , signature] = token.split(".");
    expect(verifyToken(`${issuedAt}.admin.${signature}`, SECRET, HOUR)).toBeNull();
    expect(verifyToken(`${issuedAt}.visitor.deadbeef`, SECRET, HOUR)).toBeNull();
  });

  it("换密钥后旧凭证失效", () => {
    expect(verifyToken(signToken("admin", SECRET), "other-secret", HOUR)).toBeNull();
  });

  it("超出有效期或格式非法时无效", () => {
    const old = signToken("admin", SECRET, Date.now() - 2 * HOUR);
    expect(verifyToken(old, SECRET, HOUR)).toBeNull();
    expect(verifyToken("garbage", SECRET, HOUR)).toBeNull();
    expect(verifyToken(undefined, SECRET, HOUR)).toBeNull();
    expect(verifyToken("", SECRET, HOUR)).toBeNull();
  });

  it("密钥为空时不放行任何凭证", () => {
    expect(verifyToken(signToken("admin", SECRET), "", HOUR)).toBeNull();
  });
});

describe("resolveRole", () => {
  it("无 Cookie 或非法 Cookie 一律视为未登录", () => {
    expect(resolveRole(undefined, SECRET, HOUR)).toBe("anonymous");
    expect(resolveRole("bad-token", SECRET, HOUR)).toBe("anonymous");
  });

  it("合法 Cookie 解析出对应角色", () => {
    expect(resolveRole(signToken("visitor", SECRET), SECRET, HOUR)).toBe("visitor");
  });
});

describe("loadOrCreateSecret", () => {
  it("首次生成并落盘，再次读取得到同一密钥（重启后会话不失效）", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qt-secret-"));
    const first = loadOrCreateSecret(dir);
    expect(first).toHaveLength(64);
    expect(readFileSync(path.join(dir, AUTH_SECRET_FILE), "utf8").trim()).toBe(first);
    expect(loadOrCreateSecret(dir)).toBe(first);
  });

  it("密钥文件为空时重新生成，避免签发空密钥凭证", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qt-secret-"));
    writeFileSync(path.join(dir, AUTH_SECRET_FILE), "   \n");
    expect(loadOrCreateSecret(dir)).toHaveLength(64);
  });
});
