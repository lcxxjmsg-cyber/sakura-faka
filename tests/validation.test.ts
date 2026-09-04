import { describe, it, expect } from 'vitest';
import { validateOrderQty, MAX_ORDER_QTY } from '@/lib/validation';
import { parseUsdt, formatUsdt, formatUsdtFull } from '@/lib/db';

describe('validateOrderQty', () => {
  it('accepts integers within range', () => {
    expect(validateOrderQty(1)).toBe(1);
    expect(validateOrderQty(10)).toBe(10);
    expect(validateOrderQty('3')).toBe(3);
  });
  it('rejects out-of-range', () => {
    expect(validateOrderQty(0)).toBeNull();
    expect(validateOrderQty(11)).toBeNull();
    expect(validateOrderQty(-2)).toBeNull();
  });
  it('rejects non-integer / NaN / Infinity / garbage', () => {
    expect(validateOrderQty(1.5)).toBeNull();
    expect(validateOrderQty(1.1)).toBeNull();
    expect(validateOrderQty(NaN)).toBeNull();
    expect(validateOrderQty(Infinity)).toBeNull();
    expect(validateOrderQty('abc')).toBeNull();
    expect(validateOrderQty('')).toBeNull();
    expect(validateOrderQty(null)).toBeNull();
    expect(validateOrderQty(undefined)).toBeNull();
  });
  it('exposes MAX_ORDER_QTY', () => {
    expect(MAX_ORDER_QTY).toBe(10);
  });
});

describe('USDT price format', () => {
  it('parseUsdt to min-unit', () => {
    expect(parseUsdt('9.99')).toBe('9990000');
    expect(parseUsdt('1')).toBe('1000000');
    expect(parseUsdt('0.01')).toBe('10000');
  });
  it('formatUsdt', () => {
    expect(formatUsdt('9990000')).toBe('9.99');
    expect(formatUsdt('10000')).toBe('0.01');
  });
  it('formatUsdtFull trims trailing zeros', () => {
    expect(formatUsdtFull('1000000')).toBe('1');
    expect(formatUsdtFull('1500000')).toBe('1.5');
  });
});
