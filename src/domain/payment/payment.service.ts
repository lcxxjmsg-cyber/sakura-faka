import type { TronPaymentCheck } from '@/lib/tron';
import type { TronProvider } from './tron.provider';

// 确认支付：只把"已上链且 receipt.result===SUCCESS"的交易视为有效付款。
// RPC 错误（provider 返回 null）→ provider_ok=false（绝不能当成"未付款"）。
export async function checkOrderPaymentOnChain(
  provider: TronProvider,
  address: string,
  required: string,
  minConfirmations: number,
  createdAt?: string,
): Promise<TronPaymentCheck> {
  const err = (code: string, message: string): TronPaymentCheck => ({
    provider_ok: false, found: false, confirmed: false, confirmations: 0,
    tx_hash: '', from_address: '', to_address: address, value: '0', block_number: 0, error_code: code, error_message: message,
  });
  const notFound = (): TronPaymentCheck => ({
    provider_ok: true, found: false, confirmed: false, confirmations: 0,
    tx_hash: '', from_address: '', to_address: address, value: '0', block_number: 0, error_code: '', error_message: '',
  });

  const latestBlock = await provider.getLatestBlock();
  if (latestBlock === null) return err('RPC_BLOCK', '无法获取最新区块高度');

  const transfers = await provider.findIncomingTransfers(address, {
    minTimestamp: createdAt ? Date.parse(createdAt) - 120000 : undefined,
    limit: 200,
  });
  if (transfers === null) return err('RPC_LIST', '获取收款记录失败');

  const requiredBig = BigInt(required);
  let best: { tx_hash: string; from: string; value: string } | null = null;
  let bestValue = 0n;
  for (const t of transfers) {
    if (t.value === undefined) continue;
    let val: bigint;
    try { val = BigInt(t.value); } catch { continue; }
    if (val < requiredBig) continue;
    if (val > bestValue) { bestValue = val; best = { tx_hash: t.tx_hash, from: t.from, value: t.value }; }
  }
  if (!best) return notFound();

  // 必须通过 SolidityNode receipt 校验交易确实成功
  const receipt = await provider.getSolidReceipt(best.tx_hash);
  if (receipt === null) return err('RPC_RECEIPT', '无法获取交易回执');
  if (!receipt.found) return notFound();
  if (!receipt.success) return notFound();

  const txBlock = receipt.block_number;
  const confirmations = txBlock > 0 ? Math.max(1, latestBlock - txBlock + 1) : 0;
  return {
    provider_ok: true,
    found: true,
    confirmed: confirmations >= minConfirmations,
    confirmations,
    tx_hash: best.tx_hash,
    from_address: best.from,
    to_address: address,
    value: bestValue.toString(),
    block_number: txBlock,
    error_code: '',
    error_message: '',
  };
}

// 根据 solid receipt 失败码归类：临时（重试/补能量）或 永久失败
export function classifyReceiptFailure(code: string): 'retry' | 'need_gas' | 'failed_permanent' {
  const c = String(code || '').toUpperCase();
  if (/OUT_OF_ENERGY|BANDWIDTH|TRANSFER.*FAIL|SIGNATURE|INVALID/.test(c)) return 'need_gas';
  if (/REVERT|BAD|DENIED|NOT_FOUND|DEPOSIT.*EXCEED/.test(c)) return 'failed_permanent';
  return 'retry';
}
