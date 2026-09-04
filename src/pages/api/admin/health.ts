import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

type Health = { key: string; label: string; status: 'healthy' | 'degraded' | 'error'; detail?: string };

// 后台健康检查（只读）
export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const checks: Health[] = [];

  // D1
  try {
    await env.DB.prepare('SELECT 1').first();
    checks.push({ key: 'd1', label: '数据库 D1', status: 'healthy' });
  } catch (e: any) {
    checks.push({ key: 'd1', label: '数据库 D1', status: 'error', detail: e?.message || String(e) });
  }

  // KV
  try {
    await env.KV.put(`${Date.now()}_health`, '1', { expirationTtl: 60 });
    checks.push({ key: 'kv', label: 'KV', status: 'healthy' });
  } catch (e: any) {
    checks.push({ key: 'kv', label: 'KV', status: 'error', detail: e?.message || String(e) });
  }

  // TRON RPC
  try {
    const res = await fetch(`${env.TRON_RPC_URL}/wallet/getnowblock`, { headers: { accept: 'application/json' } });
    const data: any = await res.json();
    const num = data?.block_header?.raw_data?.number;
    checks.push({ key: 'tron', label: 'TRON RPC', status: typeof num === 'number' ? 'healthy' : 'degraded', detail: typeof num === 'number' ? `区块高度 ${num}` : '响应异常' });
  } catch (e: any) {
    checks.push({ key: 'tron', label: 'TRON RPC', status: 'error', detail: e?.message || String(e) });
  }

  // Email
  const mailConfigured = !!(env.MAIL_FROM && env.RESEND_API_KEY);
  checks.push({ key: 'email', label: '邮件 Email', status: mailConfigured ? 'healthy' : 'degraded', detail: mailConfigured ? '已配置' : '未配置（可选）' });

  // Wallet 加密密钥
  checks.push({ key: 'wallet', label: '钱包加密密钥', status: env.WALLET_ENCRYPTION_KEY ? 'healthy' : 'degraded', detail: env.WALLET_ENCRYPTION_KEY ? '已配置' : '未配置 WALLET_ENCRYPTION_KEY' });

  // 归集开关
  checks.push({ key: 'sweep', label: '自动归集', status: 'healthy', detail: env.AUTO_SWEEP_ENABLED === 'true' ? '已启用' : '未启用（安全默认）' });

  // Cron 最近一次运行
  try {
    const last = await env.DB.prepare(`SELECT job, status, started_at FROM job_runs ORDER BY id DESC LIMIT 1`).first<any>();
    checks.push({ key: 'cron', label: '定时 Job', status: last ? 'healthy' : 'degraded', detail: last ? `${last.job} ${last.status} @${(last.started_at || '').slice(11, 19)}` : '暂无 Job 运行记录（cron 未触发或未部署）' });
  } catch {
    checks.push({ key: 'cron', label: '定时 Job', status: 'degraded', detail: 'job_runs 表不可读（请执行 v9 迁移）' });
  }

  const degraded = checks.filter((c) => c.status === 'degraded').length;
  const error = checks.filter((c) => c.status === 'error').length;
  return apiOk({ checks, summary: { healthy: checks.length - degraded - error, degraded, error } });
};
