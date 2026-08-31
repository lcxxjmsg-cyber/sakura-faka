import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { checkOrderPayment } from '@/lib/orders';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const body = await request.json().catch(() => ({}));
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return apiErr('缺少订单号');
  try {
    const result = await checkOrderPayment(env, orderId);
    return result.ok ? apiOk(result) : apiErr(result.error || '检测失败', 409);
  } catch {
    return apiErr('暂时无法连接支付网络，请稍后重试', 503);
  }
};
