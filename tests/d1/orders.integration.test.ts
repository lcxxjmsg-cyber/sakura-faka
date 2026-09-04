import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { D1Mem } from './d1mem';
import { fulfillOrder } from '@/lib/orders';
import { recalcProductStock } from '@/lib/db';
import type { StoreEnv, Order } from '@/types';

let db: D1Mem;
let env: StoreEnv;

const MASTER = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let seq = 0;
function order(over: Partial<Order> = {}): Order {
  const n = ++seq;
  return {
    id: 'o_' + n, product_id: 1, product_title: 'P1', qty: 1,
    total_price: '1000000', address: 'TAddr' + n, address_index: 0,
    status: 'paid', tx_hash: 'tx_' + n, tx_confirm: 19, contact_email: '', view_token: 'v', card_ids: '',
    created_at: new Date().toISOString(), paid_at: new Date().toISOString(), expired_at: null, email_sent_at: null,
    ...over,
  };
}

async function seedProduct(stock: number, id = 1) {
  await db.prepare('INSERT OR REPLACE INTO products (id,title,price,stock,sold,category,status,sort) VALUES (?,?,?,?,0,\'t\',1,0)').bind(id, 'P' + id, '1000000', stock).run();
}

async function seedCards(productId: number, n: number) {
  const stmts: any[] = [];
  for (let i = 0; i < n; i++) stmts.push(db.prepare('INSERT INTO cards (product_id, card) VALUES (?, ?)').bind(productId, 'CARD-' + productId + '-' + i));
  await db.batch(stmts);
}

