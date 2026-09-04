import type { StoreEnv, Order } from '@/types';

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// 发送发货通知邮件（HTML）。仅当已配置 RESEND_API_KEY / MAIL_FROM / 买家邮箱时才会发送。
export async function sendDeliveryEmail(env: StoreEnv, order: Order, resources: string[]): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !order.contact_email) return false;
  const siteName = env.SITE_NAME || '樱花市集';

  const resourceHtml = resources
    .map((value, index) => {
      const isJson = /^\s*[{[]/.test(value);
      const body = isJson
        ? `<pre style="padding:10px 14px;background:#0f172a;border-radius:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#e2e8f0;overflow:auto;margin:8px 0;">${esc(value)}</pre>`
        : `<div style="padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#334155;word-break:break-all;margin:8px 0;">${esc(value)}</div>`;
      return `<p style="margin:6px 0;"><b style="color:#334155;">资源 #${index + 1}</b><br/>${body}</p>`;
    })
    .join('');

  const html = `<!doctype html><html><body style="margin:0;background:#fdf2f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:linear-gradient(135deg,#fda4af,#f472b6);border-radius:16px;padding:28px;text-align:center;color:#fff;">
      <div style="font-size:36px;">🌸</div>
      <h1 style="margin:8px 0 4px;font-size:20px;">${esc(siteName)}</h1>
      <p style="margin:0;opacity:.9">支付成功 · 自动发货</p>
    </div>
    <div style="background:#fff;border-radius:0 0 16px 16px;padding:24px;">
      <p style="margin:4px 0;">你好，</p>
      <p style="margin:4px 0;">订单 <b style="color:#be123c;">${esc(order.id)}</b> 已完成支付，以下为您的资源：</p>
      <div style="background:#fff5f7;border:1px solid #fecdd3;border-radius:10px;padding:12px 16px;margin:12px 0;">
        <span style="font-size:13px;color:#9f1239;">${esc(order.product_title)}</span> · 数量 ${order.qty}
      </div>
      ${resourceHtml}
      <p style="margin:16px 0 0;font-size:13px;color:#64748b;">如果这是您的订单请妥善保存；如有疑问请联系站长。</p>
    </div>
  </div>
</body></html>`;

  const text = [
    `订单 ${order.id} 已完成支付并自动发货。`,
    `商品：${order.product_title}（数量 ${order.qty}）`,
    '',
    ...resources.map((value, index) => `${index + 1}. ${value}`),
  ].join('\n');

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [order.contact_email], subject: `【${siteName}】订单 ${order.id} 发货通知`, html, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
