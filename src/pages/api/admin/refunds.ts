import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { parseUsdt } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const { results } = await env.DB.prepare(
    `SELECT r.*, o.product_title AS product_title FROM refunds r LEFT JOIN orders o ON o.id=r.order_id ORDER BY r.created_at DESC LIMIT 200`,
  ).all();
  return apiOk(results || []);
};

// 新建退款 或 更新退款状态
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));

  // 更新已有退款（标记状态 / 补 tx_hash / 备注）
  if (body.id) {
    const id = Number(body.id);
    const fields: string[] = [];
    const values: any[] = [];
    if (body.status !== undefined && ['requested', 'processing', 'refunded', 'failed'].includes(body.status)) { fields.push('status=?'); values.push(body.status); }
    if (body.tx_hash !== undefined) { fields.push('tx_hash=?'); values.push(String(body.tx_hash)); }
    if (body.note !== undefined) { fields.push('note=?'); values.push(String(body.note)); }
    if (!fields.length) return apiErr('没有可更新字段');
    fields.push('updated_at=datetime(\'now\')');
    await env.DB.prepare(`UPDATE refunds SET ${fields.join(', ')} WHERE id=?`).bind(...values, id).run();
    await logAdminAction(env, `退款状态更新 #${id}`);
    return apiOk({ ok: true });
  }

  // 新建退款申请
  const orderId = String(body.order_id || '').trim();
  const address = String(body.refund_address || '').trim();
  if (!orderId || !address) return apiErr('缺少订单号或退款地址');
  let amount: string;
  try { amount = parseUsdt(String(body.amount || '0')); } catch { return apiErr('退款金额格式错误'); }
  const res = await env.DB.prepare(`INSERT INTO refunds (order_id, amount, refund_address, tx_hash, status, note) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(orderId, amount, address, String(body.tx_hash || ''), String(body.status || 'requested'), String(body.note || '')).run();
  await logAdminAction(env, `新建退款订单 ${orderId} 金额 ${amount}`);
  return apiOk({ ok: true, id: res.meta.last_row_id });
};
