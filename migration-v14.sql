-- P1-5: 多付/分多笔支付。orders 增加期望/实收/多付金额；旧订单回填 expected=total_price。
ALTER TABLE orders ADD COLUMN expected_amount TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN received_amount TEXT DEFAULT '';
ALTER TABLE orders ADD COLUMN overpaid_amount TEXT DEFAULT '';
UPDATE orders SET expected_amount=total_price WHERE expected_amount IS NULL OR expected_amount='';
