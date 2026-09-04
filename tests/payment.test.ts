import { describe, it, expect } from 'vitest';
import { checkOrderPaymentOnChain, classifyReceiptFailure } from '@/domain/payment/payment.service';
import type { TronProvider } from '@/domain/payment/tron.provider';

function mockProvider(over: Partial<TronProvider>): TronProvider {
  return { getLatestBlock: async () => 100, findIncomingTransfers: async () => [], getSolidReceipt: async () => ({ found: true, success: true, block_number: 80, code: '' }), getTrxBalance: async () => 1, getUsdtBalance: async () => 0, ...over };
}

const tx = { tx_hash: 'abc', from: 'Tfrom', to: 'Tto', value: '1000000', block_number: 80, timestamp: 1, success: true };
const okReceipt = { found: true, success: true, block_number: 80, code: '' };

describe('classifyReceiptFailure', () => {
  it('maps resource errors to need_gas/retry, structural to failed_permanent', () => {
    expect(classifyReceiptFailure('OUT_OF_ENERGY')).toBe('need_gas');
    expect(classifyReceiptFailure('BANDWIDTH')).toBe('need_gas');
    expect(classifyReceiptFailure('REVERT')).toBe('failed_permanent');
    expect(classifyReceiptFailure('BAD')).toBe('failed_permanent');
    expect(classifyReceiptFailure('SOMETHING_ELSE')).toBe('retry');
    expect(classifyReceiptFailure('')).toBe('retry');
  });
});

describe('checkOrderPaymentOnChain', () => {
  it('confirms only after solid receipt SUCCESS and computes confirmations', async () => {
    const provider = mockProvider({
      findIncomingTransfers: async () => [tx],
      getSolidReceipt: async () => okReceipt,
    });
    const r = await checkOrderPaymentOnChain(provider, 'Tto', '1000000', 19, '2020-01-01');
    expect(r.provider_ok).toBe(true);
    expect(r.found).toBe(true);
    expect(r.confirmed).toBe(true); // 100-80+1 = 21 >= 19
    expect(r.confirmations).toBe(21);
    expect(r.tx_hash).toBe('abc');
    expect(r.value).toBe('1000000');
  });

  it('does NOT confirm when receipt says the tx failed', async () => {
    const provider = mockProvider({
      findIncomingTransfers: async () => [tx],
      getSolidReceipt: async () => ({ found: true, success: false, block_number: 80, code: 'REVERT' }),
    });
    const r = await checkOrderPaymentOnChain(provider, 'Tto', '1000000', 19, '2020-01-01');
    expect(r.found).toBe(false);
    expect(r.confirmed).toBe(false);
  });

  it('provider_ok=false on RPC list error (not treated as unpaid)', async () => {
    const provider = mockProvider({ findIncomingTransfers: async () => null });
    const r = await checkOrderPaymentOnChain(provider, 'Tto', '1000000', 19, '2020-01-01');
    expect(r.provider_ok).toBe(false);
    expect(r.error_code).toBe('RPC_LIST');
  });

  it('notFound when amount < required', async () => {
    const provider = mockProvider({ findIncomingTransfers: async () => [{ ...tx, value: '50000' }] });
    const r = await checkOrderPaymentOnChain(provider, 'Tto', '1000000', 19, '2020-01-01');
    expect(r.found).toBe(false);
  });
});
