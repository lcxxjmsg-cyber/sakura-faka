// ============================================================
// 助记词加密：AES-256-GCM，密钥由 Cloudflare Secret WALLET_ENCRYPTION_KEY 派生。
// 仅加密助记词（私密），主钱包地址是公开地址，无需加密。
// 存储格式：base64(iv):base64(ciphertext+tag)
// ============================================================

const enc = new TextEncoder();
const dec = new TextDecoder();
const PBKDF2_SALT = 'sakura-faka-v1';
const PBKDF2_ITERATIONS = 100000;

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function deriveAesKey(keyStr: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(keyStr), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(PBKDF2_SALT), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptMnemonic(mnemonic: string, keyStr: string): Promise<string> {
  if (!keyStr) throw new Error('WALLET_ENCRYPTION_KEY 未配置');
  const key = await deriveAesKey(keyStr);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(mnemonic));
  return `${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

export async function decryptMnemonic(stored: string, keyStr: string): Promise<string> {
  const parts = String(stored || '').split(':');
  if (parts.length !== 2) throw new Error('加密数据格式错误');
  const key = await deriveAesKey(keyStr);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(parts[0]) },
    key,
    unb64(parts[1]),
  );
  return dec.decode(plain);
}

export function canEncrypt(keyStr: string): boolean {
  return !!keyStr;
}
