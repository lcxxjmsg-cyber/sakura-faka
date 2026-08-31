import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const [orders, products, payments] = await Promise.all([
    env.DB.prepare('SELECT status, COUNT(*) AS count, COALESCE(SUM(CAST(total_price AS INTEGER)), 0) AS amount FROM orders GROUP BY status').all(),
    env.DB.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(stock), 0) AS stock, COALESCE(SUM(sold), 0) AS sold FROM products').first(),
    env.DB.prepare('SELECT status, COUNT(*) AS count FROM payment_transactions GROUP BY status').all(),
  ]);
  return apiOk({ orders: orders.results || [], products, payments: payments.results || [] });
};
