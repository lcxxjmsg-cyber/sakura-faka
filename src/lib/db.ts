import type { Product, Card, Order } from '@/types';
// ===== 价格工具：USDT 以最小单位整数存储 (1 USDT = 1e6) =====
const MULT = 1000000n;
export function parseUsdt(str: string): string {
  const s = String(str).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('无效的USDT金额');
  const [intPart, decPart = ''] = s.split('.');
  const decimals = decPart.slice(0, 6).padEnd(6, '0');
  const minUnit = BigInt(intPart) * MULT + BigInt(decimals);
  if (minUnit > 9007199254740991n || minUnit < 0n) throw new Error('无效的USDT金额');
  return minUnit.toString();
}

export function formatUsdt(minUnit: string): string {
  const v = BigInt(minUnit);
  const int = v / MULT;
  const dec = (v % MULT).toString().padStart(6, '0').slice(0, 2);
  return `${int}.${dec}`;
}

export function formatUsdtFull(minUnit: string): string {
  const v = BigInt(minUnit);
  const int = v / MULT;
  const dec = (v % MULT).toString().padStart(6, '0').replace(/0+$/, '');
  return dec ? `${int}.${dec}` : `${int}`;
}

// ===== 数据库访问工具 =====
export async function getProducts(db: D1Database): Promise<Product[]> {
  const { results } = await db
    .prepare('SELECT * FROM products WHERE status=1 ORDER BY sort DESC, id DESC')
    .all<Product>();
  return results || [];
}

export async function getProduct(db: D1Database, id: number): Promise<Product | null> {
  const p = await db.prepare('SELECT * FROM products WHERE id=?').bind(id).first<Product>();
  return p ?? null;
}

export async function getAvailableCards(db: D1Database, productId: number): Promise<Card[]> {
  const { results } = await db
    .prepare('SELECT * FROM cards WHERE product_id=? AND status=0 ORDER BY id ASC')
    .bind(productId)
    .all<Card>();
  return results || [];
}

// ===== 订单操作 =====
export async function getOrder(db: D1Database, id: string): Promise<Order | null> {
  const o = await db.prepare('SELECT * FROM orders WHERE id=?').bind(id).first<Order>();
  return o ?? null;
}

// 读取订单关联卡密（优先 order_cards，老数据回退 orders.card_ids）
export async function getOrderCards(db: D1Database, orderId: string): Promise<Card[]> {
  const { results } = await db.prepare(
    `SELECT c.* FROM order_cards oc JOIN cards c ON c.id=oc.card_id WHERE oc.order_id=? ORDER BY oc.id ASC`,
  ).bind(orderId).all<Card>();
  if (results && results.length) return results;
  const order = await getOrder(db, orderId);
  if (order?.card_ids) {
    const ids = order.card_ids.split(',').map(Number).filter(Boolean);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      const r = await db.prepare(`SELECT * FROM cards WHERE id IN (${ph})`).bind(...ids).all<Card>();
      return r.results || [];
    }
  }
  return [];
}

// 写入订单-卡密关联
export async function linkOrderCards(db: D1Database, orderId: string, cardIds: number[]): Promise<void> {
  for (const cid of cardIds) {
    await db.prepare('INSERT OR IGNORE INTO order_cards (order_id, card_id) VALUES (?,?)').bind(orderId, cid).run();
  }
}

export async function getOrders(db: D1Database, limit = 100): Promise<Order[]> {
  const { results } = await db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all<Order>();
  return results || [];
}

// ===== 数字工具 =====
export function randId(len = 16): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
  return s;
}
