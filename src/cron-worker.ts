import { processPendingOrders } from './lib/orders';
import type { StoreEnv } from './types';

export default {
  async scheduled(_controller: ScheduledController, env: StoreEnv, ctx: ExecutionContext) {
    ctx.waitUntil(processPendingOrders(env));
  },

  async fetch(request: Request, env: StoreEnv) {
    const expected = env.CRON_SECRET || '';
    if (!expected || request.headers.get('x-cron-secret') !== expected) {
      return new Response('Unauthorized', { status: 401 });
    }
    const processed = await processPendingOrders(env);
    return Response.json({ ok: true, processed, at: new Date().toISOString() });
  },
};
