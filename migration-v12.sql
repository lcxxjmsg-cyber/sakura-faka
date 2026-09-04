-- P0-7: 卡密库 FK 修正。product_id 可空(NULL=未分配)，并加 ON DELETE SET NULL。
-- SQLite 不能直接改列约束，需重建表并保留数据（product_id=0 旧值迁移为 NULL）。
PRAGMA foreign_keys=OFF;

CREATE TABLE cards_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NULL,
  card        TEXT NOT NULL,
  status      INTEGER NOT NULL DEFAULT 0,
  order_id    TEXT NULL,
  sold_at     TEXT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

INSERT INTO cards_new (id, product_id, card, status, order_id, sold_at, created_at)
SELECT id, CASE WHEN product_id=0 THEN NULL ELSE product_id END, card, status, order_id, sold_at, created_at
FROM cards;

DROP TABLE cards;
ALTER TABLE cards_new RENAME TO cards;
CREATE INDEX IF NOT EXISTS idx_cards_product ON cards(product_id);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status, product_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cards_product_value ON cards(product_id, card);

PRAGMA foreign_keys=ON;
