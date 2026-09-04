import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { processPendingOrders } from '@/lib/orders';
import { processPendingSweeps } from '@/lib/tron-sweep';
import { runJob } from '@/lib/jobs';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);

  // 允许来自 Cloudflare Cron 的调用（Cron 触发器会带 CF-Cron: 1 头）
  const isCron = request.headers.get('CF-Cron') === '1';
  const secret = env.CRON_SECRET || '';
  const provided = request.headers.get('x-cron-secret');
  const authorized = isCron || (secret && provided === secret);
  if (!authorized) return apiErr('未授权', 401);

  const results = await Promise.all([
    runJob(env, 'paymentScanner', async (e) => ({ processed: await processPendingOrders(e), failed: 0 })),
    runJob(env, 'sweepProcessor', (e) => processPendingSweeps(e)),
  ]);
  return apiOk({ results, at: new Date().toISOString() });
};
