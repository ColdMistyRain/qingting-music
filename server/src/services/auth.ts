import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ANONYMOUS_ROLE, type Role } from "@qingting/shared";

/** 登录凭证 Cookie 名（AC-08：载荷 = 签发时间戳 + 角色 + HMAC 签名） */
export const AUTH_COOKIE = "qt_auth";

/** 自动生成密钥的文件名（存于 DATA_DIR，重启后会话不失效） */
export const AUTH_SECRET_FILE = "auth-secret";

const KNOWN_ROLES: readonly Role[] = ["anonymous", "visitor", "admin"];

/** 允许的时钟偏差：签发自未来 1 分钟内的凭证仍视为有效 */
const CLOCK_SKEW_MS = 60 * 1000;

/** 定长摘要：既让 timingSafeEqual 恒可比较，也避免长度差异抛错 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** 待比对的一把密码 */
export interface PasswordCandidate {
  role: Role;
  password: string;
}

/**
 * 依次比对明文密码，命中即返回角色（AC-02）。
 * 遍历完整候选列表且不做提前返回，避免用耗时差异泄露命中的是哪一把密码。
 */
export function matchPassword(
  input: string,
  candidates: readonly PasswordCandidate[],
): Role | null {
  if (!input) return null;
  const inputDigest = digest(input);
  let matched: Role | null = null;
  for (const candidate of candidates) {
    if (timingSafeEqual(inputDigest, digest(candidate.password))) matched = candidate.role;
  }
  return matched;
}

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * 签发凭证：`签发时间戳.角色.HMAC`（无状态，不含任何用户信息）。
 * 载荷不存过期时间——有效期在验签时按当前配置判定，改 AUTH_TTL 即刻生效。
 */
export function signToken(role: Role, secret: string, now = Date.now()): string {
  const issuedAt = String(now);
  return `${issuedAt}.${role}.${sign(secret, `${issuedAt}.${role}`)}`;
}

/** 验签：签名不符、格式非法、角色未知、超出有效期均返回 null */
export function verifyToken(
  token: string | undefined,
  secret: string,
  ttlMs: number,
  now = Date.now(),
): Role | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [issuedAtRaw, roleRaw, signature] = parts;
  if (!issuedAtRaw || !roleRaw || !signature) return null;
  if (!KNOWN_ROLES.includes(roleRaw as Role)) return null;

  const expected = sign(secret, `${issuedAtRaw}.${roleRaw}`);
  if (!timingSafeEqual(digest(signature), digest(expected))) return null;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return null;
  if (issuedAt > now + CLOCK_SKEW_MS) return null;
  if (now - issuedAt > ttlMs) return null;

  return roleRaw as Role;
}

/** 由 Cookie 原文解析角色：缺失或非法一律视为未登录 */
export function resolveRole(
  rawCookie: string | undefined,
  secret: string,
  ttlMs: number,
  now = Date.now(),
): Role {
  return verifyToken(rawCookie, secret, ttlMs, now) ?? ANONYMOUS_ROLE;
}

/** 读取持久化密钥；不存在则生成随机密钥并写入 DATA_DIR（0600 权限） */
export function loadOrCreateSecret(dataDir: string): string {
  const file = path.join(dataDir, AUTH_SECRET_FILE);
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const secret = randomBytes(32).toString("hex");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}
