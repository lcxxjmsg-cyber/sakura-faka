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
//
// 设计原则：
//   1. 私钥仅在内存中按需派生，永不落库、永不外发；
//   2. 交易由 TronGrid (/wallet/triggersmartcontract) 负责构建，
//      我们只在本地做 secp256k1 签名，再广播——私钥不离本机；
//   3. 默认关闭 (AUTO_SWEEP_ENABLED !== 'true')，干跑(dry-run)可验证
//      raw_data_hex / txID / signature 是否正确，绝不意外转出资金。
//   4. 源子地址需要预先空投少量 TRX 作为能量费，否则广播会被拒。
// ============================================================

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
  note: string;
  created_at: string;
  updated_at: string;
};

export type SweepResult = {
  ok: boolean;
  dryRun: boolean;
  // 交易信息
  txID?: string;
  raw_data_hex?: string;
  signature?: string;
  amount?: string;
  // 状态
  status?: string;
  note?: string;
  code?: string;
};

// ABI 编码：transfer(address,uint256) 的参数字节 (不含函数选择器)
function abiAddress(evm20: string): string {
  // address: 左对齐，前面补零到 32 字节
  return '000000000000000000000000' + evm20.toLowerCase();
}
function abiUint256(value: bigint): string {
  let hex = value.toString(16);
  if (hex.length > 64) throw new Error('数值超出 uint256');
  return hex.padStart(64, '0');
}

async function fetchJson(url: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'content-type': 'application/json' }, ...opts });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { _raw: text, _status: res.status }; }
}

// 查询源地址 USDT(TRC-20) 余额，返回最小单位整数
async function getUsdtBalance(rpcUrl: string, address: string): Promise<bigint> {
  const data: any = await fetchJson(`${rpcUrl}/v1/accounts/${address}`);
  const account = data?.data?.[0];
  if (!account) return 0n;
  // TronGrid 的 trc20[].tokenId 是合约的 40 位 hex；也可能返回 base58 address。两者都匹配。
  const hex = tronToEVM20(USDT_TRC20_CONTRACT).toLowerCase();
  const token = (account.trc20 || []).find((t: any) => {
    const id = String(t.tokenId || t.address || '').toLowerCase();
    return id === hex || id === USDT_TRC20_CONTRACT.toLowerCase();
  });
  if (!token) return 0n;
  const bal = String(token.balance ?? token.value ?? '0');
  try { return BigInt(bal); } catch { return 0n; }
}

// 查询源地址 TRX(sun) 余额，用于判断是否有能力支付能量费
async function getTrxBalance(rpcUrl: string, address: string): Promise<bigint> {
  const data: any = await fetchJson(`${rpcUrl}/v1/accounts/${address}`);
  const account = data?.data?.[0];
  if (!account) return 0n;
  try { return BigInt(account.balance ?? 0); } catch { return 0n; }
}

// 让 TronGrid 构建未签名的 USDT(TRC-20) 转账交易
async function buildUnsignedTransfer(
  rpcUrl: string,
  fromHex21: string,
  contractHex21: string,
  toEVM20: string,
  amount: bigint,
  feeLimit: number,
): Promise<{ txID: string; raw_data: any; raw_data_hex: string }> {
  const parameter = abiAddress(toEVM20) + abiUint256(amount);
  const body = {
    owner_address: fromHex21,
    contract_address: contractHex21,
    function_selector: 'transfer(address,uint256)',
    parameter,
    fee_limit: feeLimit,
    call_value: 0,
    visible: false,
  };
  const res: any = await fetchJson(`${rpcUrl}/wallet/triggersmartcontract`, { method: 'POST', body: JSON.stringify(body) });
  if (res?.Error || res?.code || !res?.txID) throw new Error(res?.Error || res?.message || '构建交易失败');
  return { txID: res.txID, raw_data: res.raw_data, raw_data_hex: res.raw_data_hex };
}

// 本地对 raw_data 做 secp256k1 可恢复签名 (私钥仅在内存使用)
function signTronRaw(rawDataHex: string, privateKeyHex: string): string {
  const rawBytes = hexToBytes(rawDataHex);
  const msgHash = sha256(rawBytes); // 32 字节
  const sig = secp256k1.sign(msgHash, hexToBytes(privateKeyHex), { prehash: false, format: 'recovered' });
  return bytesToHex(sig); // 65 字节可恢复签名
}

async function broadcastTransaction(rpcUrl: string, unsigned: { txID: string; raw_data: any; raw_data_hex: string }, signature: string): Promise<SweepResult> {
  const payload = { txID: unsigned.txID, raw_data: unsigned.raw_data, raw_data_hex: unsigned.raw_data_hex, signature: [signature] };
  const res: any = await fetchJson(`${rpcUrl}/wallet/broadcasttransaction`, { method: 'POST', body: JSON.stringify(payload) });
  const ok = res?.result === true;
  return {
    ok,
    dryRun: false,
    txID: res?.txid || unsigned.txID,
    code: res?.code,
    note: ok ? '广播成功' : (res?.message || res?.code || '广播失败'),
    status: ok ? 'completed' : 'failed',
  };
}

