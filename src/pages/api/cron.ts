import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { processPendingOrders } from '@/lib/orders';
import { processPendingSweeps } from '@/lib/tron-sweep';

// Cron 触发入口：轮询所有 pending 订单，确认到账后自动发货
// 部署后在 Cloudflare Dashboard 配置 Cron Trigger 定时调用本端点
// 需设置一个 secret：CRON_SECRET 防被滥用（也兼容 CF Cron 触发时带 Cron 头）
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

  const processed = await processPendingOrders(env);
  const sweeps = await processPendingSweeps(env);
  return apiOk({ processed, sweeps, at: new Date().toISOString() });
};
