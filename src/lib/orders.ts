import type { StoreEnv, Order } from '@/types';
import { getProduct, getOrder, randId } from '@/lib/db';
import { deriveTronAddress } from '@/lib/tron';
import { checkUsdtPayment } from '@/lib/tron';
const ORDER_TTL_SECONDS = 30 * 60; // 30分钟未支付关闭

// ============================================================
// 下单：创建订单，分配唯一子地址
// ============================================================
export async function createOrder(
  env: StoreEnv,
  productId: number,
  qty: number,
  contactEmail = '',
): Promise<{ ok: true; order: Order } | { ok: false; error: string }> {
  const db = env.DB;
  const product = await getProduct(db, productId);
  if (!product) return { ok: false, error: '商品不存在' };
  if (product.status !== 1) return { ok: false, error: '商品已下架' };
  // 强制整数数量，避免 BigInt(5.5) 崩溃
  if (!Number.isInteger(qty) || qty < 1 || qty > 10) return { ok: false, error: '数量需为1-10的整数' };

  const cardCount = await db
    .prepare('SELECT COUNT(*) AS c FROM cards WHERE product_id=? AND status=0')
    .bind(productId)
    .first<{ c: number }>();
  if (!cardCount || cardCount.c < qty) return { ok: false, error: '库存不足' };

  const totalPrice = (BigInt(product.price) * BigInt(qty)).toString();

  // 从已用最大 index 之后开始寻找未占用子地址（避免 O(N²) 全表扫描）
  let address = '';
  const maxUsed = await db
    .prepare('SELECT MAX(last_index) AS m FROM orders_index')
    .first<{ m: number | null }>();
  let index = (maxUsed?.m ?? -1) + 1;
  const MAX_INDEX = 1000000;
  for (let i = index; i < MAX_INDEX; i++) {
    const candidate = deriveTronAddress(env.TRON_MNEMONIC, i);
    if (!candidate) return { ok: false, error: '钱包派生失败' };
    // 检查该地址是否已存在于订单表（兜底防冲突）
    const exists = await db
      .prepare('SELECT 1 FROM orders WHERE address=? LIMIT 1')
      .bind(candidate)
      .first();
    if (!exists) {
      address = candidate;
      index = i;
      break;
    }
  }
  if (!address) return { ok: false, error: '地址池已满，请联系站长' };

  const orderId = randId(14);
  const viewToken = crypto.randomUUID().replace(/-/g, '');
  const now = new Date();
  const expiredAt = new Date(now.getTime() + ORDER_TTL_SECONDS * 1000);

  await db
    .prepare(
      `INSERT INTO orders (id, product_id, product_title, qty, total_price, address, status, contact_email, view_token, created_at, expired_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      orderId,
      product.id,
      product.title,
      qty,
      totalPrice,
      address,
      contactEmail,
      viewToken,
      now.toISOString(),
      expiredAt.toISOString(),
    )
    .run();

  const order = await getOrder(db, orderId);
  if (!order) return { ok: false, error: '订单创建失败' };
  // 记录已使用的地址 index，加速下次分配
  await db
    .prepare('INSERT OR REPLACE INTO orders_index (id, last_index) VALUES (1, ?)')
    .bind(index)
    .run();
  return { ok: true, order };
}

// ============================================================
// 查单：查询某个订单当前状态
// ============================================================
export async function queryOrder(env: StoreEnv, orderId: string): Promise<Order | null> {
  return getOrder(env.DB, orderId);
}

export async function cancelOrder(env: StoreEnv, orderId: string): Promise<{ ok: boolean; error?: string }> {
  const result = await env.DB.prepare(
    `UPDATE orders SET status='closed', expired_at=? WHERE id=? AND status='pending'`,
  ).bind(new Date().toISOString(), orderId).run();
  return (result.meta?.changes ?? 0) > 0
    ? { ok: true }
    : { ok: false, error: '订单不存在、已支付或已关闭' };
}

export async function checkOrderPayment(env: StoreEnv, orderId: string): Promise<{ ok: boolean; status?: string; confirmations?: number; error?: string }> {
  const order = await getOrder(env.DB, orderId);
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.status === 'shipped' || order.status === 'closed') return { ok: true, status: order.status, confirmations: order.tx_confirm };
  if (order.status === 'paid') {
    const shipped = await fulfillOrder(env, order, order.tx_hash, order.tx_confirm);
    return shipped ? { ok: true, status: 'shipped', confirmations: order.tx_confirm } : { ok: false, status: 'paid', confirmations: order.tx_confirm, error: '已支付但库存不足，等待后台处理' };
  }
  if (order.expired_at && new Date(order.expired_at).getTime() < Date.now()) {
    await env.DB.prepare(`UPDATE orders SET status='closed' WHERE id=? AND status='pending'`).bind(order.id).run();
    return { ok: true, status: 'closed', error: '订单已过期' };
  }
  const check = await checkUsdtPayment(env.TRON_RPC_URL, order.address, order.total_price, Number(env.TRON_CONFIRMATIONS || '1'), order.created_at);
  if (!check.found) return { ok: true, status: 'pending', confirmations: 0 };
  if (!check.confirmed) {
    await env.DB.prepare(`UPDATE orders SET tx_hash=?, tx_confirm=? WHERE id=? AND status='pending'`).bind(check.txHash, check.confirmations, order.id).run();
    return { ok: true, status: 'paid', confirmations: check.confirmations };
  }
  const shipped = await fulfillOrder(env, order, check.txHash, check.confirmations);
  return shipped ? { ok: true, status: 'shipped', confirmations: check.confirmations } : { ok: false, status: 'paid', confirmations: check.confirmations, error: '支付已确认，但库存不足' };
}

// ============================================================
// 支付确认 + 自动发货
// 在 Worker 定时任务中轮询所有 pending 订单
// ============================================================
export async function processPendingOrders(env: StoreEnv): Promise<number> {
  const db = env.DB;
  const minConfirm = Number(env.TRON_CONFIRMATIONS || '1');
  const rpcUrl = env.TRON_RPC_URL;

  // 同时处理 pending（待确认）与 paid（已付但缺卡待补发）
  const { results } = await db
    .prepare(`SELECT * FROM orders WHERE status IN ('pending','paid')`)
    .all<Order>();
  const pending = results || [];

  let processed = 0;
  for (const order of pending) {
    // 已标记 paid 的订单说明是缺卡补发场景，直接尝试补卡，不再查链
    if (order.status === 'paid') {
      const shipped = await fulfillOrder(env, order, order.tx_hash, order.tx_confirm);
      if (shipped) processed++;
      continue;
    }

    // 超时关闭
    if (order.expired_at && new Date(order.expired_at).getTime() < Date.now()) {
      await db.prepare(`UPDATE orders SET status='closed' WHERE id=? AND status='pending'`).bind(order.id).run();
      continue;
    }

    const check = await checkUsdtPayment(rpcUrl, order.address, order.total_price, minConfirm, order.created_at);
    if (check.found && check.confirmed) {
      // 先占用卡密并发货
      const shipped = await fulfillOrder(env, order, check.txHash, check.confirmations);
      if (shipped) processed++;
    } else if (check.found) {
      // 已支付但确认数不足，记录确认数
      await db
        .prepare(`UPDATE orders SET tx_hash=?, tx_confirm=? WHERE id=?`)
        .bind(check.txHash, check.confirmations, order.id)
        .run();
    }
  }
  return processed;
}

// ============================================================
// 发货：占用卡密，写回订单商品卡片，标记已发货
// ============================================================
export async function fulfillOrder(
  env: StoreEnv,
  order: Order,
  txHash: string,
  confirmations: number,
): Promise<boolean> {
  const db = env.DB;

  // 领取足够数量的未售卡密（拿到就标记已售，防止并发重复）
  const { results } = await db
    .prepare(`SELECT id FROM cards WHERE product_id=? AND status=0 ORDER BY id ASC LIMIT ?`)
    .bind(order.product_id, order.qty)
    .all<{ id: number }>();
  const cards = results || [];
  if (cards.length < order.qty) {
    // 卡不够，先标支付成功但标记需要人工
    await db
      .prepare(`UPDATE orders SET status='paid', tx_hash=?, tx_confirm=? WHERE id=?`)
      .bind(txHash, confirmations, order.id)
      .run();
    return false;
  }

  const cardIds = cards.map((c: any) => c.id);
  const idList = cardIds.join(',');

  // 原子占用卡密：用 status=0 条件保证不会被并发重复占用
  const placeholders = cardIds.map(() => '?').join(',');
  const cardStmt = db.prepare(
    `UPDATE cards SET status=1, order_id=?, sold_at=? WHERE id IN (${placeholders}) AND status=0`,
  );
  const updResult = await cardStmt.bind(order.id, new Date().toISOString(), ...cardIds).run();
  // 实际占用不足，说明有卡被并发抢走，本次放弃（避免重复发同一张卡）
  if ((updResult.meta?.changes ?? 0) < cardIds.length) {
    // 并发抢卡时可能只占到一部分，必须释放本次已占用的卡，避免库存泄漏。
    await db.prepare(`UPDATE cards SET status=0, order_id=NULL, sold_at=NULL WHERE order_id=? AND status=1`).bind(order.id).run();
    return false;
  }

  let shippedOk = false;
  try {
    await db.batch([
      db.prepare(`UPDATE products SET sold=sold+?, stock=MAX(stock-?, 0), updated_at=? WHERE id=?`)
        .bind(order.qty, order.qty, new Date().toISOString(), order.product_id),
      db.prepare(
        `UPDATE orders SET status='shipped', tx_hash=?, tx_confirm=?, card_ids=?, paid_at=?, expired_at=NULL WHERE id=? AND status IN ('pending','paid')`,
      ).bind(txHash, confirmations, idList, new Date().toISOString(), order.id),
    ]);
    shippedOk = true;
  } catch {
    // 订单写入失败时回滚本次已占用资源，避免出现“库存减少但订单未发货”。
    await db.prepare(`UPDATE cards SET status=0, order_id=NULL, sold_at=NULL WHERE order_id=? AND status=1`).bind(order.id).run();
    shippedOk = false;
  }
  return shippedOk;
}

// ============================================================
// 后台：手动补发（某订单支付成功但没发出卡）
// ============================================================
export async function manualFulfill(env: StoreEnv, orderId: string): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrder(env.DB, orderId);
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.status === 'shipped' || order.status === 'pending') {
    return { ok: false, error: '该订单无需补发' };
  }
  const ok = await fulfillOrder(env, order, order.tx_hash, order.tx_confirm);
  return ok ? { ok: true } : { ok: false, error: '库存不足，无法补发' };
}
