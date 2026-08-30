import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { getProducts } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const products = await getProducts(env.DB);
  const rows = products.map((p: any) => ({
    id: p.id,
    title: p.title,
    cover: p.cover,
    price: p.price,
    desc: (p.description || '').slice(0, 120),
    category: p.category,
    stock: p.stock,
    sold: p.sold,
  }));
  return apiOk(rows);
};
