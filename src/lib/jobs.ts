import type { StoreEnv } from '@/types';
import { logger } from '@/lib/logger';

export type JobResult = { processed: number; failed: number; error?: string };
export type JobFn = (env: StoreEnv) => Promise<JobResult | void>;

// 记录一次 Job 执行到 job_runs（运行状态/结果/耗时），隔离失败。
export async function runJob(env: StoreEnv, name: string, fn: JobFn): Promise<JobResult> {
  const started = new Date().toISOString();
  let jobId: number | null = null;
  try {
    const ins = await env.DB.prepare('INSERT INTO job_runs (job, status, started_at) VALUES (?, ?, ?)').bind(name, 'running', started).run();
    jobId = ins.meta.last_row_id;
    const res = (await fn(env)) || { processed: 0, failed: 0 };
    await env.DB.prepare('UPDATE job_runs SET status=?, processed=?, failed=?, finished_at=? WHERE id=?')
      .bind('finished', res.processed ?? 0, res.failed ?? 0, new Date().toISOString(), jobId).run();
    logger.info(`job finished`, { job: name, ...res });
    return res;
  } catch (e: any) {
    if (jobId) {
      try { await env.DB.prepare('UPDATE job_runs SET status=?, error=?, finished_at=? WHERE id=?').bind('failed', String(e?.message || e), new Date().toISOString(), jobId).run(); }
      catch { /* ignore */ }
    }
    logger.error(`job failed`, { job: name, error: e?.message || String(e) });
    return { processed: 0, failed: 1, error: e?.message || String(e) };
  }
}
