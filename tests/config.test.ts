import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, DEFAULT_ADMIN_PASSWORD } from '@/lib/config';

describe('config password hashing', () => {
  it('hashes and verifies', () => {
    const stored = hashPassword('secret123', 'somesalt');
    expect(stored).toContain('somesalt:');
    expect(verifyPassword('secret123', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('rejects malformed stored value', () => {
    expect(verifyPassword('x', '')).toBe(false);
    expect(verifyPassword('x', 'nosaltnohash')).toBe(false);
  });

  it('default password constant is expected', () => {
    expect(DEFAULT_ADMIN_PASSWORD).toBe('faka8888');
  });
});
