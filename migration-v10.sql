-- Phase 1: wallet_meta 加密化升级。给已部署老库补充 encrypted_mnemonic 列。
-- 全新安装直接使用 schema.sql（已含 encrypted_mnemonic），无需本迁移。
ALTER TABLE wallet_meta ADD COLUMN encrypted_mnemonic TEXT DEFAULT '';
