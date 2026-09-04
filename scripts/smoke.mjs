// 本地冒烟测试：不涉及真实资金，验证 下单→发货→建归集任务→干跑 链路。
// 用法：
//   1) npm run dev  (astron dev server, 默认 http://localhost:4321)
//   2) node scripts/smoke.mjs
// 需要 .dev.vars 已配置 ADMIN_PASSWORD 等。
const BASE = process.env.FAKA_BASE || 'http://localhost:4321';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Sakura2024!';
import { randomUUID } from 'node:crypto';

let cookie = '';
async function req(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + path, { ...opts, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

const log = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) process.exitCode = 1; };

async function main() {
  console.log(`\n=== 冒烟测试 @ ${BASE} ===\n`);

  // 1) 后台登录
  const login = await req('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: ADMIN_PASSWORD }) });
  log(login.body?.ok, '管理员登录');

  // 1a) 初始化收款钱包（系统自备；若已有则跳过）
  const wallet0 = await req('/api/admin/wallet');
  if (!wallet0.body?.data?.has_mnemonic) {
    const gen = await req('/api/admin/wallet', { method: 'POST', body: JSON.stringify({ action: 'generate' }) });
    log(gen.body?.data?.mnemonic && gen.body.data.master_address, `一键生成收款钱包 (主钱包 ${gen.body?.data?.master_address?.slice(0, 12)}…)`);
  } else {
    log(true, `收款钱包已存在 (主钱包 ${wallet0.body.data.master_address?.slice(0, 12)}…)`);
  }

  // 1b) 商品列表（确认 seed 是否可见）
  const prods = await req('/api/admin/products');
  console.log(`  products(${prods.body?.data?.length || 0}): `, JSON.stringify((prods.body?.data || []).map((p) => p.title)));

  // 1c) 补充库存（幂等，避免重复跑测试时卡密被耗尽）
  const topup = Array.from({ length: 30 }, (_, i) => `TEST-${randomUUID().slice(0, 13)}`).join('\n');
  const imp = await req('/api/admin/cards/import', { method: 'POST', body: JSON.stringify({ product_id: 1, text: topup }) });
  log(imp.body?.data?.count > 0, `补充卡密 ${imp.body?.data?.count} 条`);

  // 2) 下单（seed 商品 1）
  const order = await req('/api/order/create', { method: 'POST', body: JSON.stringify({ product_id: 1, qty: 1, email: 'test@example.com' }) });
  console.log('  create order resp:', JSON.stringify(order.body));
  const orderId = order.body?.data?.id;
  log(order.body?.ok && orderId, `创建订单 ${orderId}`);

  // 3) 模拟到账（不涉及真实资金）
  const sim = await req('/api/admin/simulate-payment', { method: 'POST', body: JSON.stringify({ order_id: orderId }) });
  log(sim.body?.data?.shipped === true, `模拟到账→自动发货 ${orderId}`);

  // 4) 订单状态应为 shipped
  const q = await req(`/api/order/query?id=${orderId}`);
  log(q.body?.data?.status === 'shipped', '订单状态 = shipped');

  // 5) 后台查看订单卡密
  const cards = await req(`/api/admin/order-cards?order_id=${orderId}`);
  log(Array.isArray(cards.body?.data?.cards) && cards.body.data.cards.length > 0, `查看卡密 (${cards.body?.data?.cards?.length} 条)`);

  // 6) 归集任务应已创建（pending）
  const sweeps = await req('/api/admin/sweeps');
  const task = (sweeps.body?.data || []).find((s) => s.order_id === orderId);
  log(!!task && task.status === 'pending', `归集任务已创建 #${task?.id} (${task?.source_address?.slice(0, 10)}…)`);

  // 7) 干跑校验（只构建+签名，不广播）。未配置归集目标/无余额是预期停点。
  if (task) {
    const run = await req('/api/admin/sweeps', { method: 'POST', body: JSON.stringify({ id: task.id, action: 'dry_run' }) });
    log(run.body?.ok === true, `干跑校验(信息)：${run.body?.data?.note || (run.body?.data?.txID ? 'txID=' + run.body.data.txID : '')}`);
  }

  // 8) 系统自检
  const check = await req('/api/admin/system-check');
  const checks = check.body?.data?.checks || [];
  log(Array.isArray(checks), '系统自检返回');

  // 9) 操作日志
  const logs = await req('/api/admin/logs');
  log(Array.isArray(logs.body?.data) && logs.body.data.length > 0, `操作日志记录 (${logs.body?.data?.length} 条)`);

  console.log('\n=== 完成 ===');
}

main().catch((e) => { console.error('错误:', e); process.exitCode = 1; });
