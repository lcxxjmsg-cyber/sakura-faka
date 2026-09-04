import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { generateWallet, getWalletOverview, clearWalletMnemonic, revealMnemonic } from '@/lib/wallet';
import { checkAdminPassword } from '@/lib/config';

export const prerender = false;

// 后台：钱包概览（绝不返回明文助记词）
export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const overview = await getWalletOverview(env);
  return apiOk(overview);
};

// 生成 / 重新生成 / 清除 / 重新导出（需验证当前密码）
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();

  if (action === 'generate') {
    const overview = await getWalletOverview(env);
    if (overview.has_mnemonic) return apiErr('已存在收款钱包，如需更换请使用“重新生成”');
    try {
      const wallet = await generateWallet(env);
      await logAdminAction(env, '一键生成收款钱包（加密存储）');
      return apiOk({ ok: true, generated: true, mnemonic: wallet.mnemonic, master_address: wallet.master_address });
    } catch (e: any) {
      return apiErr(e?.message || '生成失败', 400);
    }
  }

  if (action === 'regenerate') {
    if (body.confirm !== 'REGENERATE') return apiErr('需要二次确认：confirm=REGENERATE');
    if (!(await checkAdminPassword(env, String(body.password || '')))) return apiErr('请重新输入管理员密码以确认（re-auth）', 401);
    try {
      const wallet = await generateWallet(env);
      await logAdminAction(env, '重新生成整套收款钱包（旧子地址作废，已二次验证）');
      return apiOk({ ok: true, generated: true, mnemonic: wallet.mnemonic, master_address: wallet.master_address });
    } catch (e: any) {
      return apiErr(e?.message || '生成失败', 400);
    }
  }

  if (action === 'clear') {
    if (!(await checkAdminPassword(env, String(body.password || '')))) return apiErr('请重新输入管理员密码以确认（re-auth）', 401);
    await clearWalletMnemonic(env);
    await logAdminAction(env, '清除系统保存的助记词（保留主地址，已二次验证）');
    return apiOk({ ok: true });
  }

  // 重新导出助记词：高危操作，必须重新验证当前管理员密码（预留 TOTP 二次认证）
  if (action === 'reveal') {
    if (!(await checkAdminPassword(env, String(body.password || '')))) return apiErr('密码验证失败，无法导出', 401);
    const mnemonic = await revealMnemonic(env);
    if (!mnemonic) return apiErr('系统未保存助记词', 404);
    await logAdminAction(env, '重新导出钱包助记词（已二次验证）');
    return apiOk({ ok: true, mnemonic });
  }

  return apiErr('未知操作');
};
