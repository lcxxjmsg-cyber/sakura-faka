import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

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
  if (!order.card_ids) return apiOk({ order, cards: [], note: '该订单暂无卡密记录' });

  const ids = order.card_ids.split(',').map((x: string) => Number(x)).filter(Boolean);
  if (!ids.length) return apiOk({ order, cards: [], note: '该订单暂无卡密记录' });

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT card FROM cards WHERE id IN (${placeholders})`).bind(...ids).all();
  return apiOk({ order, cards: (results || []).map((r: any) => r.card) });
};
