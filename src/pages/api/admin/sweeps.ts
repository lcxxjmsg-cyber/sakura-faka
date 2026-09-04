import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { trySweep, type SweepTask, type SweepResult } from '@/lib/tron-sweep';

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
    if (!dryRun && env.AUTO_SWEEP_ENABLED !== 'true') return apiErr('自动归集未启用，请先设置 AUTO_SWEEP_ENABLED=true 后重试');
    const res: SweepResult = await trySweep(env, task, dryRun);
    if (res.status === 'completed') {
      await env.DB.prepare(`UPDATE sweep_tasks SET status='completed', tx_hash=?, amount=?, note=?, updated_at=? WHERE id=?`)
        .bind(res.txID || '', res.amount || task.amount, res.note || '', new Date().toISOString(), id).run();
    } else if (res.ok && dryRun) {
      // 干跑成功：仅记录信息，不改变任务状态，写入临时说明
      await env.DB.prepare(`UPDATE sweep_tasks SET note=?, updated_at=? WHERE id=?`)
        .bind(res.note || '', new Date().toISOString(), id).run();
    } else if (!res.ok) {
      await env.DB.prepare(`UPDATE sweep_tasks SET status='failed', note=?, tx_hash=COALESCE(?, tx_hash), updated_at=? WHERE id=?`)
        .bind(res.note || '失败', res.txID || '', new Date().toISOString(), id).run();
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
