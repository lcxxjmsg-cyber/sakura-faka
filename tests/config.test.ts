import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/config';
import { sha256 } from '@noble/hashes/sha2.js';

function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

describe('config password hashing (PBKDF2)', () => {
  it('round-trips with PBKDF2 format', async () => {
    const stored = await hashPassword('secret123');
    expect(stored).toMatch(/^p1:[a-f0-9]{32}:/);
    expect(await verifyPassword('secret123', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('generates a fresh salt each time (no plaintext reuse)', async () => {
    const a = await hashPassword('secret123');
    const b = await hashPassword('secret123');
    expect(a).not.toBe(b);
  });

  it('rejects malformed stored value', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'nosaltnohash')).toBe(false);
  });

  it('verifies legacy (single SHA-256) stored hashes for migration', async () => {
    const salt = 'oldsalt';
    const hash = bytesToHex(sha256(new TextEncoder().encode(`${salt}::secret123`)));
    expect(await verifyPassword('secret123', `${salt}:${hash}`)).toBe(true);
    expect(await verifyPassword('wrong', `${salt}:${hash}`)).toBe(false);
  });
});
