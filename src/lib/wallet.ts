import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import type { StoreEnv } from '@/types';
import { deriveMasterAddress } from '@/lib/tron';
import { encryptMnemonic, decryptMnemonic } from '@/domain/wallet/wallet.crypto';

// ============================================================
// 系统内置收款钱包管理（安全版）
//
// 安全模型：
//   - 助记词只以 AES-256-GCM 加密形式存于 D1（encrypted_mnemonic），
//     密钥是 Cloudflare Secret WALLET_ENCRYPTION_KEY，绝不存 D1、不写日志。
//   - 生成时完整助记词仅返回一次；之后后台只能看到省略号。
//   - 重新导出需要重新验证管理员密码（预留 TOTP 二次认证）。
//   - 外部助记词（环境变量 TRON_MNEMONIC）优先，且不落库。
//   - 主钱包地址为公开地址，明文存储。
// ============================================================

export type WalletMeta = {
  encrypted_mnemonic: string;
  mnemonic: string;            // 老库兼容
  master_address: string;
  source: string;
  mnemonic_generated_at: string | null;
  updated_at: string;
};

async function getRow(env: StoreEnv): Promise<WalletMeta | null> {
  const row = await env.DB.prepare('SELECT * FROM wallet_meta WHERE id=1').first<WalletMeta>();
  return row ?? null;
}

// 读取可用助记词：优先外部环境变量；否则解密存储值；老库明文则立即加密迁移
export async function getWalletMnemonic(env: StoreEnv): Promise<string | null> {
  if (env.TRON_MNEMONIC) return env.TRON_MNEMONIC;
  const row = await getRow(env);
  if (!row) return null;

  if (row.encrypted_mnemonic) {
    if (!env.WALLET_ENCRYPTION_KEY) return null; // 无密钥无法解密，视为未初始化
    try { return await decryptMnemonic(row.encrypted_mnemonic, env.WALLET_ENCRYPTION_KEY); }
    catch { return null; }
  }

  // 老库明文：若配置了密钥则加密迁移；否则视为未初始化（避免明文化）
  if (row.mnemonic) {
    if (!env.WALLET_ENCRYPTION_KEY) return null;
    try {
      const enc = await encryptMnemonic(row.mnemonic, env.WALLET_ENCRYPTION_KEY);
      await env.DB.prepare(`UPDATE wallet_meta SET encrypted_mnemonic=?, mnemonic='', updated_at=datetime('now') WHERE id=1`).bind(enc).run();
      return row.mnemonic;
    } catch { return null; }
  }
  return null;
}

// 归集目标主钱包：优先环境变量，否则读取系统内置（公开地址）
export async function getMasterAddress(env: StoreEnv): Promise<string> {
  if (env.TRON_MASTER_ADDRESS) return env.TRON_MASTER_ADDRESS;
  const row = await getRow(env);
  return row?.master_address || '';
}

export async function generateWallet(env: StoreEnv): Promise<{ mnemonic: string; master_address: string }> {
  if (!env.WALLET_ENCRYPTION_KEY) {
    throw new Error('为安全起见，请先在 Cloudflare Secrets 配置 WALLET_ENCRYPTION_KEY 后再生成钱包');
  }
  const mnemonic = generateMnemonic(wordlist, 128);
  const master_address = deriveMasterAddress(mnemonic);
  if (!master_address) throw new Error('主钱包地址派生失败');
  const encrypted = await encryptMnemonic(mnemonic, env.WALLET_ENCRYPTION_KEY);
  await saveRow(env, { encrypted, master_address, source: 'system' });
  return { mnemonic, master_address };
}

async function saveRow(env: StoreEnv, meta: { encrypted: string; master_address: string; source: string }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO wallet_meta (id, encrypted_mnemonic, mnemonic, master_address, source, mnemonic_generated_at, updated_at)
     VALUES (1, ?, '', ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET encrypted_mnemonic=excluded.encrypted_mnemonic, mnemonic='',
       master_address=excluded.master_address, source=excluded.source,
       mnemonic_generated_at=excluded.mnemonic_generated_at, updated_at=excluded.updated_at`,
  ).bind(meta.encrypted, meta.master_address, meta.source).run();
}

// 清除助记词（保留主地址）
export async function clearWalletMnemonic(env: StoreEnv): Promise<void> {
  await env.DB.prepare(`UPDATE wallet_meta SET encrypted_mnemonic='', mnemonic='', updated_at=datetime('now') WHERE id=1`).run();
}

// 重新导出助记词（调用方必须先完成密码/二次认证）
export async function revealMnemonic(env: StoreEnv): Promise<string | null> {
  const row = await getRow(env);
  if (row?.encrypted_mnemonic) {
    if (!env.WALLET_ENCRYPTION_KEY) return null;
    try { return await decryptMnemonic(row.encrypted_mnemonic, env.WALLET_ENCRYPTION_KEY); }
    catch { return null; }
  }
  return row?.mnemonic || null;
}

// 一致性自检：无需解密的公开部分
export function verifyWalletStructure(env: StoreEnv, row: WalletMeta | null): { consistent: boolean } {
  if (!row) return { consistent: true };
  return { consistent: !row.master_address || row.master_address.startsWith('T') };
}

// 概览（绝不返回明文助记词）
export async function getWalletOverview(env: StoreEnv): Promise<{
  has_mnemonic: boolean;
  mnemonic_masked: string | null;
  master_address: string;
  master_source: string;
  has_custom_env: boolean;   // 是否配置了外部 TRON_MNEMONIC（无需保存助记词）
  has_encryption_key: boolean;
  created_at: string | null;
  order_count: number;
}> {
  const [row, countRes] = await Promise.all([
    getRow(env),
    env.DB.prepare('SELECT COUNT(*) AS c FROM orders WHERE address<>?').bind('').first<{ c: number }>(),
  ]);
  const has_custom_env = !!env.TRON_MNEMONIC;
  const master_address = env.TRON_MASTER_ADDRESS || (row?.master_address || '');
  const master_source = env.TRON_MASTER_ADDRESS ? 'env' : (row?.source || '');
  const has_encryption_key = !!env.WALLET_ENCRYPTION_KEY;
  const has_mnemonic = has_custom_env || !!row?.encrypted_mnemonic || !!row?.mnemonic;
  return {
    has_mnemonic,
    mnemonic_masked: has_mnemonic ? '••••••••••••' : null,
    master_address,
    master_source,
    has_custom_env,
    has_encryption_key,
    created_at: row?.mnemonic_generated_at || null,
    order_count: countRes?.c ?? 0,
  };
}
