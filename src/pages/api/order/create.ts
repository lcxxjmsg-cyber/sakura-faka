import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { createOrder } from '@/lib/orders';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const body = await request.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const qtyRaw = body.qty;
  const qty = Math.trunc(Number(qtyRaw));
  const email = String(body.email || '').trim().slice(0, 200);

  if (!productId || !Number.isFinite(productId)) return apiErr('请选择商品');
  if (!Number.isInteger(qty)) return apiErr('数量需为整数');
  try {
    const result = await createOrder(env, productId, qty, email);
    if (!result.ok) return apiErr(result.error);
    return apiOk(result.order);
  } catch (e: any) {
    return apiErr('下单异常: ' + (e?.message || String(e)), 500);
  }
};
