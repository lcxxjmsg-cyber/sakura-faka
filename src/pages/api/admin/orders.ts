import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { manualFulfill } from '@/lib/orders';

export const prerender = false;

// 后台订单列表
export const GET: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const status = url.searchParams.get('status');
  const limit = Number(url.searchParams.get('limit') || 100);
  let rows: any;
  if (status && status !== 'all') {
    rows = await env.DB.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT ?').bind(status, limit).all();
  } else {
    rows = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').bind(limit).all();
  }
  return apiOk(rows.results);
};

// 手动补发卡密（支付成功但没发出卡）
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const body = await request.json().catch(() => ({}));
  const orderId = String(body.order_id || '');
  if (!orderId) return apiErr('参数错误');
  const res = await manualFulfill(env, orderId);
  if (!res.ok) return apiErr(res.error || '补发失败');
  return apiOk({ ok: true });
};
