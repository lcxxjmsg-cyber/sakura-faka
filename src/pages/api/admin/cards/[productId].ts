import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

// 查询某商品的卡密列表
export const GET: APIRoute = async ({ request, locals, url, params }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const productId = Number(params.productId);
  const limit = Number(url.searchParams.get('limit') || 100);
  if (!productId) return apiErr('参数错误');

  const { results } = await env.DB.prepare(
    'SELECT id, status, sold_at FROM cards WHERE product_id=? ORDER BY id DESC LIMIT ?',
  ).bind(productId, limit).all();
  return apiOk(results);
};
