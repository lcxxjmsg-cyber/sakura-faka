import type { StoreEnv } from '@/types';
import { checkSession, getSessionId } from '@/lib/auth';

// 后台 API 鉴权：读取 Cookie 中 session，校验 KV
export async function requireAdmin(request: Request, env: StoreEnv): Promise<boolean> {
  const sid = getSessionId(request.headers);
  if (!sid) return false;
  return checkSession(env, sid);
}
