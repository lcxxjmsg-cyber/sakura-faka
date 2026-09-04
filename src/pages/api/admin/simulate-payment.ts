import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { fulfillOrder } from '@/lib/orders';
import { transitionOrder } from '@/domain/order/order.state';

export const prerender = false;

// 测试端点：将一笔 pending/paid 订单"模拟为已到账"并触发自动发货。
// 不涉及真实链上转账。生成的交易哈希为随机占位值，仅供测试。
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  // 生产环境默认禁用模拟付款工具，仅 ENABLE_DEBUG_TOOLS=true 时可用
  if (env.ENABLE_DEBUG_TOOLS !== 'true') return apiErr('调试工具未启用', 404);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  const orderId = String(body.order_id || '').trim();
  if (!orderId) return apiErr('缺少订单号');

  const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first<any>();
  if (!order) return apiErr('订单不存在', 404);
  if (!['pending', 'payment_detected', 'paid'].includes(order.status)) return apiErr('该订单无需（或不能）模拟支付');

  // 先推进到 paid（模拟链上确认），再走真实发货 CAS
  if (order.status !== 'paid') {
    const moved = await transitionOrder(env.DB, orderId, order.status, 'paid', 'simulate_paid', '后台模拟到账');
    if (!moved) return apiErr('模拟失败：状态推进失败', 409);
  }
  const fresh = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first<any>();

  const minConfirm = Number(env.TRON_CONFIRMATIONS || '1');
  const mockTxHash = 'sim_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const shipped = await fulfillOrder(env, fresh, mockTxHash, minConfirm);

  await logAdminAction(env, `模拟到账测试 ${orderId} tx=${mockTxHash} ${shipped ? '发货成功' : '发货失败'}`);
  return shipped
    ? apiOk({ shipped: true, tx_hash: mockTxHash, note: '已模拟到账并自动发货（测试用），可到“资金归集”干跑校验' })
    : apiErr('库存不足或并发冲突，模拟发货失败', 409);
};
