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
//   TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
// ============================================================

export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
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

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '').trim();
  if (clean.length % 2 !== 0) throw new Error('无效 hex');
  return Uint8Array.from(clean.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? []);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// base58 解码 (用于把 T 开头的 TRON 地址转回原始字节)
export function base58Decode(str: string): Uint8Array {
  const ALPHABET = BASE58_ALPHABET;
  const map: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i]] = i;
  let num = 0n;
  for (const ch of str.trim()) {
    const idx = map[ch];
    if (idx === undefined) throw new Error('非法 base58 字符');
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  const body = hexToBytes(hex);
  // 补回前导零(对应 base58 里的 '1')
  let lead = 0;
  for (const ch of str.trim()) { if (ch === '1') lead++; else break; }
  const out = new Uint8Array(lead + body.length);
  out.set(body, lead);
  return out;
}

// TRON 地址 -> '41' + 后20字节 hex (用于 owner_address / contract_address)
export function tronToHex21(address: string): string {
  return bytesToHex(base58Decode(address).slice(0, 21));
}

// TRON 地址 -> 20 字节 hex (不带 0x41 前缀, 用于合约参数中的 to)
export function tronToEVM20(address: string): string {
  return bytesToHex(base58Decode(address).slice(1, 21));
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
export function deriveTronAddressInfo(mnemonic: string, index: number): { address: string; evm20: string } | null {
  try {
    if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) return null;
    const seed = mnemonicToSeedSync(mnemonic);
    const hd = HDKey.fromMasterSeed(seed);
    const child = hd.derive(`m/44'/195'/0'/0/${index}'`);
    if (!child.privateKey) return null;
    // secp256k1 未压缩公钥（65字节，含 04 前缀）→ keccak256 → 取后20字节 → EVM 地址
    const uncompressed = secp256k1.getPublicKey(child.privateKey, false);
    const hash = keccak_256(uncompressed.subarray(1));
    const evm20 = Array.from(hash.subarray(12), (b) => b.toString(16).padStart(2, '0')).join('');
    return { address: evmToTron('0x' + evm20), evm20 };
  } catch (e) {
    return null;
  }
}

export function deriveTronAddress(mnemonic: string, index: number): string | null {
  return deriveTronAddressInfo(mnemonic, index)?.address ?? null;
}

// 派生"主钱包/归集目标"地址：使用账户级路径 m/44'/195'/0'，
// 与订单子地址路径 m/44'/195'/0'/0/{index}' 完全隔离，因此永不相交。
export function deriveMasterAddress(mnemonic: string): string | null {
  try {
    if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) return null;
    const seed = mnemonicToSeedSync(mnemonic);
    const hd = HDKey.fromMasterSeed(seed);
    const child = hd.derive(`m/44'/195'/0'`);
    if (!child.privateKey) return null;
    const uncompressed = secp256k1.getPublicKey(child.privateKey, false);
    const hash = keccak_256(uncompressed.subarray(1));
    const evm20 = Array.from(hash.subarray(12), (b) => b.toString(16).padStart(2, '0')).join('');
    return evmToTron('0x' + evm20);
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
// TRON 地址严格校验：Base58 合法、解码长度、0x41 前缀、checksum、canonical
// ============================================================
export function validateTronAddress(address: string): boolean {
  try {
    const raw = base58Decode(address);
    if (raw.length !== 25) return false;
    if (raw[0] !== 0x41) return false;
    const payload = raw.slice(0, 21);
    const ck1 = sha256Bytes(payload);
    const ck2 = sha256Bytes(ck1);
    for (let i = 0; i < 4; i++) if (raw[21 + i] !== ck2[i]) return false;
    return evmToTron('0x' + bytesToHex(payload.slice(1))) === address;
  } catch {
    return false;
  }
}

// ============================================================
// 链上监听：查询某子地址的 USDT(TRC-20) 到账确认情况
// provider_ok=false 表示 RPC 出错（网络/超时），绝不能当作"未付款"。
// ============================================================
export type TronPaymentCheck = {
  provider_ok: boolean;
  found: boolean;
  confirmed: boolean;
  confirmations: number;
  tx_hash: string;
  from_address: string;
  to_address: string;
  value: string; // 最小单位整数
  block_number: number;
  error_code: string;
  error_message: string;
};

const RPC_FETCH_TIMEOUT_MS = 8000;
const RPC_MAX_ATTEMPTS = 2;

async function fetchJsonWithRetry(url: string, attempts = RPC_MAX_ATTEMPTS): Promise<any> {
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), RPC_FETCH_TIMEOUT_MS);
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      return await res.json();
    } catch (e: any) {
      lastErr = e;
      if (attempts > 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr || new Error('request failed');
}

export async function checkUsdtPayment(
  rpcUrl: string,
  address: string,
  required: string,    // 最小单位整数
  minConfirmations: number,
  createdAt?: string,
): Promise<TronPaymentCheck> {
  const err = (code: string, message: string): TronPaymentCheck => ({
    provider_ok: false, found: false, confirmed: false, confirmations: 0,
    tx_hash: '', from_address: '', to_address: address, value: '0', block_number: 0,
    error_code: code, error_message: message,
  });
  const notFound = (): TronPaymentCheck => ({
    provider_ok: true, found: false, confirmed: false, confirmations: 0,
    tx_hash: '', from_address: '', to_address: address, value: '0', block_number: 0,
    error_code: '', error_message: '',
  });

  try {
    const latestBlock = await getLatestBlockHeight(rpcUrl);
    if (latestBlock === null) return err('RPC_BLOCK', '无法获取最新区块高度');
    const data: any = await fetchJsonWithRetry(`${rpcUrl}/v1/accounts/${address}/transactions/trc20`);
    const txs = data?.data || [];

    let best: any = null;
    let bestValue = 0n;
    for (const tx of txs) {
      if (String(tx.token_info?.address ?? '').toLowerCase() !== USDT_TRC20_CONTRACT.toLowerCase()) continue;
      if (String(tx.to ?? '').toLowerCase() !== address.toLowerCase()) continue;
      if (tx.contract_ret !== 'SUCCESS' && tx.contract_ret !== undefined) continue;
      let val: bigint;
      try { val = BigInt(tx.value || '0'); } catch { continue; }
      if (val < BigInt(required)) continue; // 必须足额，避免少付触发
      if (createdAt && tx.block_timestamp && Number(tx.block_timestamp) < Date.parse(createdAt) - 120000) continue;
      if (val > bestValue) { bestValue = val; best = tx; }
    }

    if (!best) return notFound();

    const txBlock = Number(best.blockNumber ?? best.block ?? 0);
    const confirmations = txBlock > 0 ? Math.max(1, latestBlock - txBlock + 1) : 0;
    return {
      provider_ok: true,
      found: true,
      confirmed: confirmations >= minConfirmations,
      confirmations,
      tx_hash: best.transaction_id || best.hash || '',
      from_address: best.from || '',
      to_address: address,
      value: bestValue.toString(),
      block_number: txBlock,
      error_code: '',
      error_message: '',
    };
  } catch (e: any) {
    return err('RPC_ERROR', e?.message || String(e));
  }
}

async function getLatestBlockHeight(rpcUrl: string): Promise<number | null> {
  const endpoints = [`${rpcUrl}/wallet/getnowblock`, `${rpcUrl}/v1/blocks/latest`];
  for (const url of endpoints) {
    try {
      const data: any = await fetchJsonWithRetry(url, 1);
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
