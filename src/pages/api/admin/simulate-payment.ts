import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { fulfillOrder } from '@/lib/orders';

export const prerender = false;

// 测试端点：将一笔 pending/paid 订单"模拟为已到账"并触发自动发货。
// 目的：不涉及真实链上转账，即可验证"下单→发货→创建归集任务"的完整链路。
// 生成的交易哈希为随机占位值，仅供测试，请勿当作真实支付。
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return apiErr('缺少订单号');

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first<any>();
  if (!order) return apiErr('订单不存在', 404);
  if (order.status !== 'pending' && order.status !== 'paid') return apiErr('该订单无需（或不能）模拟支付');

  const minConfirm = Number(env.TRON_CONFIRMATIONS || '1');
  const mockTxHash = 'sim_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const shipped = await fulfillOrder(env, order, mockTxHash, minConfirm);

  await logAdminAction(env, `模拟到账测试 ${orderId} tx=${mockTxHash} ${shipped ? '发货成功' : '发货失败'}`);
  return shipped
    ? apiOk({ shipped: true, tx_hash: mockTxHash, note: '已模拟到账并自动发货（测试用），可到“资金归集”干跑校验' })
    : apiErr('库存不足，模拟发货失败', 409);
};
