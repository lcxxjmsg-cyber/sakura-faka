import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { queryOrder } from '@/lib/orders';

export const prerender = false;

// 查看已购卡密内容（须订单已发货 + 携带正确 view_token）
export const GET: APIRoute = async ({ url, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const id = url.searchParams.get('id');
  const token = url.searchParams.get('token') || '';
  if (!id) return apiErr('参数错误');
  const order = await queryOrder(env, id);
  if (!order) return apiErr('订单不存在', 404);
  if (order.status !== 'shipped') return apiErr('订单尚未完成', 400);
  // 私密 token 校验：只有下单买家才能查看卡密
  if (!token || token !== order.view_token) return apiErr('无权查看卡密', 403);

  if (!order.card_ids) return apiErr('订单无卡密记录', 400);

  const ids = order.card_ids.split(',').map((x: string) => Number(x)).filter(Boolean);
  if (!ids.length) return apiErr('订单无卡密记录', 400);

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT card FROM cards WHERE id IN (${placeholders})`).bind(...ids).all();
  const cards = (results || []).map((r: any) => r.card);
  return apiOk(cards);
};
