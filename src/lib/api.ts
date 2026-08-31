import type { APIRoute } from 'astro';
import type { StoreEnv } from '@/types';

// 通用 API 响应工具 (Astro API 端点)

export function getEnv(runtime: any): StoreEnv | null {
  return runtime?.env ?? null;
}

export function apiOk(data: any) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export function apiErr(error: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function allowRate(env: StoreEnv, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  const current = Number(await env.KV.get(bucket) || '0');
  if (current >= limit) return false;
  await env.KV.put(bucket, String(current + 1), { expirationTtl: windowSeconds + 5 });
  return true;
}
