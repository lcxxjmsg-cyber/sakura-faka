import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, allowRate } from '@/lib/api';
import { createOrder } from '@/lib/orders';
import { validateOrderQty, MAX_ORDER_QTY } from '@/lib/validation';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown';
  if (!(await allowRate(env, `create:${ip}`, 10, 60))) return apiErr('请求过于频繁，请稍后再试', 429);
  const body = await request.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const email = String(body.email || '').trim().slice(0, 200);

  if (!productId || !Number.isFinite(productId) || productId < 0) return apiErr('请选择商品');

  const qty = validateOrderQty(body.qty);
  if (qty === null) return apiErr(`数量需为 1-${MAX_ORDER_QTY} 的整数`);

  try {
    const result = await createOrder(env, productId, qty, email);
    if (result.ok === false) return apiErr(result.error);
    return apiOk(result.order);
  } catch (e: any) {
    return apiErr('下单异常: ' + (e?.message || String(e)), 500);
  }
};
