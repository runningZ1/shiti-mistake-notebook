ALTER TABLE payment_orders ADD COLUMN purpose text NOT NULL DEFAULT 'MEMBERSHIP'
  CHECK (purpose IN ('MEMBERSHIP', 'TEST'));
ALTER TABLE payment_orders DROP CONSTRAINT payment_orders_duration_days_check;
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_duration_days_check
  CHECK ((purpose = 'TEST' AND duration_days = 0) OR (purpose = 'MEMBERSHIP' AND duration_days > 0));
ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_test_amount_check
  CHECK (purpose <> 'TEST' OR amount_cents BETWEEN 1 AND 10000);
DROP INDEX payment_orders_pending_user_idx;
CREATE UNIQUE INDEX payment_orders_pending_user_idx
  ON payment_orders(user_id, source, purpose, amount_cents) WHERE status = 'PENDING';
