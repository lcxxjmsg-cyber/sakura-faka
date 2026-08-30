import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

// 删除商品及其卡密
export const DELETE: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const id = Number(url.pathname.split('/').pop());
  if (!id) return apiErr('参数错误');

  await env.DB.batch([
    env.DB.prepare('DELETE FROM cards WHERE product_id=?').bind(id),
    env.DB.prepare('DELETE FROM products WHERE id=?').bind(id),
  ]);
  return apiOk({ ok: true });
};
