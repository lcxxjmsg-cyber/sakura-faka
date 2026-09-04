import type { StoreEnv, Order } from '@/types';
import { getProduct, getOrder, getOrderCards, linkOrderCards, randId } from '@/lib/db';
import { deriveTronAddress } from '@/lib/tron';
import { sendDeliveryEmail } from '@/lib/mail';
import { getWalletMnemonic, getMasterAddress } from '@/lib/wallet';
import { transitionOrder } from '@/domain/order/order.state';
import { getTronProvider } from '@/domain/payment/tron.provider';
import { checkOrderPaymentOnChain } from '@/domain/payment/payment.service';
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

  const mnemonic = await getWalletMnemonic(env);
  if (!mnemonic) return { ok: false, error: '收款钱包未初始化，请联系站长或前往后台「钱包设置」一键生成' };

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
    const candidate = deriveTronAddress(mnemonic, i);
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
      `INSERT INTO orders (id, product_id, product_title, qty, total_price, address, address_index, status, contact_email, view_token, created_at, expired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      orderId,
      product.id,
      product.title,
      qty,
      totalPrice,
      address,
      index,
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

async function recordPaymentEvent(db: D1Database, orderId: string, event: { tx_hash?: string; event_type: string; confirmations?: number; amount?: string; metadata?: string }): Promise<void> {
  try {
    await db.prepare('INSERT INTO payment_events (order_id, tx_hash, event_type, confirmations, amount, metadata) VALUES (?,?,?,?,?,?)')
      .bind(orderId, event.tx_hash || '', event.event_type, event.confirmations ?? 0, event.amount || '0', event.metadata || '').run();
  } catch { /* 审计失败不阻塞主流程 */ }
}

// ============================================================
// 查单：查询某个订单当前状态
// ============================================================
export async function queryOrder(env: StoreEnv, orderId: string): Promise<Order | null> {
  return getOrder(env.DB, orderId);
}

// 取消未支付订单（仅 pending 可取消）
export async function cancelOrder(env: StoreEnv, orderId: string, viewToken?: string): Promise<{ ok: boolean; error?: string }> {
  if (viewToken) {
    const order = await getOrder(env.DB, orderId);
    if (!order || order.view_token !== viewToken) return { ok: false, error: '无权操作此订单' };
  }
  const ok = await transitionOrder(env.DB, orderId, 'pending', 'closed', 'user_cancel', '用户取消');
  return ok ? { ok: true } : { ok: false, error: '订单不存在、已支付或已关闭' };
}

// ============================================================
// 支付检测 + 状态推进（幂等，可由 cron / 用户轮询 / 后台 并发调用）
// ============================================================
export async function checkOrderPayment(env: StoreEnv, orderId: string, viewToken?: string): Promise<{ ok: boolean; status?: string; confirmations?: number; error?: string; retry?: boolean }> {
  const db = env.DB;
  const order = await getOrder(db, orderId);
  if (!order) return { ok: false, error: '订单不存在' };
  if (viewToken && order.view_token !== viewToken) return { ok: false, error: '无权操作此订单' };

  // 终态/进行中：不重复处理
  if (order.status === 'shipped' || order.status === 'closed' || order.status === 'refund_pending' || order.status === 'refunded') {
    return { ok: true, status: order.status, confirmations: order.tx_confirm };
  }
  if (order.status === 'manual_review') return { ok: true, status: 'manual_review', confirmations: order.tx_confirm };
  if (order.status === 'fulfilling') return { ok: true, status: 'fulfilling', confirmations: order.tx_confirm };

  // 已确认支付：推进发货
  if (order.status === 'paid') {
    const product = await getProduct(db, order.product_id);
    if (product?.delivery_type === 'manual') return { ok: true, status: 'paid', confirmations: order.tx_confirm };
    const shipped = await fulfillOrder(env, order, order.tx_hash, order.tx_confirm);
    if (shipped) return { ok: true, status: 'shipped', confirmations: order.tx_confirm };
    const fresh = await getOrder(db, order.id);
    return { ok: false, status: fresh?.status || 'paid', confirmations: order.tx_confirm, error: '已支付，但库存不足或正在处理', retry: true };
  }

  // pending / payment_detected：查链
  if (order.status === 'pending' || order.status === 'payment_detected') {
    if (order.expired_at && new Date(order.expired_at).getTime() < Date.now()) {
      await transitionOrder(db, order.id, order.status, 'closed', 'expired', '超过 30 分钟未支付');
      return { ok: true, status: 'closed', error: '订单已过期' };
    }

    const provider = getTronProvider(env.TRON_RPC_URL, env.TRON_PRO_API_KEY);
    const check = await checkOrderPaymentOnChain(provider, order.address, order.total_price, Number(env.TRON_CONFIRMATIONS || '1'), order.created_at);
    // RPC 出错：不改变订单状态，返回错误（绝不能当未付款）
    if (!check.provider_ok) {
      return { ok: false, status: order.status, confirmations: order.tx_confirm, error: '支付网络暂不可用，请稍后重试', retry: true };
    }
    if (!check.found) {
      return { ok: true, status: 'pending', confirmations: 0 };
    }

    // 记录支付流水 + 事件
    await db.prepare(`
      INSERT INTO payment_transactions (tx_hash, order_id, from_address, to_address, amount, confirmations, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tx_hash) DO UPDATE SET confirmations=excluded.confirmations, status=excluded.status, updated_at=excluded.updated_at
    `).bind(check.tx_hash, order.id, check.from_address, order.address, check.value, check.confirmations, check.confirmed ? 'confirmed' : 'detected', new Date().toISOString()).run();

    if (!check.confirmed) {
      // pending -> payment_detected；并立即清除过期时间，避免"已到账却因未支付超时被关闭"
      await transitionOrder(db, order.id, 'pending', 'payment_detected', 'payment_detected', JSON.stringify({ tx: check.tx_hash, confirmations: check.confirmations }));
      await db.prepare('UPDATE orders SET tx_hash=?, tx_confirm=?, expired_at=NULL WHERE id=? AND status IN (?,?)').bind(check.tx_hash, check.confirmations, order.id, 'pending', 'payment_detected').run();
      await recordPaymentEvent(db, order.id, { tx_hash: check.tx_hash, event_type: 'detected', confirmations: check.confirmations, amount: check.value });
      return { ok: true, status: 'payment_detected', confirmations: check.confirmations };
    }

    // 已确认：原子地推进到 paid（订单状态 + 支付流水 + 审计一次提交，防止"状态/确认数不同步"）
    const now = new Date().toISOString();
    const confirmBatch = await db.batch([
      db.prepare(`UPDATE orders SET status='paid', tx_hash=?, tx_confirm=?, paid_at=? WHERE id=? AND status IN ('pending','payment_detected')`).bind(check.tx_hash, check.confirmations, now, order.id),
      db.prepare(`INSERT INTO payment_transactions (tx_hash,order_id,from_address,to_address,amount,confirmations,status,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tx_hash) DO UPDATE SET confirmations=excluded.confirmations,status=excluded.status,updated_at=excluded.updated_at`).bind(check.tx_hash, order.id, check.from_address, order.address, check.value, check.confirmations, 'confirmed', now),
      db.prepare(`INSERT INTO payment_events (order_id,tx_hash,event_type,confirmations,amount) VALUES (?,?,?,?,?)`).bind(order.id, check.tx_hash, 'confirmed', check.confirmations, check.value),
      db.prepare(`INSERT INTO order_events (order_id,event_type,from_status,to_status,metadata) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND status=?)`).bind(order.id, 'payment_confirmed', 'pending', 'paid', JSON.stringify({ tx: check.tx_hash, confirmations: check.confirmations }), order.id, 'paid'),
    ]);
    if ((confirmBatch[0]?.meta?.changes ?? 0) !== 1) {
      const fresh = await getOrder(db, order.id);
      return { ok: true, status: fresh?.status || 'paid', confirmations: check.confirmations };
    }

    const effective = (await getOrder(db, order.id)) || { ...order, tx_hash: check.tx_hash, tx_confirm: check.confirmations };
    const product = await getProduct(db, order.product_id);
    if (product?.delivery_type === 'manual') return { ok: true, status: 'paid', confirmations: check.confirmations };

    // 持久化 tx_hash/confirm 后发货
    const shipped = await fulfillOrder(env, effective, check.tx_hash, check.confirmations);
    if (shipped) return { ok: true, status: 'shipped', confirmations: check.confirmations };
    const post = await getOrder(db, order.id);
    return { ok: false, status: post?.status || 'paid', confirmations: check.confirmations, error: '支付已确认，但库存不足或在处理', retry: true };
  }

  return { ok: false, status: order.status, error: '未知状态' };
}

// ============================================================
// 定时：轮询 pending/payment_detected/paid 订单（幂等、单订单失败不阻塞）
// ============================================================
export async function processPendingOrders(env: StoreEnv): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT * FROM orders WHERE status IN ('pending','payment_detected','paid') ORDER BY created_at ASC LIMIT 200`).all<Order>();
  let processed = 0;
  for (const order of results || []) {
    try {
      const r = await checkOrderPayment(env, order.id);
      if (r?.status === 'shipped') processed++;
    } catch {
      // 单个订单失败不阻塞其它
    }
  }
  return processed;
}

