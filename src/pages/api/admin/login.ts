import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { login, makeSid, setPasswordGrant } from '@/lib/auth';

export const prerender = false;

// 后台登录：校验密码，写入 session cookie
export const POST: APIRoute = async ({ request, locals, cookies }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const body = await request.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!password) return apiErr('请输入密码');

  if (password === env.ADMIN_PASSWORD) {
    const sid = makeSid();
    await setPasswordGrant(env, sid);
    cookies.set('session', sid, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7,
    });
    return apiOk({ ok: true });
  }
  return apiErr('密码错误', 401);
};
