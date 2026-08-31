import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

// 批量导入卡密：body = { product_id, text }
// text 支持一行一个卡密，或 ",", "|", 空格 分隔
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const body = await request.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const text = String(body.text || '').trim();
  if (!productId) return apiErr('参数错误');
  if (!text) return apiErr('卡密内容为空');

  // 拆分：优先按换行；若无换行则按逗号/竖线/分号。避免 \s+ 切断含空格的卡密
  let keys: string[];
  if (text.includes('\n')) {
    keys = text.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
  } else {
    keys = text.split(/,|\||;/).map((s: string) => s.trim()).filter(Boolean);
  }
  keys = [...new Set(keys)]; // 去重
  if (!keys.length) return apiErr('未识别到卡密');

  // 分批插入 + 追加库存（D1 batch 单次 ≤ 100 条，留 1 条给库存更新故每批 ≤ 79 条）
  const inserts = keys.map((key: string) =>
    env.DB.prepare('INSERT OR IGNORE INTO cards (product_id, card) VALUES (?, ?)').bind(productId, key),
  );
  const CHUNK = 79;
  let imported = 0;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const result = await env.DB.batch(inserts.slice(i, i + CHUNK));
    imported += result.filter((x: any) => (x.meta?.changes ?? 0) > 0).length;
  }
  await env.DB.prepare('UPDATE products SET stock=(SELECT COUNT(*) FROM cards WHERE product_id=? AND status=0), updated_at=? WHERE id=?')
    .bind(productId, new Date().toISOString(), productId).run();

  return apiOk({ count: imported, skipped: keys.length - imported });
};