// ============================================================
// 发货：CAS 领取执行权（paid -> fulfilling），原子占卡，成功后唯一一次库存扣减
//   - 只有 changes===1 的调用者能继续，其余直接退出（防并发重复发货）
//   - 卡不足 -> manual_review
// ============================================================
export async function fulfillOrder(env: StoreEnv, order: Order, txHash: string, confirmations: number): Promise<boolean> {
  const db = env.DB;

  // 1) CAS：只有拿到 paid->fulfilling 的 Worker 才有执行权（同一订单全局唯一）
  const got = await transitionOrder(db, order.id, 'paid', 'fulfilling', 'fulfill_start', JSON.stringify({ tx_hash: txHash, confirmations }));
  if (!got) return false;

  const now = new Date().toISOString();

  // 2) 原子领取：单条 UPDATE 用子查询领取 qty 张未售卡（并绑定本订单 order_id，防他单复用）
  const claim = await db.prepare(
    `UPDATE cards SET status=1, order_id=?, sold_at=? WHERE id IN (SELECT id FROM cards WHERE product_id=? AND status=0 ORDER BY id ASC LIMIT ?)`,
  ).bind(order.id, now, order.product_id, order.qty).run();
  const claimed = claim.meta?.changes ?? 0;
  if (claimed < order.qty) {
    // 库存不足/并发抢卡：释放本次领取（仅本订单专属，条件 status=1），转人工。绝不做"已发货但卡可售"。
    await db.prepare(`UPDATE cards SET status=0, order_id=NULL, sold_at=NULL WHERE order_id=? AND status=1`).bind(order.id).run();
    await transitionOrder(db, order.id, 'fulfilling', 'manual_review', 'fulfill_shortage', JSON.stringify({ needed: order.qty, got: claimed }));
    return false;
  }

  const cardRes = await db.prepare(`SELECT id FROM cards WHERE order_id=? AND status=1`).bind(order.id).all<{ id: number }>();
  const cardIds = (cardRes.results || []).map((c: any) => c.id);
  const idList = cardIds.join(',');

  // 3) 最终结算：一个 D1 事务内完成 卡/订单/库存/关联/审计，要么全成功要么全回滚
  const settleMeta = JSON.stringify({ cards: cardIds.length, tx: txHash });
  try {
    await db.batch([
      // 关联 order_cards（领取后这些卡 order_id=? 且 status=1）
      db.prepare(`INSERT INTO order_cards (order_id, card_id) SELECT ?, id FROM cards WHERE order_id=? AND status=1`).bind(order.id, order.id),
      // 唯一一次库存扣减（仅在我们持有 fulfilling 时）
      db.prepare(`UPDATE products SET sold=sold+?, stock=MAX(stock-?, 0), updated_at=? WHERE id=?`).bind(order.qty, order.qty, now, order.product_id),
      // 订单最终提交为 shipped（条件 status='fulfilling'，防止其它执行者误提交）
      db.prepare(`UPDATE orders SET tx_hash=?, tx_confirm=?, card_ids=?, paid_at=?, expired_at=NULL, status='shipped' WHERE id=? AND status='fulfilling'`).bind(txHash, confirmations, idList, now, order.id),
      // 发货审计（仅当订单确实变成 shipped 才记录）
      db.prepare(`INSERT INTO order_events (order_id,event_type,from_status,to_status,metadata) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=? AND status=?)`).bind(order.id, 'fulfilled', 'fulfilling', 'shipped', settleMeta, order.id, 'shipped'),
    ]);
  } catch {
    // 极端 SQL 失败：保持卡占用 + 订单转人工（绝不让"订单已发货但卡密重新可售"）
    await transitionOrder(db, order.id, 'fulfilling', 'manual_review', 'fulfill_error', '结算事务失败(卡保持占用,人工核实)');
    return false;
  }

  const shippedOk = true;

  // 6) 尽力而为：邮件 + 归集任务（只发生在真正 shipped 成功后）
  if (shippedOk && order.contact_email && !order.email_sent_at) {
    try {
      const { results: cards } = await db.prepare(`SELECT card FROM cards WHERE id IN (${cardIds.map(() => '?').join(',')})`).bind(...cardIds).all<{ card: string }>();
      const sent = await sendDeliveryEmail(env, order, (cards || []).map((r) => r.card));
      if (sent) await db.prepare(`UPDATE orders SET email_sent_at=? WHERE id=? AND email_sent_at IS NULL`).bind(now, order.id).run();
    } catch { /* 邮件失败不阻塞 */ }
  }
  if (shippedOk) {
    try {
      const masterAddr = await getMasterAddress(env);
      await db.prepare(
        `INSERT INTO sweep_tasks (order_id, source_address, to_address, amount, asset, address_index, product_title, status, note)
         SELECT ?, ?, ?, ?, 'USDT', ?, ?, 'pending', '等待自动归集'
         WHERE NOT EXISTS (SELECT 1 FROM sweep_tasks WHERE order_id=? AND source_address=?)`,
      ).bind(order.id, order.address, masterAddr, order.total_price, order.address_index ?? -1, order.product_title, order.id, order.address).run();
    } catch { /* 归集任务尽力而为 */ }
  }
  return shippedOk;
}
// 邮件重试（幂等）
export async function retryPendingEmails(env: StoreEnv): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT * FROM orders WHERE status='shipped' AND contact_email<>'' AND (email_sent_at IS NULL OR email_sent_at='') LIMIT 20`).all<Order>();
  let sentCount = 0;
  for (const order of results || []) {
    if (!order.card_ids) continue;
    const cards = await getOrderCards(env.DB, order.id);
    if (!cards.length) continue;
    if (await sendDeliveryEmail(env, order, cards.map((c) => c.card))) {
      await env.DB.prepare(`UPDATE orders SET email_sent_at=? WHERE id=? AND email_sent_at IS NULL`).bind(new Date().toISOString(), order.id).run();
      sentCount++;
    }
  }
  return sentCount;
}

// 后台手动补发：仅 paid 或 manual_review（且已确认支付）订单可补发
export async function manualFulfill(env: StoreEnv, orderId: string): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB;
  const order = await getOrder(db, orderId);
  if (!order) return { ok: false, error: '订单不存在' };
  if (order.status === 'shipped') return { ok: false, error: '该订单已发货' };
  if (order.status === 'pending' || order.status === 'payment_detected') return { ok: false, error: '该订单尚未确认支付' };

  // manual_review 且已有支付确认 -> 先回 paid
  if (order.status === 'manual_review') {
    await transitionOrder(db, order.id, 'manual_review', 'paid', 'admin_resume_fulfill', '后台补发');
  }
  const fresh = await getOrder(db, orderId);
  if (!fresh) return { ok: false, error: '订单不存在' };
  if (fresh.status !== 'paid') return { ok: false, error: '订单状态不是 paid，无法补发' };
  const ok = await fulfillOrder(env, fresh, fresh.tx_hash, fresh.tx_confirm);
  return ok ? { ok: true } : { ok: false, error: '库存不足或并发冲突，已转人工' };
}
