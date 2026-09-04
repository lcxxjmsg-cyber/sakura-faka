import type { StoreEnv } from '@/types';
import { bytesToHex } from '@/lib/tron';
import { sha256 } from '@noble/hashes/sha2.js';
import { logger } from '@/lib/logger';

// ============================================================
// 后台可编辑配置：存到 D1 settings 表，读取时数据库优先、环境变量兜底。
// 密码采用 WebCrypto PBKDF2-SHA256(100k 迭代)，兼容旧 sha256 单次哈希。
// 安全策略：无任何凭据时 fail closed（绝不允许默认密码直接上线）。
// ============================================================

export async function getConfig(env: StoreEnv, key: string, dflt = ''): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first<{ value: string }>();
    return row ? String(row.value) : dflt;
  } catch {
    return dflt;
  }
}

export async function setConfig(env: StoreEnv, key: string, value: string): Promise<void> {
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, String(value)).run();
}

export async function configOr(env: StoreEnv, key: string, envValue: string | undefined, dflt: string): Promise<string> {
  const v = await getConfig(env, key, '');
  return v || envValue || dflt;
}

// ===== 密码：PBKDF2-SHA256 =====
const PBKDF2_ITER = 100_000;

function randHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return bytesToHex(a);
}

async function pbkdf2(pwd: string, salt: string, iterations: number): Promise<string> {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations, hash: 'SHA-256' }, km, 256);
  let s = '';
  for (const b of new Uint8Array(bits)) s += String.fromCharCode(b);
  return btoa(s);
}

function sha256Hex(pwd: string, salt: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`${salt}::${pwd}`)));
}

// 新格式：`p1:salt:base64key`
export async function hashPassword(password: string): Promise<string> {
  const salt = randHex(16);
  const key = await pbkdf2(password, salt, PBKDF2_ITER);
  return `p1:${salt}:${key}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored || '').split(':');
  if (parts.length === 3 && parts[0] === 'p1') {
    const [, salt, key] = parts;
    const computed = await pbkdf2(password, salt, PBKDF2_ITER);
    return computed === key;
  }
  // 兼容旧格式 `salt:sha256hex`（单次 SHA256）
  if (parts.length === 2) {
    const [salt, hash] = parts;
    return sha256Hex(password, salt) === hash;
  }
  return false;
}

export async function getAdminPasswordVerifier(env: StoreEnv): Promise<{ stored?: string; envPlain?: string }> {
  const stored = await getConfig(env, 'admin_password_hash', '');
  if (stored) return { stored };
  return { envPlain: env.ADMIN_PASSWORD };
}

// 校验当前密码：DB 哈希 或 自定义环境变量。**两种都没有则 fail closed（返回 false）**。
export async function checkAdminPassword(env: StoreEnv, password: string): Promise<boolean> {
  const { stored, envPlain } = await getAdminPasswordVerifier(env);
  if (stored) return verifyPassword(password, stored);
  if (envPlain) return password === envPlain;
  return false;
}

export async function updateAdminPassword(env: StoreEnv, newPassword: string): Promise<void> {
  const hashed = await hashPassword(newPassword);
  await setConfig(env, 'admin_password_hash', hashed);
  logger.info('admin password changed');
}

export async function hasAdminPasswordSet(env: StoreEnv): Promise<boolean> {
  return !!(await getConfig(env, 'admin_password_hash', ''));
}

// 是否完全没有可用登录凭据（fail-closed 状态）
export async function usingDefaultPassword(env: StoreEnv): Promise<boolean> {
  if (await hasAdminPasswordSet(env)) return false;
  return !env.ADMIN_PASSWORD;
}

// 自动归集是否开启
export async function isAutoSweepEnabled(env: StoreEnv): Promise<boolean> {
  const v = await configOr(env, 'auto_sweep_enabled', env.AUTO_SWEEP_ENABLED, 'false');
  return v === 'true';
}
