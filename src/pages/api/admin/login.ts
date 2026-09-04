import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { login, makeSid, setPasswordGrant, canAttemptLogin, recordLoginFail, clearLoginFails } from '@/lib/auth';

export const prerender = false;

// 后台登录：校验密码，写入 session cookie
export const POST: APIRoute = async ({ request, locals, cookies }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';

  // 暴力破解防护
  if (!(await canAttemptLogin(env, ip))) return apiErr('尝试次数过多，请 10 分钟后再试', 429);

  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!password) return apiErr('请输入密码');

  if (password === env.ADMIN_PASSWORD) {
    const sid = makeSid();
    await setPasswordGrant(env, sid);
    await clearLoginFails(env, ip);
    await logAdminAction(env, `登录成功 (ip=${ip})`);
    cookies.set('session', sid, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
    });
    return apiOk({ ok: true });
  }
  await recordLoginFail(env, ip);
  await logAdminAction(env, `登录失败 (ip=${ip})`);
  return apiErr('密码错误', 401);
};
