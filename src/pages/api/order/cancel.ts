import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { cancelOrder } from '@/lib/orders';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const body = await request.json().catch(() => ({}));
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return apiErr('缺少订单号');
  const result = await cancelOrder(env, orderId);
  return result.ok ? apiOk({ status: 'closed' }) : apiErr(result.error || '取消失败', 409);
};
