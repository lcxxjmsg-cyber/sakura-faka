import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { trySweep, claimSweep, type SweepTask, type SweepResult } from '@/lib/tron-sweep';
import { isAutoSweepEnabled, checkAdminPassword } from '@/lib/config';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const { results } = await env.DB.prepare('SELECT * FROM sweep_tasks ORDER BY created_at DESC LIMIT 200').all();
  return apiOk(results || []);
};

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return apiErr('缺少归集任务 ID');
  const task = await env.DB.prepare('SELECT * FROM sweep_tasks WHERE id=?').bind(id).first<SweepTask>();
  if (!task) return apiErr('归集任务不存在');

  // 手动触发：干跑(dry_run) 或 真实广播(sweep)
  const action = String(body.action || 'update');
  if (action === 'sweep' || action === 'dry_run') {
    const dryRun = action === 'dry_run';
    if (!dryRun) {
      if (!(await isAutoSweepEnabled(env))) return apiErr('自动归集未启用，请先到「系统设置」开启后重试');
      // 高危操作：真实广播需重新验证管理员密码（re-auth）
      if (!(await checkAdminPassword(env, String(body.password || '')))) return apiErr('请重新输入管理员密码以确认（re-auth）', 401);
      // 原子领取执行权，防与 cron 并发广播同一任务
      if (!(await claimSweep(env.DB, id))) return apiErr('任务正在被处理，或当前状态不可执行，请稍后重试');
    }
    const res: SweepResult = await trySweep(env, task, dryRun);
    const now = new Date().toISOString();

    if (dryRun || res.status === 'pending' || res.status === 'processing') {
      await env.DB.prepare(`UPDATE sweep_tasks SET note=?, lease_until=NULL, updated_at=? WHERE id=?`).bind(res.note || '', now, id).run();
    } else if (res.status === 'broadcasting') {
      await env.DB.prepare(`UPDATE sweep_tasks SET status='broadcasting', tx_hash=?, broadcast_at=?, lease_until=NULL, last_error='', note=?, updated_at=? WHERE id=?`)
        .bind(res.txID || '', now, res.note || '', now, id).run();
    } else if (res.status === 'completed') {
      await env.DB.prepare(`UPDATE sweep_tasks SET status='completed', tx_hash=?, confirmed_at=?, lease_until=NULL, note=?, updated_at=? WHERE id=?`)
        .bind(res.txID || '', now, res.note || '', now, id).run();
    } else if (res.status === 'failed_permanent') {
      await env.DB.prepare(`UPDATE sweep_tasks SET status='failed_permanent', lease_until=NULL, last_error=?, note=?, updated_at=? WHERE id=?`)
        .bind(res.note || '', res.note || '', now, id).run();
    } else {
      await env.DB.prepare(`UPDATE sweep_tasks SET status=?, lease_until=NULL, last_error=?, retry_count=retry_count+1, next_retry_at=?, note=?, updated_at=? WHERE id=?`)
        .bind(res.status, res.note || '', new Date(Date.now() + 60000).toISOString(), res.note || '', now, id).run();
    }
    await logAdminAction(env, `归集任务 #${id} ${dryRun ? '干跑' : '执行'} => ${res.status || res.note}`);
    return apiOk(res);
  }

  // update：人工编辑状态/交易哈希/备注（仅在提供时覆盖，避免清空已有备注）
  const fields: string[] = [];
  const values: any[] = [];
  if (body.status !== undefined && ['pending', 'submitted', 'completed', 'failed'].includes(body.status)) { fields.push('status=?'); values.push(body.status); }
  if (body.tx_hash !== undefined) { fields.push('tx_hash=?'); values.push(String(body.tx_hash)); }
  if (body.note !== undefined) { fields.push('note=?'); values.push(String(body.note)); }
  if (!fields.length) return apiErr('没有可更新字段');
  fields.push('updated_at=?'); values.push(new Date().toISOString());
  await env.DB.prepare(`UPDATE sweep_tasks SET ${fields.join(', ')} WHERE id=?`).bind(...values, id).run();
  await logAdminAction(env, `人工更新归集任务 #${id} (${body.status || '备注'})`);
  return apiOk({ ok: true });
};
