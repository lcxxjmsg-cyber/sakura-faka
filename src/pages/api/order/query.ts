import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { queryOrder } from '@/lib/orders';

export const prerender = false;

// 查询订单状态（前台轮询，确认是否支付成功/发货）
// 注意：裁剪敏感字段（地址/邮箱/card_ids/view_token），仅返回必要状态信息
export const GET: APIRoute = async ({ url, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const id = url.searchParams.get('id');
  if (!id) return apiErr('参数错误');
  const order = await queryOrder(env, id);
  if (!order) return apiErr('订单不存在', 404);
  return apiOk({
    id: order.id,
    status: order.status,
    tx_confirm: order.tx_confirm,
    address: order.address,
    created_at: order.created_at,
    total_price: order.total_price,
    product_title: order.product_title,
    qty: order.qty,
  });
};
