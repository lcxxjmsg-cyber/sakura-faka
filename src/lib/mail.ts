import type { StoreEnv, Order } from '@/types';

export async function sendDeliveryEmail(env: StoreEnv, order: Order, resources: string[]): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !order.contact_email) return false;
  const text = [`订单 ${order.id} 已完成支付并自动发货。`, `商品：${order.product_title}`, '', ...resources.map((value, index) => `${index + 1}. ${value}`)].join('\n');
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [order.contact_email], subject: `订单 ${order.id} 发货通知`, text }),
    });
    return response.ok;
  } catch { return false; }
}
