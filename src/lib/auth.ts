import type { StoreEnv } from '@/types';

// ============================================================
// 后台鉴权：KV 存储会话，附带元数据(created_at/last_seen/ip/ua)，
// 支持 logout / revoke current / revoke all / rotation。
// ============================================================

const SESSION_TTL = 60 * 60 * 24 * 7; // 7天
const SESSION_PREFIX = 'sess:';

export function makeSid(): string {
  return crypto.randomUUID();
}

// 创建会话（记录元数据）。rotation：每次登录都生成新 SID。
export async function setPasswordGrant(env: StoreEnv, sid: string, meta: { ip?: string; ua?: string } = {}): Promise<void> {
  const now = new Date().toISOString();
  await env.KV.put(SESSION_PREFIX + sid, JSON.stringify({
    uid: 'admin', created_at: now, last_seen: now, ip: meta.ip || '', ua: meta.ua || '',
  }), { expirationTtl: SESSION_TTL });
}

export async function checkSession(env: StoreEnv, sid: string): Promise<boolean> {
  if (!sid) return false;
  const v = await env.KV.get(SESSION_PREFIX + sid);
  if (!v) return false;
  try {
    const s = JSON.parse(v);
    if (!s.uid) return false;
    // 更新 last_seen（轻量）
    s.last_seen = new Date().toISOString();
    await env.KV.put(SESSION_PREFIX + sid, JSON.stringify(s), { expirationTtl: SESSION_TTL });
    return true;
  } catch {
    return false;
  }
}

export async function getSessionMeta(env: StoreEnv, sid: string): Promise<any | null> {
  const v = await env.KV.get(SESSION_PREFIX + sid);
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

export function getSessionId(headers: Headers): string {
  const cookie = headers.get('Cookie') || '';
  const m = cookie.match(/session=([^;]+)/);
  return m ? m[1] : '';
}

// logout / revoke current
export async function logout(env: StoreEnv, sid: string): Promise<void> {
  await env.KV.delete(SESSION_PREFIX + sid);
}

// revoke all：删除该账号所有会话
export async function revokeAll(env: StoreEnv): Promise<void> {
  const list = await env.KV.list({ prefix: SESSION_PREFIX });
  for (const k of list.keys) await env.KV.delete(k.name);
}

// 失败限速
const FAIL_PREFIX = 'login:fail:';
export async function canAttemptLogin(env: StoreEnv, ip: string): Promise<boolean> {
  return Number(await env.KV.get(FAIL_PREFIX + ip) || '0') < 8;
}
export async function recordLoginFail(env: StoreEnv, ip: string): Promise<void> {
  const fails = Number(await env.KV.get(FAIL_PREFIX + ip) || '0') + 1;
  await env.KV.put(FAIL_PREFIX + ip, String(fails), { expirationTtl: 600 });
}
export async function clearLoginFails(env: StoreEnv, ip: string): Promise<void> {
  await env.KV.delete(FAIL_PREFIX + ip);
}
