import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv, logAdminAction } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';
import { recalcProductStock } from '@/lib/db';

export const prerender = false;

// 卡密库：独立库存实体。product_id=0 表示"未分配"（卡密库），>0 表示已挂到某商品。
// 支持：创建、批量导入、列表/筛选/搜索、编辑、分配/回库、删除（仅未售）、未分配列表。

export const GET: APIRoute = async ({ request, locals, url }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const status = url.searchParams.get('status');
  const q = String(url.searchParams.get('q') || '').trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
  const hasPid = url.searchParams.has('product_id');
  const productId = Number(url.searchParams.get('product_id') || '0');

  const where: string[] = [];
  const binds: any[] = [];
  if (hasPid) { where.push('c.product_id=?'); binds.push(productId); }
  if (status === '0' || status === '1') { where.push('c.status=?'); binds.push(Number(status)); }
  if (q) { where.push('c.card LIKE ?'); binds.push('%' + q + '%'); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const { results } = await env.DB.prepare(
    `SELECT c.id, c.product_id, p.title AS product_title, c.card, c.status, c.order_id, c.sold_at, c.created_at
     FROM cards c LEFT JOIN products p ON p.id=c.product_id ${whereSql} ORDER BY c.id DESC LIMIT ?`,
  ).bind(...binds, limit).all();
  return apiOk(results || []);
};

export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');
  const db = env.DB;

  // 创建单条卡密（product_id=0 进卡密库，>0 直接挂商品）
  if (action === 'create') {
    const card = String(body.card || '').trim();
    if (!card) return apiErr('卡密内容为空');
    const productId = Number(body.product_id ?? 0);
    const res = await db.prepare('INSERT INTO cards (product_id, card) VALUES (?, ?)').bind(productId, card).run();
    await recalcProductStock(db, productId);
    await logAdminAction(env, `创建卡密 #${res.meta.last_row_id}`);
    return apiOk({ ok: true, id: res.meta.last_row_id });
  }

  // 批量导入（每行一条，product_id 可选）
  if (action === 'import') {
    const productId = Number(body.product_id ?? 0);
    const text = String(body.text || '').trim();
    if (!text) return apiErr('卡密内容为空');
    let keys = text.includes('\n') ? text.split(/\r?\n/) : text.split(/,|\||;/);
    keys = keys.map((k: string) => k.trim()).filter(Boolean);
    keys = [...new Set(keys)];
    if (!keys.length) return apiErr('未识别到卡密');
    const inserts = keys.map((k: string) => db.prepare('INSERT OR IGNORE INTO cards (product_id, card) VALUES (?, ?)').bind(productId, k));
    const CHUNK = 79; let imported = 0;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const r = await db.batch(inserts.slice(i, i + CHUNK));
      imported += r.filter((x: any) => (x.meta?.changes ?? 0) > 0).length;
    }
    await recalcProductStock(db, productId);
    await logAdminAction(env, `导入卡密 ${productId} 条=${imported} 跳过=${keys.length - imported}`);
    return apiOk({ count: imported, skipped: keys.length - imported });
  }

  // 编辑卡密内容
  if (action === 'update') {
    const id = Number(body.id); const card = String(body.card || '').trim();
    if (!id || !card) return apiErr('参数错误');
    await db.prepare('UPDATE cards SET card=? WHERE id=?').bind(card, id).run();
    await logAdminAction(env, `编辑卡密 #${id}`);
    return apiOk({ ok: true });
  }

  // 分配卡密到商品（status=0 才可分配）
  if (action === 'assign') {
    const ids = (body.ids || []).map(Number).filter(Boolean);
    const productId = Number(body.product_id ?? 0);
    if (!ids.length) return apiErr('请选择卡密');
    if (!productId) return apiErr('请选择目标商品');
    const ph = ids.map(() => '?').join(',');
    const run = await db.prepare(`UPDATE cards SET product_id=? WHERE id IN (${ph}) AND status=0`).bind(productId, ...ids).run();
    await recalcProductStock(db, productId);
    await logAdminAction(env, `分配 ${run.meta?.changes || 0} 张卡密 → 商品#${productId}`);
    return apiOk({ ok: true, changed: run.meta?.changes ?? 0 });
  }

  // 回库：把卡密从商品移回卡密库（未售）
  if (action === 'release') {
    const id = Number(body.id); if (!id) return apiErr('缺少卡密 ID');
    const row = await db.prepare('SELECT product_id FROM cards WHERE id=? AND status=0').bind(id).first<any>();
    if (!row) return apiErr('仅可回库未售卡密');
    await db.prepare('UPDATE cards SET product_id=0 WHERE id=?').bind(id).run();
    await recalcProductStock(db, Number(row.product_id));
    await logAdminAction(env, `卡密 #${id} 回库`);
    return apiOk({ ok: true });
  }

  // 删除（仅未售）
  if (action === 'delete' || (!action && body.id)) {
    const id = Number(body.id); if (!id) return apiErr('缺少卡密 ID');
    const run = await db.prepare('DELETE FROM cards WHERE id=? AND status=0').bind(id).run();
    if ((run.meta?.changes ?? 0) === 0) return apiErr('仅可删除未售出的卡密');
    await logAdminAction(env, `删除卡密 #${id}`);
    return apiOk({ ok: true });
  }

  return apiErr('未知操作');
};
