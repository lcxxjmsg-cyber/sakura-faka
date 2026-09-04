import { describe, it, expect } from 'vitest';
import { encryptMnemonic, decryptMnemonic } from '@/domain/wallet/wallet.crypto';

const MNEMONIC = 'test test test test test test test test test test test junk';

describe('wallet.crypto (AES-GCM)', () => {
  it('round-trips mnemonic', async () => {
    const key = 'a-strong-random-key-1234567890';
    const enc = await encryptMnemonic(MNEMONIC, key);
    expect(enc).toContain(':');
    const dec = await decryptMnemonic(enc, key);
    expect(dec).toBe(MNEMONIC);
  });

  it('fails to decrypt with the wrong key', async () => {
    const enc = await encryptMnemonic(MNEMONIC, 'correct-key-000000');
    await expect(decryptMnemonic(enc, 'wrong-key-111111')).rejects.toThrow();
  });

  it('fails to decrypt tampered ciphertext', async () => {
    const enc = await encryptMnemonic(MNEMONIC, 'key-abcdefghijklmnop');
    const [iv, ct] = enc.split(':');
    const tampered = iv + ':' + ct.slice(0, -4) + 'AAAA';
    await expect(decryptMnemonic(tampered, 'key-abcdefghijklmnop')).rejects.toThrow();
  });

  it('rejects missing key for encryption', async () => {
    await expect(encryptMnemonic(MNEMONIC, '')).rejects.toThrow(/WALLET_ENCRYPTION_KEY/);
  });
});