async function insertOrder(o: Order) {
  await db.prepare('INSERT INTO orders (id, product_id, product_title, qty, total_price, address, address_index, status, tx_hash, tx_confirm, contact_email, view_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(o.id, o.product_id, o.product_title, o.qty, o.total_price, o.address, 0, o.status, o.tx_hash, o.tx_confirm, o.contact_email, o.view_token, o.created_at).run();
}

async function prodRow(id = 1) {
  return db.prepare('SELECT stock, sold FROM products WHERE id=?').bind(id).first<any>();
}
async function orderRow(id: string) {
  return db.prepare('SELECT status, card_ids FROM orders WHERE id=?').bind(id).first<any>();
}
async function usedCards(orderId: string) {
  return db.prepare('SELECT COUNT(*) AS c FROM cards WHERE order_id=? AND status=1').bind(orderId).first<{ c: number }>();
}
async function linkCount(orderId: string) {
  return db.prepare('SELECT COUNT(*) AS c FROM order_cards WHERE order_id=?').bind(orderId).first<{ c: number }>();
}

beforeAll(async () => {
  db = new D1Mem();
  const schema = readFileSync('schema.sql', 'utf8');
  await db.exec(schema);
  env = { DB: db as any, TRON_MASTER_ADDRESS: MASTER } as any;
});

describe('fulfillOrder atomic settle', () => {
  it('shipped once, stock/sold/cards/order_cards consistent', async () => {
    await seedProduct(3);
    await seedCards(1, 3);
    const o = order();
    await db.prepare('INSERT INTO orders (id, product_id, product_title, qty, total_price, address, address_index, status, tx_hash, tx_confirm, contact_email, view_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(o.id, 1, o.product_title, o.qty, o.total_price, o.address, 0, 'paid', o.tx_hash, 19, '', 'v', o.created_at).run();

    expect(await fulfillOrder(env, o, o.tx_hash, 19)).toBe(true);

    const p = await prodRow(1);
    expect(p.stock).toBe(2);
    expect(p.sold).toBe(1);
    const ord = await orderRow(o.id);
    expect(ord.status).toBe('shipped');
    expect(await usedCards(o.id)).toMatchObject({ c: 1 });
    expect(await linkCount(o.id)).toMatchObject({ c: 1 });
  });

  it('two concurrent fulfillOrder on the SAME order -> settled exactly once', async () => {
    await seedProduct(3, 2);
    await seedCards(2, 3);
    const o = order({ id: 'dup1', product_id: 2 });
    await db.prepare('INSERT INTO orders (id, product_id, product_title, qty, total_price, address, address_index, status, tx_hash, tx_confirm, contact_email, view_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(o.id, 2, o.product_title, o.qty, o.total_price, o.address, 0, 'paid', o.tx_hash, 19, '', 'v', o.created_at).run();

    const results = await Promise.all([fulfillOrder(env, o, o.tx_hash, 19), fulfillOrder(env, o, o.tx_hash, 19)]);
    const wins = results.filter(Boolean).length;
    expect(wins).toBe(1);

    const ord = await orderRow(o.id);
    expect(ord.status).toBe('shipped');
    const p = await prodRow(2);
    expect(p.stock).toBe(2); // 只扣一次
    expect(p.sold).toBe(1);
    expect(await usedCards(o.id)).toMatchObject({ c: 1 });
  });

  it('two DIFFERENT orders fight for last single card -> one shipped, one manual_review, no stock drift', async () => {
    await seedProduct(1, 3);
    await seedCards(3, 1); // 只有一张卡
    const o1 = order({ id: 'fight1', product_id: 3 });
    const o2 = order({ id: 'fight2', product_id: 3 });
    for (const o of [o1, o2]) {
      await db.prepare('INSERT INTO orders (id, product_id, product_title, qty, total_price, address, address_index, status, tx_hash, tx_confirm, contact_email, view_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(o.id, 3, o.product_title, o.qty, o.total_price, o.address, 0, 'paid', o.tx_hash, 19, '', 'v', o.created_at).run();
    }

    const [r1, r2] = await Promise.all([fulfillOrder(env, o1, o1.tx_hash, 19), fulfillOrder(env, o2, o2.tx_hash, 19)]);
    const shippedCount = [r1, r2].filter(Boolean).length;
    expect(shippedCount).toBe(1);

    const p = await prodRow(3);
    expect(p.stock).toBe(0); // 唯一一张卡被占用
    expect(p.sold).toBe(1);  // 只一个订单加销量
    const statuses = await Promise.all([orderRow(o1.id), orderRow(o2.id)]);
    const shipped = statuses.find((s) => s.status === 'shipped');
    const manual = statuses.find((s) => s.status === 'manual_review');
    expect(shipped).toBeTruthy();
    expect(manual).toBeTruthy();
  });

  it('insufficient stock -> manual_review, stock unchanged, cards still available', async () => {
    await seedProduct(2, 4);
    await seedCards(4, 1); // 只有一张，订单要 3
    const o = order({ id: 'insuf', product_id: 4, qty: 3 });
    await db.prepare('INSERT INTO orders (id, product_id, product_title, qty, total_price, address, address_index, status, tx_hash, tx_confirm, contact_email, view_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(o.id, 4, o.product_title, o.qty, o.total_price, o.address, 0, 'paid', o.tx_hash, 19, '', 'v', o.created_at).run();

    expect(await fulfillOrder(env, o, o.tx_hash, 19)).toBe(false);
    const p = await prodRow(4);
    expect(p.stock).toBe(2); // 未扣库存（seedProduct 设置为 2，未改动）
    expect(p.sold).toBe(0);
    const ord = await orderRow(o.id);
    expect(ord.status).toBe('manual_review');
    expect(await usedCards(o.id)).toMatchObject({ c: 0 }); // 不应占用
  });

  it('re-fulfill a shipped order is a no-op (no double stock/sold)', async () => {
    await seedProduct(2, 5);
    await seedCards(5, 2);
    const o = order({ id: 'refill', product_id: 5 });
    await db.prepare('INSERT INTO orders (id, product_id, product_title, qty, total_price, address, address_index, status, tx_hash, tx_confirm, contact_email, view_token, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(o.id, 5, o.product_title, o.qty, o.total_price, o.address, 0, 'paid', o.tx_hash, 19, '', 'v', o.created_at).run();

    expect(await fulfillOrder(env, o, o.tx_hash, 19)).toBe(true);
    expect(await fulfillOrder(env, o, o.tx_hash, 19)).toBe(false); // 再发货无效
    const p = await prodRow(5);
    expect(p.stock).toBe(1);
    expect(p.sold).toBe(1);
  });
});

describe('inventory recalc', () => {
  it('recalcProductStock mirrors available cards', async () => {
    await seedProduct(2, 6);
    await seedCards(6, 4);
    await recalcProductStock(db, 6);
    const p = await prodRow(6);
    expect(p.stock).toBe(4);
  });
});
