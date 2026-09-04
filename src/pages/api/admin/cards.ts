import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

// 卡密库存：列表（可按商品/状态筛选、搜索）+ 删除
export const GET: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const productId = Number(url.searchParams.get('product_id') || 0);
  const status = url.searchParams.get('status');
  const q = String(url.searchParams.get('q') || '').trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));

  const where: string[] = [];
  const binds: any[] = [];
  if (productId) { where.push('c.product_id=?'); binds.push(productId); }
  if (status === '0' || status === '1') { where.push('c.status=?'); binds.push(Number(status)); }
  if (q) { where.push('c.card LIKE ?'); binds.push('%' + q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.product_id, p.title AS product_title, c.card, c.status, c.order_id, c.sold_at, c.created_at
     FROM cards c LEFT JOIN products p ON p.id=c.product_id ${whereSql} ORDER BY c.id DESC LIMIT ?`,
  ).bind(...binds, limit).all();
  return apiOk(results || []);
};

// 删除卡密（仅未售可删，避免破坏已发货订单）
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return apiErr('缺少卡密 ID');
  const run = await env.DB.prepare('DELETE FROM cards WHERE id=? AND status=0').bind(id).run();
  if ((run.meta?.changes ?? 0) === 0) return apiErr('仅可删除未售出的卡密');
  await logAdminAction(env, `删除卡密 #${id}`);
  return apiOk({ ok: true });
};
