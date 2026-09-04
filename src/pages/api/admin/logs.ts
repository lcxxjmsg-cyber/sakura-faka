import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100)));
  const { results } = await env.DB.prepare('SELECT * FROM admin_logs ORDER BY id DESC LIMIT ?').bind(limit).all();
  return apiOk(results || []);
};
