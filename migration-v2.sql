-- Run once against an existing D1 database before deploying v2.
ALTER TABLE products ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'text';
DELETE FROM cards WHERE status=0 AND id NOT IN (SELECT MIN(id) FROM cards WHERE status=0 GROUP BY product_id, card);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cards_product_value ON cards(product_id, card);
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_tx_hash ON orders(tx_hash) WHERE tx_hash IS NOT NULL AND tx_hash <> '';
UPDATE products SET stock=(SELECT COUNT(*) FROM cards WHERE cards.product_id=products.id AND status=0);
