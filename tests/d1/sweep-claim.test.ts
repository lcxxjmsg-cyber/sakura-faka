import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { D1Mem } from './d1mem';
import { claimSweep } from '@/lib/tron-sweep';

let db: D1Mem;

beforeAll(async () => {
  db = new D1Mem();
  await db.exec(readFileSync('schema.sql', 'utf8'));
});

async function seedTask(status = 'pending', extra = '') {
  await db.prepare('INSERT INTO sweep_tasks (order_id, source_address, to_address, amount, asset, address_index, product_title, status, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind('o1', 'Tsrc', 'Tdst', '1000000', 'USDT', 0, 'P', status, 'n').run();
  const row = await db.prepare('SELECT id FROM sweep_tasks ORDER BY id DESC LIMIT 1').first<any>();
  return row.id;
}

describe('sweep claim (CAS) concurrency', () => {
  it('only one claimer wins for the same task', async () => {
    const id = await seedTask();
    const [a, b] = await Promise.all([claimSweep(db, id), claimSweep(db, id)]);
    expect([a, b].filter(Boolean).length).toBe(1);
    const row = await db.prepare('SELECT status, lease_until FROM sweep_tasks WHERE id=?').bind(id).first<any>();
    expect(row.status).toBe('processing');
    expect(row.lease_until).toBeTruthy();
  });

  it('cannot claim an already-processing task before lease expiry', async () => {
    const id = await seedTask('processing');
    expect(await claimSweep(db, id)).toBe(false);
  });

  it('lease expiry releases the task back to pending', async () => {
    const id = await seedTask();
    await claimSweep(db, id); // -> processing + lease (90s future)
    // 手动把 lease 改到过去，模拟泄漏
    await db.prepare(`UPDATE sweep_tasks SET lease_until=? WHERE id=?`).bind(new Date(Date.now() - 5000).toISOString(), id).run();
    const now = new Date().toISOString();
    await db.prepare(`UPDATE sweep_tasks SET status='pending', lease_until=NULL, updated_at=? WHERE status='processing' AND lease_until IS NOT NULL AND lease_until<=?`).bind(now, now).run();
    const row = await db.prepare('SELECT status, lease_until FROM sweep_tasks WHERE id=?').bind(id).first<any>();
    expect(row.status).toBe('pending');
    expect(row.lease_until).toBeNull();
  });
});
