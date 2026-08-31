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
  order_id    INTEGER NULL,
  sold_at     TEXT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_cards_product ON cards(product_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cards_product_value ON cards(product_id, card);

CREATE TABLE IF NOT EXISTS orders (
  id          TEXT PRIMARY KEY,             -- 订单号(唯一)
  product_id  INTEGER NOT NULL,
  product_title TEXT NOT NULL,              -- 冗余商品标题
  qty         INTEGER NOT NULL DEFAULT 1,   -- 数量
  total_price TEXT NOT NULL,                -- 应付USDT(最小单位整数)
  address     TEXT NOT NULL,                -- 收款地址(每订单唯一子地址)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending/paid/closed/shipped
  tx_hash     TEXT DEFAULT '',              -- 链上交易哈希
  tx_confirm  INTEGER DEFAULT 0,            -- 已确认数
  contact_email TEXT DEFAULT '',            -- 可选买家邮箱
  view_token    TEXT DEFAULT '',            -- 查看卡密的私密token(仅下单时返回买家)
  card_ids    TEXT DEFAULT '',              -- 关联卡密id列表(逗号分隔)
  created_at  TEXT DEFAULT (datetime('now')),
  paid_at     TEXT NULL,
  expired_at  TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_address ON orders(address);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
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
