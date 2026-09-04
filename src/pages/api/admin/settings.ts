import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { getConfig, setConfig, checkAdminPassword, updateAdminPassword, hasAdminPasswordSet } from '@/lib/config';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const [site_name, site_welcome, mail_from, mail_resend_key, admin_password_set, walletRow] = await Promise.all([
    getConfig(env, 'site_name', ''),
    getConfig(env, 'site_welcome', ''),
    getConfig(env, 'mail_from', ''),
    getConfig(env, 'mail_resend_key', ''),
    hasAdminPasswordSet(env),
    env.DB.prepare(`SELECT COUNT(*) AS c FROM wallet_meta WHERE mnemonic<>''`).first<{ c: number }>(),
  ]);

  // 脱敏 Resend key
  const raw = mail_resend_key;
  const mask = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}****${k.slice(-4)}` : k ? '****' : '');
  const site_name_v = site_name || env.SITE_NAME || '樱花市集';
  const site_welcome_v = site_welcome || env.SITE_WELCOME || '欢迎来到二次元自助服务商店';

  return apiOk({
    site_name: site_name_v,
    site_welcome: site_welcome_v,
    site_name_from_env: !site_name,
    site_welcome_from_env: !site_welcome,
    mail_from,
    mail_from_from_env: !mail_from && !!env.MAIL_FROM,
    mail_resend_key_masked: mask(raw),
    mail_configured: !!(mail_from && mail_resend_key),
    admin_password_set,
    wallet_ready: (walletRow?.c ?? 0) > 0,
  });
};

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  let changed = false;

  // 修改管理员密码（需要验证当前密码）
  if (body.new_password !== undefined) {
    const newPwd = String(body.new_password);
    if (newPwd.length < 8) return apiErr('新密码至少 8 位');
    if (!(await checkAdminPassword(env, String(body.old_password || '')))) return apiErr('当前密码不正确');
    await updateAdminPassword(env, newPwd);
    await logAdminAction(env, '修改后台登录密码');
    changed = true;
  }

  // 邮件（留空则清除配置）
  if (body.mail_from !== undefined) { await setConfig(env, 'mail_from', String(body.mail_from || '').trim()); changed = true; }
  if (body.mail_resend_key !== undefined) { await setConfig(env, 'mail_resend_key', String(body.mail_resend_key || '').trim()); changed = true; }

  // 站点信息
  if (body.site_name !== undefined) { await setConfig(env, 'site_name', String(body.site_name || '').trim()); changed = true; }
  if (body.site_welcome !== undefined) { await setConfig(env, 'site_welcome', String(body.site_welcome || '').trim()); changed = true; }

  if (!changed) return apiErr('没有需要保存的更改');
  return apiOk({ ok: true });
};
