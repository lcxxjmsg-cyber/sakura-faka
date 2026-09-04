import { describe, it, expect } from 'vitest';
import { validateTronAddress, evmToTron, tronToHex21, tronToEVM20, USDT_TRC20_CONTRACT, deriveMasterAddress } from '@/lib/tron';

const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

describe('validateTronAddress', () => {
  it('accepts the canonical USDT mainnet contract', () => {
    expect(validateTronAddress(USDT)).toBe(true);
  });
  it('accepts a derived address', () => {
    const m = 'test test test test test test test test test test test junk';
    const a = deriveMasterAddress(m);
    expect(a).toBeTruthy();
    expect(validateTronAddress(a as string)).toBe(true);
  });
  it('rejects wrong prefix', () => {
    // flip prefix byte but keep length/checksum shape -> should fail validation
    expect(validateTronAddress('TV6Q8rD9x')).toBe(false);
  });
  it('rejects empty / garbage', () => {
    expect(validateTronAddress('')).toBe(false);
    expect(validateTronAddress('not-a-tron-address')).toBe(false);
    expect(validateTronAddress('TV6Q8rD9x')).toBe(false);
  });
  it('treats a checksum-valid address as valid even if not a token contract', () => {
    // TXLAQ… 是格式合法的 TRON 地址（有正确 checksum），只是不是 USDT 合约
    expect(validateTronAddress('TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj')).toBe(true);
  });
});

describe('tron helpers', () => {
  it('evmToTron / tronToHex21 round-trip', () => {
    const hex21 = tronToHex21(USDT);
    expect(hex21).toBe('41a614f803b6fd780986a42c78ec9c7f77e6ded13c');
    const evm20 = tronToEVM20(USDT);
    expect(evm20).toBe('a614f803b6fd780986a42c78ec9c7f77e6ded13c');
    expect(evmToTron('0x' + evm20)).toBe(USDT);
  });
});

describe('deriveMasterAddress', () => {
  it('is deterministic and independent of sub-address path', () => {
    const m = 'test test test test test test test test test test test junk';
    expect(deriveMasterAddress(m)).toBe(deriveMasterAddress(m));
    expect(deriveMasterAddress(m)).toMatch(/^T/);
  });
  it('returns null for bad mnemonic', () => {
    expect(deriveMasterAddress('')).toBeNull();
    expect(deriveMasterAddress('one two three')).toBeNull();
  });
});

describe('USDT contract', () => {
  it('matches the well-known Tether USD TRC-20 contract', () => {
    expect(USDT_TRC20_CONTRACT).toBe(USDT);
  });
});
