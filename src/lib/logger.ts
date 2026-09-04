import type { StoreEnv } from '@/types';

// 统一异步任务日志（避免裸 console / 静默吞错）。绝不记录敏感字段。
export const logger = {
  info: (msg: string, ctx: Record<string, unknown> = {}) => log('info', msg, ctx),
  warn: (msg: string, ctx: Record<string, unknown> = {}) => log('warn', msg, ctx),
  error: (msg: string, ctx: Record<string, unknown> = {}) => log('error', msg, ctx),
};

function log(level: string, msg: string, ctx: Record<string, unknown>) {
  try { console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...sanitize(ctx) })); }
  catch { /* ignore */ }
}

// 关键：任何日志不得泄漏 mnemonic / private key / session / encryption key
const BLOCKED_KEYS = new Set(['mnemonic', 'privatekey', 'private_key', 'session', 'sid', 'encryptionkey', 'encryption_key', 'password', 'token', 'api_key', 'secret']);
function sanitize(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx || {})) {
    if (BLOCKED_KEYS.has(k.toLowerCase())) { out[k] = '***'; continue; }
    out[k] = typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '…' : v;
  }
  return out;
}
