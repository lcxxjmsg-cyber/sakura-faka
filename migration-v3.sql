-- Run after migration-v2.sql. Adds the final guard against address reuse.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_address ON orders(address);
