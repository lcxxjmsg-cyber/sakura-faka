-- 对已部署数据库(AUTO 归集前)补充 sweep_tasks 新字段。
-- 若全新安装请直接使用 schema.sql，无需本迁移。
ALTER TABLE sweep_tasks ADD COLUMN to_address TEXT DEFAULT '';
ALTER TABLE sweep_tasks ADD COLUMN address_index INTEGER DEFAULT -1;
ALTER TABLE sweep_tasks ADD COLUMN product_title TEXT DEFAULT '';
