import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import type { StoreEnv } from '@/types';
import { deriveTronAddress, deriveMasterAddress } from '@/lib/tron';

// ============================================================
// 系统内置收款钱包管理
//
// 目的：让商家无需自行准备助记词/主钱包——后台一键生成，
//       系统自动保存、自动派生子地址、自动归集。资金与商家账户隔离。
//
// 安全模型（你选择的"系统保存并自动管理"）：
//   - 助记词保存于 D1 (wallet_meta)，只有登录管理员可查看/导出；
//   - 私钥仅参与派生与本地签名，永不发送给第三方；
//   - 请在设置页备份助记词，泄露即等于把钱交给别人。
// ============================================================

export type WalletMeta = {
  mnemonic: string;
  master_address: string;
  source: string;
  mnemonic_generated_at: string | null;
  updated_at: string;
};

async function getRow(env: StoreEnv): Promise<WalletMeta | null> {
  const row = await env.DB.prepare('SELECT * FROM wallet_meta WHERE id=1').first<WalletMeta>();
  return row ?? null;
}

// 优先使用环境变量 TRON_MNEMONIC（用户自备并覆盖），否则读取系统保存的助记词
export async function getWalletMnemonic(env: StoreEnv): Promise<string | null> {
  if (env.TRON_MNEMONIC) return env.TRON_MNEMONIC;
  const row = await getRow(env);
  return row?.mnemonic || null;
}

// 优先使用环境变量 TRON_MASTER_ADDRESS（用户自定义主钱包），否则读取系统内置主地址
export async function getMasterAddress(env: StoreEnv): Promise<string> {
  if (env.TRON_MASTER_ADDRESS) return env.TRON_MASTER_ADDRESS;
  const row = await getRow(env);
  return row?.master_address || '';
}

export async function generateWallet(env: StoreEnv): Promise<{ mnemonic: string; master_address: string }> {
  const mnemonic = generateMnemonic(wordlist, 128);
  const master_address = deriveMasterAddress(mnemonic);
  if (!master_address) throw new Error('主钱包地址派生失败');
  await saveRow(env, { mnemonic, master_address, source: 'system' });
  return { mnemonic, master_address };
}

async function saveRow(env: StoreEnv, meta: { mnemonic: string; master_address: string; source: string }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO wallet_meta (id, mnemonic, master_address, source, mnemonic_generated_at, updated_at)
     VALUES (1, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET mnemonic=excluded.mnemonic, master_address=excluded.master_address,
       source=excluded.source, mnemonic_generated_at=excluded.mnemonic_generated_at, updated_at=excluded.updated_at`,
  ).bind(meta.mnemonic, meta.master_address, meta.source).run();
}

// 导出备份后从系统清除助记词（保留主地址）。清除后无法再"重新派生子地址"或本地签名归集。
export async function clearWalletMnemonic(env: StoreEnv): Promise<void> {
  await env.DB.prepare(`UPDATE wallet_meta SET mnemonic='', updated_at=datetime('now') WHERE id=1`).run();
}

// 自我校验：若系统已保存助记词，用其派生的主地址是否一致（防篡改/异常）
export async function verifyWallet(env: StoreEnv): Promise<{ consistent: boolean }> {
  const row = await getRow(env);
  if (!row?.mnemonic || !row.master_address) return { consistent: true };
  const derived = deriveMasterAddress(row.mnemonic);
  return { consistent: derived === row.master_address };
}

// 概览：便于后台前端展示
export async function getWalletOverview(env: StoreEnv): Promise<{
  has_mnemonic: boolean;
  mnemonic: string | null;
  master_address: string;
  master_source: string; // 'env' | 'system' | ''
  has_custom_env: boolean;
  created_at: string | null;
  order_count: number;
  derived_sample: string | null;
}> {
  const [row, countRes] = await Promise.all([
    getRow(env),
    env.DB.prepare('SELECT COUNT(*) AS c FROM orders WHERE address<>?').bind('').first<{ c: number }>(),
  ]);
  const has_custom_env = !!env.TRON_MASTER_ADDRESS;
  const master_address = has_custom_env ? env.TRON_MASTER_ADDRESS : (row?.master_address || '');
  const master_source = has_custom_env ? 'env' : (row?.source || '');
  const derived_sample = row?.mnemonic ? deriveTronAddress(row.mnemonic, 0) : null;
  return {
    has_mnemonic: !!row?.mnemonic,
    mnemonic: row?.mnemonic || null,
    master_address,
    master_source,
    has_custom_env,
    created_at: row?.mnemonic_generated_at || null,
    order_count: countRes?.c ?? 0,
    derived_sample,
  };
}
