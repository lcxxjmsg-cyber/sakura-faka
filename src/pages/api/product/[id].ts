import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { getProduct } from '@/lib/db';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  const id = Number(params.id);
  if (!id) return apiErr('参数错误');
  const product = await getProduct(env.DB, id);
  if (!product) return apiErr('商品不存在', 404);
  return apiOk(product);
};
