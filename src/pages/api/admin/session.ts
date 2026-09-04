import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { getSessionId, logout, revokeAll, getSessionMeta } from '@/lib/auth';

export const prerender = false;

// 会话管理：查看元数据 / logout / revoke current / revoke all
export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const sid = getSessionId(request.headers);
  const meta = sid ? await getSessionMeta(env, sid) : null;
  return apiOk({ session: meta });
};

export const POST: APIRoute = async ({ request, locals, cookies }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  const sid = getSessionId(request.headers);

  if (action === 'logout' || action === 'revoke_current') {
    if (sid) await logout(env, sid);
    cookies.delete('session', { path: '/' });
    await logAdminAction(env, `登出（${action}）`);
    return apiOk({ ok: true });
  }
  if (action === 'revoke_all') {
    await revokeAll(env);
    cookies.delete('session', { path: '/' });
    await logAdminAction(env, '登出全部会话');
    return apiOk({ ok: true });
  }
  return apiErr('未知操作');
};
