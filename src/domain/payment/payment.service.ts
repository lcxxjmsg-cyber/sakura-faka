import type { TronPaymentCheck } from '@/lib/tron';
import type { TronProvider } from './tron.provider';

// 聚合支付检测（P1-5 多付/分多笔）：
// 订单地址唯一，故把该地址所有"已上链且 receipt.result===SUCCESS"的 USDT 转入之和视为实收。
// found = 实收 >= 应付；confirmations = 计入交易的最小确认数（保守，用于自动发货）；
// RPC 错误（provider null）→ provider_ok=false（绝不能当成"未付款"）。
export type PaymentCheck = TronPaymentCheck & {
  received: string;       // 实收(最小单位)
  overpaid: string;       // 多付(最小单位)
  txs: { tx_hash: string; from: string; value: string; confirmations: number }[];
};

export async function checkOrderPaymentOnChain(
  provider: TronProvider,
  address: string,
  required: string,
  minConfirmations: number,
  createdAt?: string,
): Promise<PaymentCheck> {
  const err = (code: string, message: string): PaymentCheck => ({
    provider_ok: false, found: false, confirmed: false, confirmations: 0,
    tx_hash: '', from_address: '', to_address: address, value: '0', block_number: 0, error_code: code, error_message: message,
    received: '0', overpaid: '0', txs: [],
  });
  const base = (): PaymentCheck => ({
    provider_ok: true, found: false, confirmed: false, confirmations: 0,
    tx_hash: '', from_address: '', to_address: address, value: '0', block_number: 0, error_code: '', error_message: '',
    received: '0', overpaid: '0', txs: [],
  });

  const latestBlock = await provider.getLatestBlock();
  if (latestBlock === null) return err('RPC_BLOCK', '无法获取最新区块高度');

  const transfers = await provider.findIncomingTransfers(address, {
    minTimestamp: createdAt ? Date.parse(createdAt) - 120000 : undefined,
    limit: 200,
  });
  if (transfers === null) return err('RPC_LIST', '获取收款记录失败');

  const requiredBig = BigInt(required);
  const included: { tx_hash: string; from: string; value: string; confirmations: number }[] = [];
  let received = 0n;
  let best: { tx_hash: string; from: string; value: string } | null = null;
  let bestValue = 0n;
  let minConf = Number.MAX_SAFE_INTEGER;
  let maxConf = 0;

  for (const t of transfers) {
    if (!t.value) continue;
    let val: bigint;
    try { val = BigInt(t.value); } catch { continue; }
    if (val <= 0n) continue;

    // 逐笔用 solid receipt 确认是否成功（真实可靠，避免用历史接口的 blockNumber 作为确认依据）
    const receipt = await provider.getSolidReceipt(t.tx_hash);
    if (receipt === null) return err('RPC_RECEIPT', '无法获取交易回执');
    if (!receipt.found || !receipt.success) continue;

    const conf = receipt.block_number > 0 ? Math.max(1, latestBlock - receipt.block_number + 1) : 0;
    included.push({ tx_hash: t.tx_hash, from: t.from, value: String(val), confirmations: conf });
    received += val;
    if (conf < minConf) minConf = conf;
    if (conf > maxConf) maxConf = conf;
    if (val > bestValue) { bestValue = val; best = { tx_hash: t.tx_hash, from: t.from, value: String(val) }; }
  }

  const res = base();
  res.txs = included;
  res.received = received.toString();
  const expectedBig = BigInt(required);
  const found = received >= expectedBig;
  res.found = found;
  res.overpaid = (found ? received - expectedBig : 0n).toString();
  if (!included.length) return res;

  // 代表交易（最大金额那笔）
  if (best) { res.tx_hash = best.tx_hash; res.from_address = best.from; res.value = best.value; }
  // 确认数：find 用"计入交易最小确认"（保守）；否则展示最大值
  res.confirmations = found ? Math.min(minConf, Number.MAX_SAFE_INTEGER) : maxConf;
  res.confirmed = found && minConf >= minConfirmations;
  res.block_number = 0;
  return res;
}

// 根据 solid receipt 失败码归类：临时（重试/补能量）或 永久失败
export function classifyReceiptFailure(code: string): 'retry' | 'need_gas' | 'failed_permanent' {
  const c = String(code || '').toUpperCase();
  if (/OUT_OF_ENERGY|BANDWIDTH|TRANSFER.*FAIL|SIGNATURE|INVALID/.test(c)) return 'need_gas';
  if (/REVERT|BAD|DENIED|NOT_FOUND|DEPOSIT.*EXCEED/.test(c)) return 'failed_permanent';
  return 'retry';
}
