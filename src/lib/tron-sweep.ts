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
import { isAutoSweepEnabled } from '@/lib/config';
import { getTronProvider } from '@/domain/payment/tron.provider';
import { classifyReceiptFailure } from '@/domain/payment/payment.service';

export type SweepStatus =
  | 'pending' | 'need_gas' | 'ready' | 'processing' | 'broadcasting'
  | 'confirming' | 'retry' | 'completed' | 'failed_permanent';

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
  lease_until: string | null;
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
};

const MAX_RETRY = 12;
const RETRY_BASE_MS = 60_000;
const LEASE_MS = 90_000;
const TIMEOUT = 8000;
const ABI_PAD_ADDR = '000000000000000000000000';

function abiAddress(evm20: string): string { return ABI_PAD_ADDR + evm20.toLowerCase(); }
function abiUint256(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length > 64) throw new Error('uint256 溢出');
  return hex.padStart(64, '0');
}

async function localJson(url: string, opts?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'content-type': 'application/json' }, signal: controller.signal, ...opts });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return {}; }
  } catch (e: any) { return { _error: e?.message || String(e) }; }
  finally { clearTimeout(t); }
}

async function buildUnsignedTransfer(rpcUrl: string, fromHex21: string, contractHex21: string, toEVM20: string, amount: bigint, feeLimit: number) {
  const body = {
    owner_address: fromHex21, contract_address: contractHex21,
    function_selector: 'transfer(address,uint256)',
    parameter: abiAddress(toEVM20) + abiUint256(amount),
    fee_limit: feeLimit, call_value: 0, visible: false,
  };
  const res = await localJson(`${rpcUrl}/wallet/triggersmartcontract`, { method: 'POST', body: JSON.stringify(body) });
  if (!res?.txID) throw new Error(res?.Error || res?.message || res?._error || '构建交易失败');
  return { txID: res.txID, raw_data: res.raw_data, raw_data_hex: res.raw_data_hex };
}

function signTronRaw(rawDataHex: string, privateKeyHex: string): string {
  const sig = secp256k1.sign(sha256(hexToBytes(rawDataHex)), hexToBytes(privateKeyHex), { prehash: false, format: 'recovered' });
  return bytesToHex(sig);
}

async function broadcast(rpcUrl: string, unsigned: { txID: string; raw_data: any; raw_data_hex: string }, signature: string) {
  const payload = { txID: unsigned.txID, raw_data: unsigned.raw_data, raw_data_hex: unsigned.raw_data_hex, signature: [signature] };
  const res = await localJson(`${rpcUrl}/wallet/broadcasttransaction`, { method: 'POST', body: JSON.stringify(payload) });
  return { ok: res?.result === true, txid: res?.txid || unsigned.txID, code: res?.code || '', message: res?.message || '' };
}

function nextRetryAt(count: number): string {
  return new Date(Date.now() + RETRY_BASE_MS * Math.pow(2, Math.min(count, 6))).toISOString();
}

// 原子领取执行权：CAS 到 processing + lease，防两个 cron 同时广播同一任务
export async function claimSweep(db: D1Database, taskId: number): Promise<boolean> {
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + LEASE_MS).toISOString();
  const r = await db.prepare(
    `UPDATE sweep_tasks SET status='processing', lease_until=?, updated_at=? WHERE id=? AND status IN ('pending','retry','ready','need_gas') AND retry_count<? AND (lease_until IS NULL OR lease_until<=?)`,
  ).bind(lease, now, taskId, MAX_RETRY, now).run();
  return (r.meta?.changes ?? 0) === 1;
}

