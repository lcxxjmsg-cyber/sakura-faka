import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { StoreEnv } from '@/types';
import {
  USDT_TRC20_CONTRACT,
  deriveTronAddress,
  deriveTronPrivateKey,
  tronToEVM20,
  tronToHex21,
  hexToBytes,
  bytesToHex,
  validateTronAddress,
} from '@/lib/tron';
import { getWalletMnemonic, getMasterAddress } from '@/lib/wallet';

// ============================================================
// 真实 USDT (TRC-20) 自动归集
// 状态机：pending -> ready -> broadcasting -> confirming/completed
//         异常路径：need_gas / retry / failed_permanent
// 广播成功不等同于 completed：必须等待链上确认（confirmed_at）。
// 临时 RPC 错误一律 retry（含退避），只有结构性错误才 failed_permanent。
// ============================================================

export type SweepStatus =
  | 'pending' | 'need_gas' | 'ready' | 'broadcasting' | 'confirming'
  | 'retry' | 'completed' | 'failed_permanent';

export type SweepTask = {
  id: number;
  order_id: string | null;
  source_address: string;
  to_address: string;
  amount: string;
  asset: string;
  address_index: number;
  product_title: string;
  status: string;
  tx_hash: string;
  retry_count: number;
  next_retry_at: string | null;
  last_error: string;
  broadcast_at: string | null;
  confirmed_at: string | null;
  note: string;
  created_at: string;
  updated_at: string;
};

export type SweepResult = {
  ok: boolean;
  dryRun: boolean;
  status: SweepStatus;
  txID?: string;
  raw_data_hex?: string;
  signature?: string;
  amount?: string;
  note?: string;
  code?: string;
  retry_count?: number;
};

const MAX_RETRY = 12;
const RETRY_BASE_MS = 60_000;
const RPC_TIMEOUT = 8000;

const ABI_PAD_ADDR = '000000000000000000000000';

function abiAddress(evm20: string): string { return ABI_PAD_ADDR + evm20.toLowerCase(); }
function abiUint256(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length > 64) throw new Error('uint256 溢出');
  return hex.padStart(64, '0');
}

async function fetchJson(url: string, opts?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), RPC_TIMEOUT);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'content-type': 'application/json' }, signal: controller.signal, ...opts });
    if (!res.ok) return { _status: res.status };
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { _raw: text }; }
  } catch (e: any) {
    return { _error: e?.message || String(e) };
  } finally { clearTimeout(t); }
}

async function getLatestBlock(rpcUrl: string): Promise<number | null> {
  for (const ep of [`${rpcUrl}/wallet/getnowblock`, `${rpcUrl}/v1/blocks/latest`]) {
    const d = await fetchJson(ep);
    const num = d?.block_header?.raw_data?.number ?? d?.block?.block_header?.raw_data?.number ?? d?.number;
    if (typeof num === 'number') return num;
  }
  return null;
}

async function getUsdtBalance(rpcUrl: string, address: string): Promise<bigint> {
  const d = await fetchJson(`${rpcUrl}/v1/accounts/${address}`);
  const acct = d?.data?.[0];
  if (!acct) return 0n;
  const hex = tronToEVM20(USDT_TRC20_CONTRACT).toLowerCase();
  const tok = (acct.trc20 || []).find((t: any) => {
    const id = String(t.tokenId || t.address || '').toLowerCase();
    return id === hex || id === USDT_TRC20_CONTRACT.toLowerCase();
  });
  if (!tok) return 0n;
  try { return BigInt(String(tok.balance ?? tok.value ?? '0')); } catch { return 0n; }
}

async function getTrxBalance(rpcUrl: string, address: string): Promise<bigint> {
  const d = await fetchJson(`${rpcUrl}/v1/accounts/${address}`);
  const acct = d?.data?.[0];
  if (!acct) return 0n;
  try { return BigInt(acct.balance ?? 0); } catch { return 0n; }
}

async function buildUnsignedTransfer(rpcUrl: string, fromHex21: string, contractHex21: string, toEVM20: string, amount: bigint, feeLimit: number): Promise<{ txID: string; raw_data: any; raw_data_hex: string }> {
  const body = {
    owner_address: fromHex21,
    contract_address: contractHex21,
    function_selector: 'transfer(address,uint256)',
    parameter: abiAddress(toEVM20) + abiUint256(amount),
    fee_limit: feeLimit,
    call_value: 0,
    visible: false,
  };
  const res = await fetchJson(`${rpcUrl}/wallet/triggersmartcontract`, { method: 'POST', body: JSON.stringify(body) });
  if (!res?.txID) {
    const msg = res?.Error || res?.message || res?._error || res?._raw || '构建交易失败';
    const err = new Error(String(msg));
    (err as any).code = res?.code || '';
    throw err;
  }
  return { txID: res.txID, raw_data: res.raw_data, raw_data_hex: res.raw_data_hex };
}

