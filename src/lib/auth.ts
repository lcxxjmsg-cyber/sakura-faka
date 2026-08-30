import type { StoreEnv } from '@/types';

// ============================================================
// 后台鉴权：基于密码 + KV 存储登录会话 (服务端 rendered)
// 注意：真实生产应使用更强的鉴权，这里为教学/演示保持简单
// ============================================================

const SESSION_TTL = 60 * 60 * 24 * 7; // 7天
const SESSION_PREFIX = 'sess:';

export async function login(env: StoreEnv, password: string): Promise<boolean> {
  if (password === env.ADMIN_PASSWORD) {
    const sid = crypto.randomUUID();
    await env.KV.put(SESSION_PREFIX + sid, '1', { expirationTtl: SESSION_TTL });
    return true;
  }
  return false;
}

export async function checkSession(env: StoreEnv, sid: string): Promise<boolean> {
  if (!sid) return false;
  const v = await env.KV.get(SESSION_PREFIX + sid);
  return v === '1';
}

export function getSessionId(headers: Headers): string {
  const cookie = headers.get('Cookie') || '';
  const m = cookie.match(/session=([^;]+)/);
  return m ? m[1] : '';
}

export async function logout(env: StoreEnv, sid: string): Promise<void> {
  await env.KV.delete(SESSION_PREFIX + sid);
}

// 一次性密码登录简化版：客户端提交密码 -> 校验 -> 写 KV 标记登录
export async function setPasswordGrant(env: StoreEnv, sid: string): Promise<void> {
  await env.KV.put(SESSION_PREFIX + sid, '1', { expirationTtl: SESSION_TTL });
}

export function makeSid(): string {
  return crypto.randomUUID();
}
