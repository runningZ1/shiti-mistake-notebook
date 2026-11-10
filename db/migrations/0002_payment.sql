ALTER TABLE users ADD COLUMN paid_ends_at timestamptz;

CREATE TABLE payment_orders (
  id text PRIMARY KEY CHECK (id ~ '^ST_[a-f0-9]{32}$'),
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  product_id text NOT NULL,
  product_name text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  currency text NOT NULL DEFAULT 'CNY' CHECK (currency = 'CNY'),
  source text NOT NULL,
  local_order_id text UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID')),
  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'DELIVERED', 'REVIEW')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  gateway_requested_at timestamptz,
  request_lease_until timestamptz,
  CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  CHECK (delivery_status = 'PENDING' OR status = 'PAID')
);
CREATE INDEX payment_orders_user_created_idx ON payment_orders(user_id, created_at DESC);
CREATE UNIQUE INDEX payment_orders_pending_user_idx ON payment_orders(user_id, source) WHERE status = 'PENDING';

CREATE TABLE payment_events (
  order_id text NOT NULL REFERENCES payment_orders(id),
  local_order_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (order_id, local_order_id)
);

CREATE TABLE payment_deliveries (
  order_id text PRIMARY KEY REFERENCES payment_orders(id),
  paid_ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
