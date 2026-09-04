import { describe, it, expect } from 'vitest';
import { canTransition, ORDER_STATUSES } from '@/domain/order/order.state';

describe('order state machine', () => {
  it('has all required statuses', () => {
    expect(ORDER_STATUSES).toEqual([
      'pending', 'payment_detected', 'paid', 'fulfilling', 'shipped',
      'closed', 'refund_pending', 'refunded', 'manual_review',
    ]);
  });

  it('allows forward payment/cancel transitions', () => {
    expect(canTransition('pending', 'payment_detected')).toBe(true);
    expect(canTransition('payment_detected', 'paid')).toBe(true);
    expect(canTransition('paid', 'fulfilling')).toBe(true);
    expect(canTransition('fulfilling', 'shipped')).toBe(true);
    expect(canTransition('pending', 'closed')).toBe(true);
  });

  it('blocks illegal transitions', () => {
    expect(canTransition('pending', 'shipped')).toBe(false);
    expect(canTransition('pending', 'fulfilling')).toBe(false);
    expect(canTransition('pending', 'refunded')).toBe(false);
    expect(canTransition('paid', 'closed')).toBe(false);
    expect(canTransition('shipped', 'payment_detected')).toBe(false);
    expect(canTransition('refunded', 'pending')).toBe(false);
  });

  it('guards against double-fulfillment (paid can only go to fulfilling once)', () => {
    // 状态机只允许 paid -> fulfilling；一旦 fulfilling 就不能再回 paid
    expect(canTransition('paid', 'fulfilling')).toBe(true);
    expect(canTransition('fulfilling', 'fulfilling')).toBe(false);
    expect(canTransition('fulfilling', 'paid')).toBe(false);
  });

  it('lets manual_review be re-routed by an admin', () => {
    expect(canTransition('manual_review', 'paid')).toBe(true);
    expect(canTransition('manual_review', 'shipped')).toBe(true);
    expect(canTransition('manual_review', 'closed')).toBe(true);
  });
});