function signTronRaw(rawDataHex: string, privateKeyHex: string): string {
  const msgHash = sha256(hexToBytes(rawDataHex));
  const sig = secp256k1.sign(msgHash, hexToBytes(privateKeyHex), { prehash: false, format: 'recovered' });
  return bytesToHex(sig);
}

async function broadcast(rpcUrl: string, unsigned: { txID: string; raw_data: any; raw_data_hex: string }, signature: string): Promise<{ ok: boolean; txid?: string; code?: string; message?: string }> {
  const payload = { txID: unsigned.txID, raw_data: unsigned.raw_data, raw_data_hex: unsigned.raw_data_hex, signature: [signature] };
  const res = await fetchJson(`${rpcUrl}/wallet/broadcasttransaction`, { method: 'POST', body: JSON.stringify(payload) });
  return { ok: res?.result === true, txid: res?.txid || unsigned.txID, code: res?.code, message: res?.message || res?._raw || '' };
}

function nextRetryAt(count: number): string {
  return new Date(Date.now() + RETRY_BASE_MS * Math.pow(2, Math.min(count, 6))).toISOString();
}

// ============================================================
// 处理单个归集任务
// ============================================================
export async function trySweep(env: StoreEnv, task: SweepTask, dryRun: boolean): Promise<SweepResult> {
  const fail = (status: SweepStatus, note: string): SweepResult => ({ ok: false, dryRun, status, note });

  // 结构性错误 -> failed_permanent
  if (task.address_index == null || task.address_index < 0) return fail('failed_permanent', '缺少地址索引，无法本地签名');
  const mnemonic = await getWalletMnemonic(env);
  if (!mnemonic) return fail('failed_permanent', '未初始化收款钱包');
  const toAddress = (await getMasterAddress(env)) || task.to_address;
  if (!toAddress) return fail('failed_permanent', '未配置归集目标');
  if (!validateTronAddress(toAddress)) return fail('failed_permanent', '归集目标地址无效');

  // 校验派生地址与任务源地址一致，防止误归集
  const derived = deriveTronAddress(mnemonic, task.address_index);
  if (!derived || derived !== task.source_address) return fail('failed_permanent', '派生地址与任务源地址不匹配');
  const privateKey = deriveTronPrivateKey(mnemonic, task.address_index);
  if (!privateKey) return fail('failed_permanent', '私钥派生失败');

  // 余额
  const balance = await getUsdtBalance(env.TRON_RPC_URL, task.source_address);
  if (balance <= 0n) return fail('retry', '源地址暂无可归集余额（稍后重试）');
  const requested = BigInt(task.amount || '0');
  const amount = requested > 0n && requested < balance ? requested : balance;
  const minAmount = BigInt(env.SWEEP_MIN_AMOUNT || '0');
  if (amount < minAmount) return fail('retry', `余额低于最小归集阈值（${amount}）`);

  // TRX / 能量费不足 -> need_gas
  const trxBal = await getTrxBalance(env.TRON_RPC_URL, task.source_address);
  if (trxBal <= 0n) return fail('need_gas', '源地址 TRX 为 0，请补充能量费用（或配置 Gas 钱包）');

  const contractHex21 = tronToHex21(USDT_TRC20_CONTRACT);
  const feeLimit = Number(env.SWEEP_FEE_LIMIT || '100000000');
  let unsigned: { txID: string; raw_data: any; raw_data_hex: string };
  try {
    unsigned = await buildUnsignedTransfer(env.TRON_RPC_URL, tronToHex21(task.source_address), contractHex21, tronToEVM20(toAddress), amount, feeLimit);
  } catch (e: any) {
    return fail('retry', `构建交易失败: ${(e as any).code || e?.message || String(e)}`);
  }

  const signature = signTronRaw(unsigned.raw_data_hex, privateKey);

  if (dryRun) {
    return { ok: true, dryRun, status: 'pending', txID: unsigned.txID, raw_data_hex: unsigned.raw_data_hex, signature, amount: amount.toString(), note: '干跑成功：已构建+签名，未广播' };
  }

  const b = await broadcast(env.TRON_RPC_URL, unsigned, signature);
  if (!b.ok) {
    // 临时错误重试；有明确永久错误码则 failed_permanent
    const permanent = (b.code && /BAD|INVALID|DENIED|DUPLICATE|NOT_FOUND|OUT_OF_ENERGY|BANDWIDTH/i.test(b.code)) ? 'failed_permanent' : 'retry';
    return fail(permanent as SweepStatus, `广播失败: ${b.code || ''} ${b.message || ''}`);
  }

  return { ok: true, dryRun: false, status: 'broadcasting', txID: b.txid, amount: amount.toString(), note: '已广播，等待链上确认' };
}

