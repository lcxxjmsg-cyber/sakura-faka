import type { APIRoute } from 'astro';
import type { StoreEnv } from '@/types';

// 通用 API 响应工具 (Astro API 端点)

export function getEnv(runtime: any): StoreEnv | null {
  return runtime?.env ?? null;
}

// 记录后台操作日志（写入 admin_logs 表，尽力而为）
export async function logAdminAction(env: StoreEnv, action: string): Promise<void> {
  try {
    await env.DB.prepare('INSERT INTO admin_logs (action) VALUES (?)').bind(String(action).slice(0, 500)).run();
  } catch {
    // 日志失败不影响主流程
  }
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
