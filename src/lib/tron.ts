import { ethers } from 'ethers';

// ============================================================
// USDT (TRC-20) 钱包与去中心化支付核心
//
// 原理：
//   - TRON 链上的账户与 EVM 地址通用（base58check 编码 0x 地址，前缀 T）
//   - 用 HD 钱包 (BIP-44, coin type 195 = TRON) 从助记词派生子地址
//   - 每个订单分配一个唯一子地址，天然对应订单
//   - 通过 TRON Grid RPC 查询该地址的 USDT (TRC-20) 转账记录确认到账
//
// TRC-20 USDT 官方合约地址（主网）：
//   TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj
// ============================================================

export const USDT_TRC20_CONTRACT = 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj';
export const TRON_DECIMALS = 6;

const TRON_BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// EVM 地址 -> TRON 地址（加前缀 T 并做 base58check）
export function evmToTron(evmAddr: string): string {
  const clean = evmAddr.replace(/^0x/, '').toLowerCase();
  const payload = Buffer.from('41' + clean, 'hex');
  const check1 = Buffer.from(ethers.keccak256(payload).slice(2), 'hex');
  const check2 = Buffer.from(ethers.keccak256(check1).slice(2), 'hex').subarray(0, 4);
  const full = Buffer.concat([payload, check2]);
  return base58encode(full);
}

function base58encode(buf: Buffer): string {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let result = '';
  for (const byte of buf) {
    if (byte === 0) result += '1';
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) result += TRON_BASE58[digits[i]];
  return result;
}

// 从助记词派生第 index 个 TRON 地址（BIP-44, TRON coin = 195）
export function deriveTronAddress(mnemonic: string, index: number): string | null {
  try {
    if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12) return null;
    const path = `m/44'/195'/0'/0/${index}`;
    const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    return evmToTron(wallet.address);
  } catch (e) {
    return null;
  }
}

// 从助记词派生第 index 个地址的私钥（用于日后续做归集签名）
export function deriveTronPrivateKey(mnemonic: string, index: number): string | null {
  try {
    const path = `m/44'/195'/0'/0/${index}`;
    const wallet = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, path);
    return wallet.privateKey;
  } catch (e) {
    return null;
  }
}

// ============================================================
// 链上监听：查询某子地址的 USDT(TRC-20) 到账确认情况
//
// 返回值说明：
//   { found, txHash, value, confirmed }
//   - found: 是否发现匹配金额的转账
//   - confirmed: 是否达到所需确认数
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
    // 获取当前链高度（用于计算交易确认数）。多个端点做容错。
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
      // 校验合约地址为 USDT (TRC-20)
      if (tx.token_info?.address?.toLowerCase() !== USDT_TRC20_CONTRACT.toLowerCase()) continue;
      // 校验收款方向正确
      if (tx.to?.toLowerCase() !== address.toLowerCase()) continue;

      const valueStr = tx.value || '0';
      let val: bigint;
      try {
        val = BigInt(valueStr);
      } catch {
        continue;
      }
      // 允许 ±5% 的误差（用户可能多转一点）
      const requiredBig = BigInt(required);
      const minOk = val >= (requiredBig * 95n) / 100n;
      if (!minOk) continue;

      if (val > bestValue) {
        bestValue = val;
        best = tx;
      }
    }

    if (!best) return notFound;

    // TRON Grid 的 trc20 接口不返回 confirmations，需用 blockNumber 与当前高度比对
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

// 获取 TRON 最新区块高度；失败返回 null（做多端点容错）
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

// ============================================================
// 归集：把子地址余额转到主收款地址（需私钥签名）
// 仅做参考实现；实际归集建议配合 tronweb / 委托能量，避免高额能量费
// ============================================================
export function buildSweepTx(_rpcUrl: string, _from: string, _to: string, _value: string, _privateKey: string) {
  // 占位：真实实现需构建 TRON 合约调用交易（trongrid 需要 TRX 能量）
  // 为保持项目初期简单，归集建议手动操作或接入第三方支付网关
  return { ready: false, reason: '需额外接入 tronweb 构建交易' };
}
