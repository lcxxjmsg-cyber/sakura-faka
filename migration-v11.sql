-- Phase 2: 归集状态机与规范化
-- 1) 给 sweep_tasks 补充重试/确认字段
-- 2) 新增 order_cards 关联表（替代 cards.order_id 依赖的 card_ids 逗号字符串）
-- 全新安装直接使用 schema.sql，无需本迁移。

ALTER TABLE sweep_tasks ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE sweep_tasks ADD COLUMN next_retry_at TEXT NULL;
ALTER TABLE sweep_tasks ADD COLUMN last_error TEXT DEFAULT '';
ALTER TABLE sweep_tasks ADD COLUMN broadcast_at TEXT NULL;
ALTER TABLE sweep_tasks ADD COLUMN confirmed_at TEXT NULL;

CREATE TABLE IF NOT EXISTS order_cards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    TEXT NOT NULL,
  card_id     INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(card_id),
  UNIQUE(order_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_order_cards_order ON order_cards(order_id);
