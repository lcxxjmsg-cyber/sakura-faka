import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { getOrderCards } from '@/lib/db';

export const prerender = false;

// 订单详情（Drawer）：订单 + 状态时间线 + 支付流水 + 卡密 + 归集任务
export const GET: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const id = String(url.searchParams.get('order_id') || '').trim();
  if (!id) return apiErr('缺少订单号');

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<any>();
  if (!order) return apiErr('订单不存在', 404);

  const [events, payments, cardsRes, sweeps] = await Promise.all([
    env.DB.prepare(`SELECT * FROM order_events WHERE order_id=? ORDER BY id ASC`).bind(id).all(),
    env.DB.prepare(`SELECT * FROM payment_transactions WHERE order_id=? ORDER BY id ASC`).bind(id).all(),
    getOrderCards(env.DB, id),
    env.DB.prepare(`SELECT * FROM sweep_tasks WHERE order_id=? ORDER BY id ASC`).bind(id).all(),
  ]);

  return apiOk({
    order,
    events: events.results || [],
    payments: payments.results || [],
    cards: cardsRes.map((c) => ({ id: c.id, card: c.card, sold_at: c.sold_at })),
    sweeps: sweeps.results || [],
  });
};
