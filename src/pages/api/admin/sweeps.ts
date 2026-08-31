import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const { results } = await env.DB.prepare('SELECT * FROM sweep_tasks ORDER BY created_at DESC LIMIT 200').all();
  return apiOk(results || []);
};

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const txHash = String(body.tx_hash || '').trim();
  const status = ['pending', 'submitted', 'completed', 'failed'].includes(body.status) ? body.status : 'pending';
  if (!id) return apiErr('缺少归集任务 ID');
  await env.DB.prepare('UPDATE sweep_tasks SET status=?, tx_hash=?, note=?, updated_at=? WHERE id=?')
    .bind(status, txHash, String(body.note || ''), new Date().toISOString(), id).run();
  return apiOk({ ok: true });
};
