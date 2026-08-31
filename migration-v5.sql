ALTER TABLE orders ADD COLUMN email_sent_at TEXT NULL;

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  refund_address TEXT NOT NULL,
  tx_hash TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

CREATE TABLE IF NOT EXISTS sweep_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  source_address TEXT NOT NULL,
  amount TEXT DEFAULT '0',
  asset TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
