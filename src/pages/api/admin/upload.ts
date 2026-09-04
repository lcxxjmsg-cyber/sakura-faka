import type { APIRoute } from 'astro';
import { apiOk, apiErr, getEnv } from '@/lib/api';
import { requireAdmin } from '@/lib/adminAuth';

export const prerender = false;

const SIZE_LIMIT = 1.5 * 1024 * 1024;
const MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// 商品图上传：存储到 KV，返回访问路径 /api/image/<id>
export const POST: APIRoute = async ({ request, locals }: any) => {
  const env = getEnv(locals?.runtime);
  if (!env) return apiErr('服务器配置错误', 500);
  if (!(await requireAdmin(request, env))) return apiErr('未授权', 401);

  const fd = await request.formData().catch(() => null);
  const file = fd?.get('file');
  if (!(file instanceof File)) return apiErr('没有选择图片');
  if (!MIME.includes(file.type)) return apiErr('仅支持 JPG / PNG / WebP / GIF');
  if (file.size > SIZE_LIMIT) return apiErr('图片不能超过 1.5MB，请压缩后重试');

  const buf = await file.arrayBuffer();
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.KV.put('img:' + id, buf, { metadata: { type: file.type } });
  return apiOk({ url: '/api/image/' + id });
};
