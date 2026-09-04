import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { parseUsdt } from '@/lib/db';

export const prerender = false;

// 商品列表（后台，含全部状态）
export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const { results } = await env.DB.prepare('SELECT * FROM products ORDER BY sort DESC, id DESC').all();
  return apiOk(results);
};

// 新增商品
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || '').trim();
  if (!title) return apiErr('请填写商品标题');

  let price: string;
  try {
    price = parseUsdt(String(body.price || '0'));
  } catch {
    return apiErr('价格格式错误');
  }

  const description = String(body.description || '');
  const cover = String(body.cover || '');
  const category = String(body.category || '');
  const deliveryType = ['text', 'json', 'manual'].includes(body.delivery_type) ? body.delivery_type : 'text';
  const sort = Number(body.sort ?? 0);
  const status = body.status === 0 ? 0 : 1;

  const res = await env.DB.prepare(
    `INSERT INTO products (title, description, cover, price, category, delivery_type, sort, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(title, description, cover, price, category, deliveryType, sort, status)
    .run();
  await logAdminAction(env, `新增商品 ${title} #${res.meta.last_row_id}`);
  return apiOk({ id: res.meta.last_row_id });
};
