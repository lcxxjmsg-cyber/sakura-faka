import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { makeSid, setPasswordGrant, canAttemptLogin, recordLoginFail, clearLoginFails, getSessionId } from '@/lib/auth';
import { checkAdminPassword, usingDefaultPassword } from '@/lib/config';

export const prerender = false;

// 后台登录：fail-closed（无任何凭据则拒绝），记录 session 元数据(ip/ua)，Secure cookie。
export const POST: APIRoute = async ({ request, locals, cookies }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
  const ua = request.headers.get('user-agent') || '';

  if (!(await canAttemptLogin(env, ip))) return apiErr('尝试次数过多，请 10 分钟后再试', 429);

  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!password) return apiErr('请输入密码');

  if (await usingDefaultPassword(env)) return apiErr('系统未配置登录凭据，请先设置 ADMIN_PASSWORD 或在数据库初始化密码', 403);

  if (await checkAdminPassword(env, password)) {
    const sid = makeSid(); // rotation：每次登录新 SID
    await setPasswordGrant(env, sid, { ip, ua });
    await clearLoginFails(env, ip);
    await logAdminAction(env, `登录成功 (ip=${ip})`);
    cookies.set('session', sid, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
    });
    return apiOk({ ok: true });
  }
  await recordLoginFail(env, ip);
  await logAdminAction(env, `登录失败 (ip=${ip})`);
  return apiErr('密码错误', 401);
};
