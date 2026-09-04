import { USDT_TRC20_CONTRACT } from '@/lib/tron';

// ============================================================
// TRON Provider 抽象：业务不直接依赖 TronGrid URL。
// 所有方法返回 null 表示 RPC/网络错误（必须与"余额 0 / 无交易"区分开）。
// ============================================================

export type IncomingTransfer = {
  tx_hash: string;
  from: string;
  to: string;
  value: string;           // 最小单位整数
  block_number: number;
  timestamp: number;       // ms
  success: boolean;
};

export type SolidReceipt = {
  found: boolean;          // tx 是否已上链
  success: boolean;        // receipt.result === SUCCESS
  block_number: number;
  code: string;            // 失败时的错误码（OUT_OF_ENERGY/BANDWIDTH_REACHED/...）
};

export interface TronProvider {
  getLatestBlock(): Promise<number | null>;
  findIncomingTransfers(address: string, opts: { minTimestamp?: number; limit?: number }): Promise<IncomingTransfer[] | null>;
  getSolidReceipt(txHash: string): Promise<SolidReceipt | null>;
  getTrxBalance(address: string): Promise<number | null>;
  getUsdtBalance(address: string): Promise<number | null>;
}

const TIMEOUT = 8000;
const MAX_ATTEMPTS = 2;

async function jsonWithRetry(url: string, init: RequestInit = {}, apiKey?: string): Promise<any> {
  let lastErr: any = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), TIMEOUT);
      const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
      if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;
      const res = await fetch(url, { ...init, headers: { ...headers, ...((init.headers as any) || {}) }, signal: controller.signal });
      clearTimeout(t);
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const text = await res.text();
      try { return JSON.parse(text); } catch { return {}; }
    } catch (e: any) {
      lastErr = e;
      if (MAX_ATTEMPTS > 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr || new Error('rpc failed');
}

export class TronGridProvider implements TronProvider {
  constructor(private rpcUrl: string, private apiKey?: string) {}

  async getLatestBlock(): Promise<number | null> {
    for (const ep of [`${this.rpcUrl}/wallet/getnowblock`, `${this.rpcUrl}/v1/blocks/latest`]) {
      try {
        const d = await jsonWithRetry(ep, {}, this.apiKey);
        const num = d?.block_header?.raw_data?.number ?? d?.block?.block_header?.raw_data?.number ?? d?.number;
        if (typeof num === 'number') return num;
      } catch { continue; }
    }
    return null;
  }

  async findIncomingTransfers(address: string, opts: { minTimestamp?: number; limit?: number }): Promise<IncomingTransfer[] | null> {
    const params = new URLSearchParams({
      contract_address: USDT_TRC20_CONTRACT,
      only_to: 'true',
      limit: String(opts?.limit ?? 200),
    });
    if (opts?.minTimestamp) params.set('min_timestamp', String(Math.floor(opts.minTimestamp / 1)));
    try {
      const d = await jsonWithRetry(`${this.rpcUrl}/v1/accounts/${address}/transactions/trc20?${params.toString()}`, {}, this.apiKey);
      const txs = d?.data || [];
      return txs.map((tx: any) => ({
        tx_hash: tx.transaction_id || tx.hash || '',
        from: tx.from || '',
        to: tx.to || '',
        value: String(tx.value || '0'),
        block_number: Number(tx.blockNumber ?? tx.block ?? 0),
        timestamp: Number(tx.block_timestamp || 0),
        success: tx.contract_ret === undefined || tx.contract_ret === 'SUCCESS',
      })).filter((t: IncomingTransfer) => t.tx_hash);
    } catch {
      return null; // RPC error
    }
  }

  async getSolidReceipt(txHash: string): Promise<SolidReceipt | null> {
    try {
      const d = await jsonWithRetry(`${this.rpcUrl}/walletsolidity/gettransactioninfobyid`, { method: 'POST', body: JSON.stringify({ value: txHash }) }, this.apiKey);
      const block = Number(d?.blockNumber ?? 0);
      if (d?.id || d?.blockNumber !== undefined) {
        const success = d?.receipt?.result === 'SUCCESS' || (d?.ret?.[0]?.contractRet === 'SUCCESS');
        return { found: true, success, block_number: block, code: d?.receipt?.result || d?.ret?.[0]?.contractRet || '' };
      }
      return { found: false, success: false, block_number: 0, code: '' };
    } catch {
      return null; // RPC error
    }
  }

  async getTrxBalance(address: string): Promise<number | null> {
    try {
      const d = await jsonWithRetry(`${this.rpcUrl}/v1/accounts/${address}`, {}, this.apiKey);
      const acct = d?.data?.[0];
      if (!acct) return 0;
      return Number(acct.balance ?? 0);
    } catch { return null; }
  }

  async getUsdtBalance(address: string): Promise<number | null> {
    try {
      const d = await jsonWithRetry(`${this.rpcUrl}/v1/accounts/${address}`, {}, this.apiKey);
      const acct = d?.data?.[0];
      if (!acct) return 0;
      const hex = USDT_TRC20_CONTRACT.toLowerCase();
      const tok = (acct.trc20 || []).find((t: any) => {
        const id = String(t.tokenId || t.address || '').toLowerCase();
        return id === hex;
      });
      if (!tok) return 0;
      return Number(tok.balance ?? tok.value ?? 0);
    } catch { return null; }
  }
}

export function getTronProvider(rpcUrl: string, apiKey?: string): TronProvider {
  return new TronGridProvider(rpcUrl, apiKey);
}
