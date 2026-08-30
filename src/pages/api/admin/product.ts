import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { parseUsdt } from '@/lib/db';

export const prerender = false;

// 修改商品（价格/标题/状态等）
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return apiErr('参数错误');

  const fields: string[] = [];
  const values: any[] = [];

  if (body.title !== undefined) { fields.push('title=?'); values.push(String(body.title)); }
  if (body.description !== undefined) { fields.push('description=?'); values.push(String(body.description)); }
  if (body.cover !== undefined) { fields.push('cover=?'); values.push(String(body.cover)); }
  if (body.category !== undefined) { fields.push('category=?'); values.push(String(body.category)); }
  if (body.status !== undefined) { fields.push('status=?'); values.push(Number(body.status)); }
  if (body.sort !== undefined) { fields.push('sort=?'); values.push(Number(body.sort)); }
  if (body.price !== undefined) {
    try { fields.push('price=?'); values.push(parseUsdt(String(body.price))); }
    catch { return apiErr('价格格式错误'); }
  }

  if (!fields.length) return apiErr('没有可更新字段');
  fields.push('updated_at=datetime(\'now\')');

  await env.DB.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id=?`).bind(...values, id).run();
  return apiOk({ ok: true });
};
