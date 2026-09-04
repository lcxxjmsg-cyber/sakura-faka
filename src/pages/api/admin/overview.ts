import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

// 后台 Dashboard 聚合数据（只读）
export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const db = env.DB;

  const today = await db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('paid','fulfilling','shipped') THEN CAST(total_price AS INTEGER) ELSE 0 END) AS sales,
      COUNT(*) AS orders
    FROM orders WHERE date(created_at) = date('now')
  `).first<any>();

  const counts = await db.prepare(`SELECT status, COUNT(*) AS c FROM orders GROUP BY status`).all<any>();

  const pendingPay = (counts.results || []).find((r) => r.status === 'pending')?.c || 0;
  const pendingShip = (counts.results || []).find((r) => r.status === 'paid')?.c || 0;
  const detected = (counts.results || []).find((r) => r.status === 'payment_detected')?.c || 0;
  const manualReview = (counts.results || []).find((r) => r.status === 'manual_review')?.c || 0;

  const sweep = await db.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(CAST(amount AS INTEGER)),0) AS amt FROM sweep_tasks WHERE status NOT IN ('completed','failed_permanent')`).first<any>();

  const lowStock = await db.prepare(`SELECT id, title, stock FROM products ORDER BY stock ASC LIMIT 8`).all<any>();

  // 近 7 天趋势
  const trends = await db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN status IN ('paid','fulfilling','shipped') THEN CAST(total_price AS INTEGER) ELSE 0 END),0) AS sales
    FROM orders WHERE created_at >= datetime('now','-6 days') GROUP BY day ORDER BY day ASC
  `).all<any>();

  const recent = await db.prepare(`SELECT id, product_title, qty, total_price, status, created_at FROM orders ORDER BY created_at DESC LIMIT 8`).all<any>();

  return apiOk({
    today_sales: today?.sales || 0,
    today_orders: today?.orders || 0,
    pending_pay: pendingPay,
    pending_ship: pendingShip,
    detected,
    manual_review: manualReview,
    pending_sweep_count: sweep?.c || 0,
    pending_sweep_usdt: sweep?.amt || 0,
    low_stock: lowStock.results || [],
    trends: trends.results || [],
    status_distribution: counts.results || [],
    recent_orders: recent.results || [],
  });
};
