-- ============================================================
-- 樱花市集 主数据库 Schema (Cloudflare D1)
-- 面向: 商品/订单/卡密/设置/分站
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,                -- 商品标题
  description TEXT DEFAULT '',              -- 商品说明(HTML)
  cover       TEXT DEFAULT '',              -- 封面图URL
  price       TEXT NOT NULL,                -- USDT价格(以最小单位整数存储，避免浮点)
  stock       INTEGER NOT NULL DEFAULT 0,   -- 库存(卡密数)
  sold        INTEGER NOT NULL DEFAULT 0,   -- 已售数量
  category    TEXT DEFAULT '',              -- 分类
  status      INTEGER NOT NULL DEFAULT 1,   -- 1上架 0下架
  sort        INTEGER NOT NULL DEFAULT 0,   -- 排序权重
  delivery_type TEXT NOT NULL DEFAULT 'text',
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  card        TEXT NOT NULL,                -- 卡密内容
  status      INTEGER NOT NULL DEFAULT 0,   -- 0未售 1已售
  order_id    TEXT NULL,
  sold_at     TEXT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_product ON cards(product_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cards_product_value ON cards(product_id, card);

-- 订单-卡密关联表（替代 orders.card_ids 逗号字符串）
CREATE TABLE IF NOT EXISTS order_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL,
  card_id     INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(card_id),
  UNIQUE(order_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_order_cards_order ON order_cards(order_id);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,             -- 订单号(唯一)
  product_id  INTEGER NOT NULL,
  product_title TEXT NOT NULL,              -- 冗余商品标题
  qty         INTEGER NOT NULL DEFAULT 1,   -- 数量
  total_price TEXT NOT NULL,                -- 应付USDT(最小单位整数)
  address     TEXT NOT NULL,                -- 收款地址(每订单唯一子地址)
  address_index INTEGER NOT NULL DEFAULT -1,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending/paid/closed/shipped
  tx_hash     TEXT DEFAULT '',              -- 链上交易哈希
  tx_confirm  INTEGER DEFAULT 0,            -- 已确认数
  contact_email TEXT DEFAULT '',            -- 可选买家邮箱
  view_token    TEXT DEFAULT '',            -- 查看卡密的私密token(仅下单时返回买家)
  card_ids    TEXT DEFAULT '',              -- 关联卡密id列表(逗号分隔)
  created_at  TEXT DEFAULT (datetime('now')),
  paid_at     TEXT NULL,
  expired_at  TEXT NULL,
  email_sent_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_address ON orders(address);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_address ON orders(address);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  from_address TEXT DEFAULT '',
  to_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'detected',
  detected_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_payment_order ON payment_transactions(order_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tx_hash ON orders(tx_hash) WHERE tx_hash IS NOT NULL AND tx_hash <> '';

-- 记录已分配的 HD 子地址 index，用于加速地址分配
CREATE TABLE IF NOT EXISTS orders_index (
  id          INTEGER PRIMARY KEY,          -- 恒为1
  last_index  INTEGER NOT NULL DEFAULT -1
);

CREATE TABLE IF NOT EXISTS settings (
  key     TEXT PRIMARY KEY,
  value   TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  action     TEXT NOT NULL,                 -- 操作内容
  created_at TEXT DEFAULT (datetime('now'))
);

-- 退款申请/记录
CREATE TABLE IF NOT EXISTS refunds (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT NOT NULL,
  amount         TEXT NOT NULL,             -- 退款金额(最小单位整数)
  refund_address TEXT NOT NULL,             -- 退款地址
  tx_hash        TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'requested',
  note           TEXT DEFAULT '',
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id);

-- 资金归集任务：订单发货后自动创建，等待(自动/手动)归集到主钱包
CREATE TABLE IF NOT EXISTS sweep_tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       TEXT,
  source_address TEXT NOT NULL,             -- 作为收款子地址
  to_address     TEXT DEFAULT '',           -- 归集目标(主钱包)
  amount         TEXT DEFAULT '0',          -- 待归集金额(最小单位整数)
  asset          TEXT NOT NULL DEFAULT 'USDT',
  address_index  INTEGER DEFAULT -1,        -- HD 派生索引(用于本地签名)
  product_title  TEXT DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending', -- pending/need_gas/ready/broadcasting/confirming/retry/completed/failed
  tx_hash        TEXT DEFAULT '',
  retry_count    INTEGER DEFAULT 0,
  next_retry_at  TEXT NULL,
  last_error     TEXT DEFAULT '',
  broadcast_at   TEXT NULL,
  confirmed_at   TEXT NULL,
  note           TEXT DEFAULT '',
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sweep_status ON sweep_tasks(status);
CREATE INDEX IF NOT EXISTS idx_sweep_address ON sweep_tasks(source_address);

-- 订单状态事件审计（所有状态变更统一记录）
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

-- 支付事件审计（detected / confirmed / failed / provider_error）
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

-- 定时 Job 执行记录
CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job         TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running', -- running/finished/failed
  processed   INTEGER DEFAULT 0,
  failed      INTEGER DEFAULT 0,
  error       TEXT DEFAULT '',
  started_at  TEXT DEFAULT (datetime('now')),
  finished_at TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs(job, started_at DESC);

-- 系统内置收款钱包元信息（单行表, id 恒为 1）
-- encrypted_mnemonic: AES-256-GCM 加密后的助记词（密钥为 Secret WALLET_ENCRYPTION_KEY，绝不存 D1）
-- master_address: 归集目标主钱包（公开地址）；也可由环境变量 TRON_MASTER_ADDRESS 覆盖
-- mnemonic: 仅为老库兼容保留（升级后迁移到 encrypted_mnemonic 并置空）
CREATE TABLE IF NOT EXISTS wallet_meta (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  encrypted_mnemonic   TEXT DEFAULT '',
  mnemonic             TEXT DEFAULT '',
  master_address       TEXT DEFAULT '',
  source               TEXT DEFAULT '',   -- 'system' | '' (custom/env)
  mnemonic_generated_at TEXT NULL,
  updated_at           TEXT DEFAULT (datetime('now'))
);
