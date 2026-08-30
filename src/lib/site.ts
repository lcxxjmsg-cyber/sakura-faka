export async function getSiteConfig(runtime: any) {
  const env = runtime?.env;
  return {
    name: env?.SITE_NAME || '樱花市集',
    welcome: env?.SITE_WELCOME || '欢迎来到二次元自助服务商店',
  };
}
