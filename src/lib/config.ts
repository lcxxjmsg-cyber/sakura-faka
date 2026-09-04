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

// 首次部署的默认初始密码；登录后可在「系统设置」修改，改后立即失效（存哈希）。
// 优先级：数据库密码 > 环境变量 ADMIN_PASSWORD > 本默认值。
export const DEFAULT_ADMIN_PASSWORD = 'faka8888';

// 读取管理员密码的校验方式：优先 DB 哈希；若无则回退环境变量明文；再回退内置默认密码
export async function getAdminPasswordVerifier(env: StoreEnv): Promise<{ stored?: string; envPlain?: string }> {
  const stored = await getConfig(env, 'admin_password_hash', '');
  if (stored) return { stored };
  return { envPlain: env.ADMIN_PASSWORD };
}

// 校验某密码是否为当前管理员密码（DB 哈希 或 env 明文 或 内置默认）
export async function checkAdminPassword(env: StoreEnv, password: string): Promise<boolean> {
  const { stored, envPlain } = await getAdminPasswordVerifier(env);
  if (stored) return verifyPassword(password, stored);
  if (envPlain) return password === envPlain;
  return password === DEFAULT_ADMIN_PASSWORD;
}

// 是否仍在使用内置默认密码（用于前端强制修改提示）
export async function usingDefaultPassword(env: StoreEnv): Promise<boolean> {
  if (await hasAdminPasswordSet(env)) return false;
  return !env.ADMIN_PASSWORD;
}

// 修改管理员密码（存哈希）
export async function updateAdminPassword(env: StoreEnv, newPassword: string): Promise<void> {
  const salt = randHex(16);
  await setConfig(env, 'admin_password_hash', hashPassword(newPassword, salt));
}

export async function hasAdminPasswordSet(env: StoreEnv): Promise<boolean> {
  return !!(await getConfig(env, 'admin_password_hash', ''));
}
