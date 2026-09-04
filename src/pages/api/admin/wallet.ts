import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { generateWallet, getWalletOverview, clearWalletMnemonic, verifyWallet } from '@/lib/wallet';

export const prerender = false;

// 后台：钱包概览（含助记词，仅登录管理员可见）
export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const overview = await getWalletOverview(env);
  return apiOk(overview);
};

// 后台：生成 / 重新生成 / 清除 / 校验
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();

  if (action === 'generate') {
    const overview = await getWalletOverview(env);
    if (overview.has_mnemonic) return apiErr('已存在收款钱包，如需更换请使用“重新生成”');
    const wallet = await generateWallet(env);
    await logAdminAction(env, '一键生成收款钱包');
    return apiOk({ ok: true, generated: true, ...wallet });
  }

  if (action === 'regenerate') {
    if (body.confirm !== 'REGENERATE') return apiErr('需要二次确认：confirm=REGENERATE');
    const wallet = await generateWallet(env);
    await logAdminAction(env, '重新生成整套收款钱包（旧子地址作废）');
    return apiOk({ ok: true, generated: true, ...wallet });
  }

  if (action === 'clear') {
    await clearWalletMnemonic(env);
    await logAdminAction(env, '清除系统保存的助记词（保留主地址）');
    return apiOk({ ok: true });
  }

  if (action === 'verify') {
    const { consistent } = await verifyWallet(env);
    return apiOk({ ok: true, consistent });
  }

  return apiErr('未知操作');
};
