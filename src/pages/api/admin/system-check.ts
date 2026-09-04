import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { deriveTronAddress, tronToHex21, USDT_TRC20_CONTRACT } from '@/lib/tron';
import { usingDefaultPassword, isAutoSweepEnabled } from '@/lib/config';

export const prerender = false;

type Check = { key: string; label: string; ok: boolean; value?: string; note?: string };

// 后台"系统自检"：检查环境配置、数据库连通、合约地址、地址派生、链上 RPC 等。
// 只读、不广播任何交易，无资金风险。
export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const checks: Check[] = [];

  // 1) 管理员密码安全（数据库哈希或自定义环境变量，绝不使用默认值）
  const useDefault = await usingDefaultPassword(env);
  checks.push({ key: 'ADMIN_PASSWORD', label: '管理员密码', ok: !useDefault, note: useDefault ? '仍在使用默认密码 faka8888，请尽快在「系统设置」修改' : '已设置' });

  // 2) 收款钱包就绪（后台已生成 或 配置了外部助记词）
  const hasExternal = !!env.TRON_MNEMONIC;
  const walletRow = await env.DB.prepare(`SELECT COUNT(*) AS c FROM wallet_meta WHERE encrypted_mnemonic<>'' OR mnemonic<>''`).first<{ c: number }>();
  const walletReady = hasExternal || (walletRow?.c ?? 0) > 0;
  checks.push({ key: 'WALLET', label: '收款钱包', ok: walletReady, note: walletReady ? '已就绪' : '未生成（可到「收款钱包」一键生成）' });

  // 3) 可选项：仅提示，不算失败
  checks.push({ key: 'CRON_SECRET', label: 'Cron 手动触发密钥', ok: true, note: '可选：定时自动跑不需要；仅手动调用 /api/cron 需要' });
  checks.push({ key: 'TRON_MASTER_ADDRESS', label: '归集主钱包', ok: true, note: env.TRON_MASTER_ADDRESS ? '使用外部地址' : '使用系统内置钱包（后台生成）' });
  checks.push({ key: 'EMAIL', label: '邮件通知', ok: true, note: (env.RESEND_API_KEY && env.MAIL_FROM) ? '已配置' : '未配置（可选）' });

  // 4) 自动归集开关（当前状态，仅提示）
  const autoSweep = await isAutoSweepEnabled(env);
  checks.push({ key: 'AUTO_SWEEP_ENABLED', label: '自动归集', ok: autoSweep, note: autoSweep ? '已开启（真实广播）' : '未开启（可在「系统设置 → 功能开关」开启）' });

  // 2) 数据库连通 + 表
  try {
    await env.DB.prepare('SELECT COUNT(*) AS c FROM products').first();
    checks.push({ key: 'DB', label: '数据库 D1', ok: true, value: '可连接' });
  } catch {
    checks.push({ key: 'DB', label: '数据库 D1', ok: false, note: '无法查询，请检查绑定/迁移' });
  }

  // 3) 合约地址校验
  try {
    const want = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c';
    const got = tronToHex21(USDT_TRC20_CONTRACT).toLowerCase();
    checks.push({ key: 'CONTRACT', label: 'USDT 合约地址', ok: got === want, value: got, note: got === want ? '正确 (Tether USD 主网)' : '不正确，请检查 USDT_TRC20_CONTRACT' });
  } catch (e: any) {
    checks.push({ key: 'CONTRACT', label: 'USDT 合约地址', ok: false, note: '解码失败: ' + (e?.message || String(e)) });
  }

  // 4) 地址派生
  if (env.TRON_MNEMONIC) {
    const a0 = deriveTronAddress(env.TRON_MNEMONIC, 0);
    const a1 = deriveTronAddress(env.TRON_MNEMONIC, 1);
    checks.push({
      key: 'DERIVE', label: 'HD 地址派生', ok: !!a0 && a0.startsWith('T'),
      value: a0?.slice(0, 12) + '…', note: a0 ? '派生正常' : '派生失败（助记词无效）',
    });
  }

  // 5) 链上 RPC（只读）
  try {
    const block = await getLatestBlock(env.TRON_RPC_URL);
    checks.push({ key: 'RPC', label: 'TRON 链上 RPC', ok: block !== null, value: block ? `区块高度 ${block}` : 'N/A', note: '只读查询' });
  } catch {
    checks.push({ key: 'RPC', label: 'TRON 链上 RPC', ok: false, note: '无法连接 TronGrid' });
  }

  // 6) 归集任务/支付统计
  try {
    const sweep = await env.DB.prepare(`SELECT COUNT(*) AS c FROM sweep_tasks WHERE status='pending'`).first<any>();
    const pay = await env.DB.prepare('SELECT COUNT(*) AS c FROM payment_transactions').first<any>();
    checks.push({ key: 'TASKS', label: '资金归集/支付流水', ok: true, value: `待归集 ${sweep?.c ?? 0} / 流水 ${pay?.c ?? 0}` });
  } catch {
    checks.push({ key: 'TASKS', label: '资金归集/支付流水', ok: false, note: '查询失败，请执行 v7 迁移' });
  }

  return apiOk({ checks, ok: checks.every((c) => c.ok) });
};

async function getLatestBlock(rpcUrl: string): Promise<number | null> {
  try {
    const res = await fetch(`${rpcUrl}/wallet/getnowblock`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data: any = await res.json();
    const num = data?.block_header?.raw_data?.number;
    return typeof num === 'number' ? num : null;
  } catch {
    return null;
  }
}
