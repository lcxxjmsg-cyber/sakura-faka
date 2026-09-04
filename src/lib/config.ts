import { sha256 } from '@noble/hashes/sha2.js';
import type { StoreEnv } from '@/types';
import { bytesToHex } from '@/lib/tron';

// ============================================================
// 后台可编辑配置：存到 D1 settings 表，读取时数据库优先、环境变量兜底。
// 让"站点名/邮件/登录密码"都能在后台直接改，无需命令行。
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

// 读 DB 配置；为空时回退到环境变量
export async function configOr(env: StoreEnv, key: string, envValue: string | undefined, dflt: string): Promise<string> {
  const v = await getConfig(env, key, '');
  return v || envValue || dflt;
}

// ===== 密码哈希 (salt + sha256) =====
function randHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

export function hashPassword(password: string, salt: string): string {
  const hash = sha256(new TextEncoder().encode(`${salt}::${password}`));
  return `${salt}:${bytesToHex(hash)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2 || !parts[0]) return false;
  const [salt, hash] = parts;
  return hashPassword(password, salt) === `${salt}:${hash}`;
}

// 读取管理员密码的校验方式：优先 DB 哈希；若无则回退环境变量明文（初始密码）
export async function getAdminPasswordVerifier(env: StoreEnv): Promise<{ stored?: string; envPlain?: string }> {
  const stored = await getConfig(env, 'admin_password_hash', '');
  if (stored) return { stored };
  return { envPlain: env.ADMIN_PASSWORD };
}

// 校验某密码是否为当前管理员密码（DB 哈希 或 env 明文）
export async function checkAdminPassword(env: StoreEnv, password: string): Promise<boolean> {
  const { stored, envPlain } = await getAdminPasswordVerifier(env);
  if (stored) return verifyPassword(password, stored);
  return password === envPlain;
}

// 修改管理员密码（存哈希）
export async function updateAdminPassword(env: StoreEnv, newPassword: string): Promise<void> {
  const salt = randHex(16);
  await setConfig(env, 'admin_password_hash', hashPassword(newPassword, salt));
}

export async function hasAdminPasswordSet(env: StoreEnv): Promise<boolean> {
  return !!(await getConfig(env, 'admin_password_hash', ''));
}