export async function trySweep(env: StoreEnv, task: SweepTask, dryRun: boolean): Promise<SweepResult> {
  const fail = (status: SweepStatus, note: string): SweepResult => ({ ok: false, dryRun, status, note });

  if (task.address_index == null || task.address_index < 0) return fail('failed_permanent', '缺少地址索引');
  const mnemonic = await getWalletMnemonic(env);
  if (!mnemonic) return fail('failed_permanent', '未初始化收款钱包');
  const toAddress = (await getMasterAddress(env)) || task.to_address;
  if (!toAddress) return fail('failed_permanent', '未配置归集目标');
  if (!validateTronAddress(toAddress)) return fail('failed_permanent', '归集目标地址无效');

  const derived = deriveTronAddress(mnemonic, task.address_index);
  if (!derived || derived !== task.source_address) return fail('failed_permanent', '派生地址与任务源地址不匹配');
  const privateKey = deriveTronPrivateKey(mnemonic, task.address_index);
  if (!privateKey) return fail('failed_permanent', '私钥派生失败');

  const provider = getTronProvider(env.TRON_RPC_URL, env.TRON_PRO_API_KEY);

  // 余额：provider 返回 null 表示 RPC 错误，必须重试而不是当作 0
  const balance = await provider.getUsdtBalance(task.source_address);
  if (balance === null) return fail('retry', '查询余额失败(网络)，稍后重试');
  if (balance <= 0) return fail('retry', '源地址暂无可归集余额（稍后重试）');
  const requested = BigInt(task.amount || '0');
  const amount = requested > 0n && requested < BigInt(balance) ? requested : BigInt(balance);
  const minAmount = BigInt(env.SWEEP_MIN_AMOUNT || '0');
  if (amount < minAmount) return fail('retry', `余额低于最小归集阈值（${amount}）`);

  const trx = await provider.getTrxBalance(task.source_address);
  if (trx === null) return fail('retry', '查询 TRX 失败(网络)，稍后重试');
  if (trx <= 0) return fail('need_gas', '源地址 TRX 为 0，请补充能量费(或配置 Gas 钱包)');

  const contractHex21 = tronToHex21(USDT_TRC20_CONTRACT);
  const feeLimit = Number(env.SWEEP_FEE_LIMIT || '100000000');
  let unsigned;
  try {
    unsigned = await buildUnsignedTransfer(env.TRON_RPC_URL, tronToHex21(task.source_address), contractHex21, tronToEVM20(toAddress), amount, feeLimit);
  } catch (e: any) {
    return fail('retry', `构建交易失败: ${e?.message || String(e)}`);
  }

  const signature = signTronRaw(unsigned.raw_data_hex, privateKey);

  if (dryRun) {
    return { ok: true, dryRun, status: 'pending', txID: unsigned.txID, raw_data_hex: unsigned.raw_data_hex, signature, amount: amount.toString(), note: '干跑成功：已构建+签名，未广播' };
  }

  const b = await broadcast(env.TRON_RPC_URL, unsigned, signature);
  if (!b.ok) {
    // 广播失败分类：资源类归 retry/need_gas，结构性归 failed_permanent
    const kind = classifyReceiptFailure(b.code);
    return fail(kind, `广播失败: ${b.code || ''} ${b.message || ''}`);
  }
  return { ok: true, dryRun: false, status: 'broadcasting', txID: b.txid, amount: amount.toString(), note: '已广播，等待链上确认' };
}

// 用 solid receipt 确认已广播的交易
async function confirmSweep(env: StoreEnv, task: SweepTask): Promise<{ done: boolean; nextStatus?: SweepStatus; note?: string }> {
  const provider = getTronProvider(env.TRON_RPC_URL, env.TRON_PRO_API_KEY);
  const receipt = await provider.getSolidReceipt(task.tx_hash);
  if (receipt === null) return { done: false, note: '确认中(网络)' };
  if (!receipt.found) return { done: false, note: '等待上链' };
  if (receipt.success) return { done: true, nextStatus: 'completed', note: '链上已确认' };
  // 失败：按错误码分类
  const kind = classifyReceiptFailure(receipt.code);
  return { done: true, nextStatus: kind, note: `执行失败(${receipt.code || 'UNKNOWN'})` };
}

