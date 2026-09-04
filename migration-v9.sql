-- Phase 1: 审计表（状态机、支付、Job）。老库升级用，全新安装直接用 schema.sql。
CREATE TABLE IF NOT EXISTS order_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  from_status TEXT DEFAULT '',
  to_status   TEXT DEFAULT '',
  metadata    TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL,
  tx_hash       TEXT DEFAULT '',
  event_type    TEXT NOT NULL,
  confirmations INTEGER DEFAULT 0,
  amount        TEXT DEFAULT '0',
  metadata      TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running',
  processed   INTEGER DEFAULT 0,
  failed      INTEGER DEFAULT 0,
  error       TEXT DEFAULT '',
  started_at  TEXT DEFAULT (datetime('now')),
  finished_at TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, started_at DESC);
