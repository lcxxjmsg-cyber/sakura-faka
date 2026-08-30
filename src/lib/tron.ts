import { keccak_256 } from '@noble/hashes/sha3.js';
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';

// ============================================================
// USDT (TRC-20) 钱包与去中心化支付核心
//
// 说明：本文件使用 @noble/* 和 @scure/* (纯 JS 加密库, 兼容 Cloudflare Workers)
// 而不用 ethers —— 因为 ethers 依赖 Node API, 在 Workers 运行时无法加载。
//
// TRON 地址派生标准：
//   - 助记词 -> BIP39 种子
//   - 通过 BIP32 (SLIP-0010 / ed25519 harden-only) 派生私钥 (coin type 195 = TRON)
//   - 私钥 -> secp256k1/ed25519 公钥
//   - 公钥 -> keccak256 -> 取后20字节 -> 加 0x41 前缀 -> base58check -> 地址 (T开头)
//
// TRC-20 USDT 官方合约地址（主网）：
//   TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj
// ============================================================

export const USDT_TRC20_CONTRACT = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
export const TRON_DECIMALS = 6;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ============ base58 / base58check ============
function base58Encode(data: Uint8Array): string {
  let digits: number[] = [0];
  for (const byte of data) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] * 256;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (const byte of data) {
    if (byte === 0) result += '1';
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) result += BASE58_ALPHABET[digits[i]];
  return result;
}

// 计算 keccak256 (用于地址派生)
function keccak(hexStr: string): Uint8Array {
  return keccak_256(Uint8Array.from(hexStr.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []));
}

// 计算 sha256 (base58check 校验用)
function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

// EVM 地址 -> TRON 地址（加 0x41 前缀 + base58check）
export function evmToTron(evmAddr: string): string {
  const clean = evmAddr.replace(/^0x/, '').padStart(40, '0');
  const payload = new Uint8Array(21);
  payload[0] = 0x41;
  const addrBytes = Uint8Array.from(clean.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
  payload.set(addrBytes, 1);
  const check1 = sha256Bytes(payload);
  const check2 = sha256Bytes(check1);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload, 0);
  full.set(check2.slice(0, 4), payload.length);
  return base58Encode(full);
}

// ============ HD 派生 (BIP32 / SLIP-0010 ed25519) ============
// 从助记词派生第 index 个 TRON 地址（BIP44, coin type 195）
export function deriveTronAddress(mnemonic: string, index: number): string | null {
  try {
    if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) return null;
    const seed = mnemonicToSeedSync(mnemonic);
    const hd = HDKey.fromMasterSeed(seed);
    const child = hd.derive(`m/44'/195'/0'/0/${index}'`);
    if (!child.privateKey) return null;
    // secp256k1 未压缩公钥（65字节，含 04 前缀）→ keccak256 → 取后20字节 → EVM 地址
    const uncompressed = secp256k1.getPublicKey(child.privateKey, false);
    const hash = keccak_256(uncompressed.subarray(1));
    const evmAddr = '0x' + Array.from(hash.subarray(12), (b) => b.toString(16).padStart(2, '0')).join('');
    return evmToTron(evmAddr);
  } catch (e) {
    return null;
  }
}

// 从助记词派生第 index 个地址的私钥（用于日后续做归集签名）
export function deriveTronPrivateKey(mnemonic: string, index: number): string | null {
  try {
    if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) return null;
    const seed = mnemonicToSeedSync(mnemonic);
    const hd = HDKey.fromMasterSeed(seed);
    const child = hd.derive(`m/44'/195'/0'/0/${index}'`);
    if (!child.privateKey) return null;
    return Array.from(child.privateKey, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    return null;
  }
}

// ============================================================
// 链上监听：查询某子地址的 USDT(TRC-20) 到账确认情况
// ============================================================
export type TronPaymentCheck = {
  found: boolean;
  txHash: string;
  value: string; // 最小单位整数
  confirmed: boolean;
  confirmations: number;
};

export async function checkUsdtPayment(
  rpcUrl: string,
  address: string,
  required: string,    // 最小单位整数
  minConfirmations: number,
): Promise<TronPaymentCheck> {
  const notFound: TronPaymentCheck = {
    found: false,
    txHash: '',
    value: '0',
    confirmed: false,
    confirmations: 0,
  };

  try {
    // 获取当前链高度（用于计算交易确认数）
    const latestBlock = await getLatestBlockHeight(rpcUrl);
    if (latestBlock === null) return notFound;

    const res = await fetch(`${rpcUrl}/v1/accounts/${address}/transactions/trc20`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return notFound;
    const data: any = await res.json();
    const txs = data?.data || [];

    let best: any = null;
    let bestValue = 0n;
    for (const tx of txs) {
      if (tx.token_info?.address?.toLowerCase() !== USDT_TRC20_CONTRACT.toLowerCase()) continue;
      if (tx.to?.toLowerCase() !== address.toLowerCase()) continue;

      const valueStr = tx.value || '0';
      let val: bigint;
      try {
        val = BigInt(valueStr);
      } catch {
        continue;
      }
      const requiredBig = BigInt(required);
      const minOk = val >= (requiredBig * 95n) / 100n;
      if (!minOk) continue;

      if (val > bestValue) {
        bestValue = val;
        best = tx;
      }
    }

    if (!best) return notFound;

    const txBlock = Number(best.blockNumber ?? best.block ?? 0);
    const confirmations = txBlock > 0 ? Math.max(1, latestBlock - txBlock + 1) : 0;
    return {
      found: true,
      txHash: best.transaction_id || best.hash || '',
      value: bestValue.toString(),
      confirmed: confirmations >= minConfirmations,
      confirmations,
    };
  } catch (e) {
    return notFound;
  }
}

async function getLatestBlockHeight(rpcUrl: string): Promise<number | null> {
  const endpoints = [
    `${rpcUrl}/wallet/getnowblock`,
    `${rpcUrl}/v1/blocks/latest`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const data: any = await res.json();
      const num = data?.block_header?.raw_data?.number ?? data?.block?.block_header?.raw_data?.number ?? data?.number;
      if (typeof num === 'number') return num;
    } catch {
      continue;
    }
  }
  return null;
}

export function buildSweepTx(_rpcUrl: string, _from: string, _to: string, _value: string, _privateKey: string) {
  return { ready: false, reason: '需额外接入 tronweb 构建交易' };
}
