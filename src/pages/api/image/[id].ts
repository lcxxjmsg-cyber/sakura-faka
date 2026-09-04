import type { APIRoute } from 'astro';
import { getEnv } from '@/lib/api';

export const prerender = false;

// 读取已上传的商品图（公开）
export const GET: APIRoute = async ({ params, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return new Response('server error', { status: 500 });
  const id = String(params.id || '');
  if (!id) return new Response('not found', { status: 404 });
  const got = await env.KV.getWithMetadata('img:' + id, 'arrayBuffer');
  if (got.value === null) return new Response('not found', { status: 404 });
  return new Response(got.value, {
    headers: {
      'content-type': (got.metadata as any)?.type || 'application/octet-stream',
      'cache-control': 'public, max-age=604800',
      'x-content-type-options': 'nosniff',
    },
  });
};