// ============================================================
// 处理单个归集任务
//   dryRun = true        仅构建+签名，不广播，用于校验
//   dryRun = false       真实广播（需 AUTO_SWEEP_ENABLED=true）
// ============================================================
export async function trySweep(env: StoreEnv, task: SweepTask, dryRun: boolean): Promise<SweepResult> {
  const fail = (note: string): SweepResult => ({ ok: false, dryRun, status: 'failed', note });

  const mnemonic = await getWalletMnemonic(env);
  if (!mnemonic) return fail('未初始化收款钱包，请到后台「钱包设置」一键生成');
  const toAddress = await getMasterAddress(env) || task.to_address;
  if (!toAddress) return fail('未配置归集目标（TRON_MASTER_ADDRESS 或系统主钱包）');
  if (task.address_index == null || task.address_index < 0) return fail('缺少地址索引，无法本地签名');
  if (!validateTronAddress(toAddress)) return fail('归集目标地址无效');

  // 校验派生地址与任务源地址一致，防止误归集
  const derivedAddress = deriveTronAddress(mnemonic, task.address_index);
  if (!derivedAddress || derivedAddress !== task.source_address) return fail('派生地址与任务源地址不匹配');
  const privateKey = deriveTronPrivateKey(mnemonic, task.address_index);
  if (!privateKey) return fail('私钥派生失败');

  // 金额：取"任务金额 与 实际余额"的较小者(能转多少转多少，避免超过余额失败)
  const balance = await getUsdtBalance(env.TRON_RPC_URL, task.source_address);
  if (balance <= 0n) return fail('源地址无 USDT 余额');
  const requested = BigInt(task.amount || '0');
  const amount = requested > 0n && requested < balance ? requested : balance;
  const minAmount = BigInt(env.SWEEP_MIN_AMOUNT || '0');
  if (amount < minAmount) return fail(`余额 ${amount} 低于最小归集阈值 ${minAmount}`);

  // 能量费：源地址需要少量 TRX
  const trxBal = await getTrxBalance(env.TRON_RPC_URL, task.source_address);
  if (trxBal <= 0n) return fail('源地址 TRX 为 0，无法支付能量费');

  // 构建未签名交易
  const contractHex21 = tronToHex21(USDT_TRC20_CONTRACT);
  const feeLimit = Number(env.SWEEP_FEE_LIMIT || '100000000');
  let unsigned: { txID: string; raw_data: any; raw_data_hex: string };
  try {
    unsigned = await buildUnsignedTransfer(env.TRON_RPC_URL, tronToHex21(task.source_address), contractHex21, tronToEVM20(toAddress), amount, feeLimit);
  } catch (e: any) {
    return fail('构建交易失败: ' + (e?.message || String(e)));
  }

  const signature = signTronRaw(unsigned.raw_data_hex, privateKey);
  const amountStr = amount.toString();

  if (dryRun) {
    return { ok: true, dryRun, txID: unsigned.txID, raw_data_hex: unsigned.raw_data_hex, signature, amount: amountStr, status: 'pending', note: '干跑成功：已构建+签名，未广播' };
  }

  const broadcast = await broadcastTransaction(env.TRON_RPC_URL, unsigned, signature);
  return { ...broadcast, dryRun: false, amount: amountStr };
}

// ============================================================
// 自动处理所有 pending 归集任务 (供 cron 调用)
// 只有 AUTO_SWEEP_ENABLED === 'true' 时才会真正广播。
// ============================================================
export async function processPendingSweeps(env: StoreEnv): Promise<{ processed: number; swept: number; failed: number }> {
  if (env.AUTO_SWEEP_ENABLED !== 'true') return { processed: 0, swept: 0, failed: 0 };
  const { results } = await env.DB.prepare(`SELECT * FROM sweep_tasks WHERE status='pending' ORDER BY id ASC LIMIT 20`).all<SweepTask>();
  const tasks = results || [];
  let swept = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      const res = await trySweep(env, task, false);
      if (res.ok && res.status === 'completed') {
        await env.DB.prepare(`UPDATE sweep_tasks SET status='completed', tx_hash=?, amount=?, note=?, updated_at=? WHERE id=?`)
          .bind(res.txID || '', res.amount || task.amount, res.note || '', new Date().toISOString(), task.id).run();
        swept++;
      } else {
        await env.DB.prepare(`UPDATE sweep_tasks SET status='failed', note=?, tx_hash=COALESCE(?, tx_hash), updated_at=? WHERE id=?`)
          .bind(res.note || '失败', res.txID || '', new Date().toISOString(), task.id).run();
        failed++;
      }
    } catch {
      failed++;
    }
  }
  return { processed: tasks.length, swept, failed };
}