export async function processPendingSweeps(env: StoreEnv): Promise<{ processed: number; swept: number; failed: number }> {
  if (!(await isAutoSweepEnabled(env))) return { processed: 0, swept: 0, failed: 0 };
  const db = env.DB;
  const now = new Date().toISOString();

  // 1) 回收超时 processing（lease 到期 → 回到 pending）
  await db.prepare(`UPDATE sweep_tasks SET status='pending', lease_until=NULL, updated_at=? WHERE status='processing' AND lease_until IS NOT NULL AND lease_until<=?`).bind(now, now).run();

  // 2) 确认 broadcasting/confirming
  let swept = 0;
  const inflight = await db.prepare(`SELECT * FROM sweep_tasks WHERE status IN ('broadcasting','confirming') LIMIT 50`).all<SweepTask>();
  for (const task of inflight.results || []) {
    try {
      const r = await confirmSweep(env, task);
      if (r.done && r.nextStatus === 'completed') {
        await db.prepare(`UPDATE sweep_tasks SET status='completed', confirmed_at=?, note=?, updated_at=? WHERE id=?`).bind(now, '链上已确认', now, task.id).run();
        swept++;
      } else if (r.done) {
        const ns = r.nextStatus as SweepStatus;
        if (ns === 'need_gas') await db.prepare(`UPDATE sweep_tasks SET status='need_gas', last_error=?, updated_at=? WHERE id=?`).bind(r.note, now, task.id).run();
        else if (ns === 'failed_permanent') await db.prepare(`UPDATE sweep_tasks SET status='failed_permanent', last_error=?, updated_at=? WHERE id=?`).bind(r.note, now, task.id).run();
        else await db.prepare(`UPDATE sweep_tasks SET status='retry', last_error=?, retry_count=retry_count+1, next_retry_at=?, updated_at=? WHERE id=?`).bind(r.note, nextRetryAt(task.retry_count + 1), now, task.id).run();
      }
    } catch { /* 下次再试 */ }
  }

  // 3) 领取可执行任务（原子，防并发）
  const actionable = await db.prepare(
    `SELECT * FROM sweep_tasks WHERE status IN ('pending','retry','ready','need_gas') AND retry_count<? AND (lease_until IS NULL OR lease_until<=?) ORDER BY id ASC LIMIT 20`,
  ).bind(MAX_RETRY, now).all<SweepTask>();

  let processed = 0;
  let failed = 0;
  for (const task of actionable.results || []) {
    if (!(await claimSweep(db, task.id))) continue; // 已被别的 worker 领取
    processed++;
    try {
      const res = await trySweep(env, task, false);
      if (res.status === 'broadcasting') {
        await db.prepare(`UPDATE sweep_tasks SET status='broadcasting', tx_hash=?, broadcast_at=?, lease_until=NULL, last_error='', note=?, updated_at=? WHERE id=?`).bind(res.txID || '', now, res.note || '', now, task.id).run();
      } else if (res.status === 'completed') {
        await db.prepare(`UPDATE sweep_tasks SET status='completed', tx_hash=?, confirmed_at=?, lease_until=NULL, note=?, updated_at=? WHERE id=?`).bind(res.txID || '', now, res.note || '', now, task.id).run();
        swept++;
      } else if (res.status === 'failed_permanent') {
        await db.prepare(`UPDATE sweep_tasks SET status='failed_permanent', lease_until=NULL, last_error=?, note=?, updated_at=? WHERE id=?`).bind(res.note || '', res.note || '', now, task.id).run();
        failed++;
      } else {
        // retry / need_gas
        await db.prepare(`UPDATE sweep_tasks SET status=?, lease_until=NULL, last_error=?, retry_count=retry_count+1, next_retry_at=?, note=?, updated_at=? WHERE id=?`)
          .bind(res.status, res.note || '', nextRetryAt(task.retry_count + 1), res.note || '', now, task.id).run();
      }
    } catch (e: any) {
      await db.prepare(`UPDATE sweep_tasks SET status='retry', lease_until=NULL, last_error=?, retry_count=retry_count+1, next_retry_at=?, updated_at=? WHERE id=?`)
        .bind(String(e?.message || e), nextRetryAt(task.retry_count + 1), now, task.id).run();
      failed++;
    }
  }
  return { processed, swept, failed };
}
