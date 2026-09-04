import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { getOrderCards } from '@/lib/db';

export const prerender = false;

// 后台查看某订单的卡密内容（免 view_token，仅限已登录管理员）
export const GET: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const id = String(url.searchParams.get('order_id') || '').trim();
  if (!id) return apiErr('缺少订单号');

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<any>();
  if (!order) return apiErr('订单不存在', 404);

  const cards = await getOrderCards(env.DB, id);
  return apiOk({ order, cards: cards.map((c) => c.card) });
};
