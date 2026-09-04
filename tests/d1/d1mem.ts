import { DatabaseSync } from 'node:sqlite';

// 真实 SQLite(内存) 实现的 D1Database 兼容层：prepare/bind/run/first/all/batch(事务)/exec。
// 用于在 vitest node 环境跑集成测试，验证事务原子性与状态机（与 Cloudflare D1 的 SQL 语义一致）。

class D1Stmt {
  db: DatabaseSync;
  sql: string;
  params: any[];
  constructor(db: DatabaseSync, sql: string, params: any[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...args: any[]) {
    return new D1Stmt(this.db, this.sql, args.length ? args : this.params);
  }
  private toParams() {
    return this.params.map((p) => (p === undefined ? null : p));
  }
  async run() {
    return this.runSync();
  }
  runSync() {
    const st = this.db.prepare(this.sql);
    const info = st.run(...this.toParams());
    return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async first() {
    const st = this.db.prepare(this.sql);
    return st.get(...this.toParams()) ?? null;
  }
  async all() {
    const st = this.db.prepare(this.sql);
    const rows = st.all(...this.toParams());
    return { success: true, results: rows };
  }
}

export class D1Mem {
  db: DatabaseSync;
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec('PRAGMA journal_mode=WAL');
  }
  prepare(sql: string) {
    return new D1Stmt(this.db, sql, []);
  }
  async exec(sql: string) {
    this.db.exec(sql);
  }
  async batch(stmts: any[]) {
    // 同步执行整个事务（BEGIN..COMMIT 之间不让出事件循环），避免嵌套事务
    this.db.exec('BEGIN');
    try {
      const out: any[] = [];
      for (const s of stmts) out.push(s.runSync());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
