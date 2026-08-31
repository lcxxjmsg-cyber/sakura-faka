import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { parseUsdt } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const { results } = await env.DB.prepare('SELECT * FROM refunds ORDER BY created_at DESC LIMIT 200').all();
  return apiOk(results || []);
};

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const body = await request.json().catch(() => ({}));
  const orderId = String(body.order_id || '').trim();
  const address = String(body.refund_address || '').trim();
  if (!orderId || !address) return apiErr('缺少订单号或退款地址');
  let amount: string;
  try { amount = parseUsdt(String(body.amount || '0')); } catch { return apiErr('退款金额格式错误'); }
  await env.DB.prepare(`INSERT INTO refunds (order_id, amount, refund_address, tx_hash, status, note) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(orderId, amount, address, String(body.tx_hash || ''), String(body.status || 'requested'), String(body.note || '')).run();
  return apiOk({ ok: true });
};
