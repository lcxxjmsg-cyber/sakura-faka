import { processPendingOrders, retryPendingEmails } from './lib/orders';
import { processPendingSweeps } from './lib/tron-sweep';
import { runJob } from './lib/jobs';
import type { StoreEnv } from './types';

export default {
  async scheduled(_controller: ScheduledController, env: StoreEnv, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      await Promise.all([
        runJob(env, 'paymentScanner', async (e) => ({ processed: await processPendingOrders(e), failed: 0 })),
        runJob(env, 'emailRetry', async (e) => ({ processed: await retryPendingEmails(e), failed: 0 })),
        runJob(env, 'sweepProcessor', (e) => processPendingSweeps(e)),
      ]);
    })());
  },

  async fetch(request: Request, env: StoreEnv) {
    const expected = env.CRON_SECRET || '';
    if (!expected || request.headers.get('x-cron-secret') !== expected) {
      return new Response('Unauthorized', { status: 401 });
    }
    const results = await Promise.all([
      runJob(env, 'paymentScanner', async (e) => ({ processed: await processPendingOrders(e), failed: 0 })),
      runJob(env, 'sweepProcessor', (e) => processPendingSweeps(e)),
    ]);
    return Response.json({ ok: true, results, at: new Date().toISOString() });
  },
};
