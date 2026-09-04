import type { OrderStatus } from '@/types';

// ============================================================
// 订单状态机：所有状态变更必须通过本模块，禁止各处直接 UPDATE status。
// 每个合法变更都写入 order_events 审计。
// ============================================================

export const ORDER_STATUSES: OrderStatus[] = [
  'pending', 'payment_detected', 'paid', 'fulfilling', 'shipped',
  'closed', 'refund_pending', 'refunded', 'manual_review',
];

// 允许的迁移矩阵
const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  pending: ['payment_detected', 'paid', 'closed'],
  payment_detected: ['paid', 'closed', 'manual_review'],
  paid: ['fulfilling', 'refund_pending', 'manual_review'],
  fulfilling: ['shipped', 'manual_review'],
  shipped: ['refund_pending'],
  closed: ['refund_pending'],
  refund_pending: ['refunded', 'manual_review'],
  refunded: [],
  manual_review: ['paid', 'shipped', 'closed', 'refund_pending'],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ALLOWED[from] || []).includes(to);
}

// 原子迁移：单条 D1 batch 内同时 UPDATE 订单状态 + 写审计（条件插入，仅当状态确实变更才记录）。
// 返回是否成功（changes===1）。不依赖事务外的反向 UPDATE。
export async function transitionOrder(
  db: D1Database,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  eventType: string,
  metadata = '',
): Promise<boolean> {
  if (!canTransition(from, to)) return false;
  const res = await db.batch([
    db.prepare('UPDATE orders SET status=? WHERE id=? AND status=?').bind(to, orderId, from),
    db.prepare(
      `INSERT INTO order_events (order_id, event_type, from_status, to_status, metadata)
       SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM orders WHERE id=? AND status=?)`,
    ).bind(orderId, eventType, from, to, metadata, orderId, to),
  ]);
  return (res[0]?.meta?.changes ?? 0) === 1;
}