// 广播成功后，等待链上确认：查询源地址的 USDT 转出记录匹配该 tx
async function confirmBroadcast(env: StoreEnv, task: SweepTask): Promise<boolean> {
  const txHash = (task.tx_hash || '').toLowerCase();
  if (!txHash) return false;
  const d = await fetchJson(`${env.TRON_RPC_URL}/v1/accounts/${task.source_address}/transactions/trc20`);
  const txs = d?.data || [];
  return txs.some((tx: any) => String(tx.transaction_id || tx.hash || '').toLowerCase() === txHash && /SUCCESS/.test(String(tx.contract_ret || 'SUCCESS')));
}

// ============================================================
// 自动处理可执行任务 + 确认已完成（供 cron 调用；AUTO_SWEEP_ENABLED=true 才真正广播）
// ============================================================
export async function processPendingSweeps(env: StoreEnv): Promise<{ processed: number; swept: number; failed: number }> {
  if (env.AUTO_SWEEP_ENABLED !== 'true') return { processed: 0, swept: 0, failed: 0 };
  const db = env.DB;
  const now = new Date().toISOString();

  // 1) 确认已广播但未确认的任务
  const broadcasting = await db.prepare(`SELECT * FROM sweep_tasks WHERE status IN ('broadcasting','confirming') LIMIT 50`).all<SweepTask>();
  let swept = 0;
  for (const task of broadcasting.results || []) {
    try {
      if (await confirmBroadcast(env, task)) {
        await db.prepare(`UPDATE sweep_tasks SET status='completed', confirmed_at=?, note=?, updated_at=? WHERE id=?`).bind(now, '链上已确认', now, task.id).run();
        swept++;
      }
    } catch { /* 排查失败下次再试 */ }
  }

  // 2) 处理 pending / retry / need_gas / ready
  const actionable = await db.prepare(
    `SELECT * FROM sweep_tasks WHERE status IN ('pending','retry','need_gas','ready') AND (next_retry_at IS NULL OR next_retry_at <= ?) AND retry_count < ? ORDER BY id ASC LIMIT 20`,
  ).bind(now, MAX_RETRY).all<SweepTask>();

  let processed = 0;
  let failed = 0;
  for (const task of actionable.results || []) {
    try {
      const res = await trySweep(env, task, false);
      processed++;
      if (res.status === 'broadcasting') {
        await db.prepare(`UPDATE sweep_tasks SET status='broadcasting', tx_hash=?, broadcast_at=?, last_error='', note=?, updated_at=? WHERE id=?`)
          .bind(res.txID || '', now, res.note || '', now, task.id).run();
      } else if (res.status === 'completed') {
        await db.prepare(`UPDATE sweep_tasks SET status='completed', tx_hash=?, confirmed_at=?, note=?, updated_at=? WHERE id=?`).bind(res.txID || '', now, res.note || '', now, task.id).run();
        swept++;
      } else if (res.status === 'failed_permanent') {
        await db.prepare(`UPDATE sweep_tasks SET status='failed_permanent', last_error=?, note=?, updated_at=? WHERE id=?`).bind(res.note || '', res.note || '', now, task.id).run();
        failed++;
      } else {
        // retry / need_gas
        await db.prepare(`UPDATE sweep_tasks SET status=?, last_error=?, retry_count=retry_count+1, next_retry_at=?, note=?, updated_at=? WHERE id=?`)
          .bind(res.status, res.note || '', nextRetryAt(task.retry_count + 1), res.note || '', now, task.id).run();
      }
    } catch (e: any) {
      await db.prepare(`UPDATE sweep_tasks SET last_error=?, retry_count=retry_count+1, next_retry_at=?, status='retry', updated_at=? WHERE id=?`)
        .bind(String(e?.message || e), nextRetryAt(task.retry_count + 1), now, task.id).run();
      failed++;
    }
  }

  return { processed, swept, failed };
}
