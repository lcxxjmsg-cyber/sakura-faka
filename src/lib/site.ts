import type { StoreEnv } from '@/types';
import { configOr } from '@/lib/config';

export async function getSiteConfig(runtime: any) {
  const env = runtime?.env as StoreEnv | undefined;
  const name = await configOr(env as StoreEnv, 'site_name', env?.SITE_NAME, '樱花市集');
  const welcome = await configOr(env as StoreEnv, 'site_welcome', env?.SITE_WELCOME, '欢迎来到二次元自助服务商店');
  return { name, welcome };
}
