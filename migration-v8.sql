-- 系统内置收款钱包元信息（单行表）。老库升级用，替换/补充 schema.sql 中已包含的定义。
CREATE TABLE IF NOT EXISTS wallet_meta (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  mnemonic             TEXT DEFAULT '',
  master_address       TEXT DEFAULT '',
  source               TEXT DEFAULT '',
  mnemonic_generated_at TEXT NULL,
  updated_at           TEXT DEFAULT (datetime('now'))
);
