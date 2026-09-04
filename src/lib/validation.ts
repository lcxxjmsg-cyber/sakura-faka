export const MAX_ORDER_QTY = 10;
export const MIN_ORDER_QTY = 1;

// 严格数量校验：拒绝 1.1 / 1.9 / NaN / Infinity / 字符串垃圾。返回合法整数或 null。
export function validateOrderQty(raw: unknown): number | null {
  const qty = Number(raw);
  if (!Number.isSafeInteger(qty) || qty < MIN_ORDER_QTY || qty > MAX_ORDER_QTY) return null;
  return qty;
}
