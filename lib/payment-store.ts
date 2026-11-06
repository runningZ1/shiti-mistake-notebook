import type { PoolClient } from "pg";
import { PaymentError, amountToCents, type PaymentCallback } from "./payment-protocol";

export type PaymentOrder = {
  id: string; user_id: string | null; product_id: string; product_name: string;
  amount_cents: number; duration_days: number; source: string; local_order_id: string | null;
  purpose: "MEMBERSHIP" | "TEST";
  status: "PENDING" | "PAID"; delivery_status: "PENDING" | "DELIVERED" | "REVIEW";
  created_at: string; paid_at: string | null; gateway_requested_at: string | null;
  request_lease_until: string | null;
};

/** Consistent account -> order lock order, including callbacks and gateway responses. */
export async function lockPayment(client: PoolClient, id: string): Promise<PaymentOrder> {
  const initial = await client.query<PaymentOrder>("SELECT * FROM payment_orders WHERE id=$1", [id]);
  if (!initial.rows[0]) throw new PaymentError("订单不存在", 404);
  if (initial.rows[0].user_id) await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [initial.rows[0].user_id]);
  const { rows } = await client.query<PaymentOrder>("SELECT * FROM payment_orders WHERE id=$1 FOR UPDATE", [id]);
  return rows[0];
}

export async function deliverPayment(client: PoolClient, order: PaymentOrder): Promise<void> {
  if (!order.local_order_id) return;
  const { rows: events } = await client.query(
    "SELECT * FROM payment_events WHERE order_id=$1 AND local_order_id=$2", [order.id, order.local_order_id]);
  if (!events[0] || order.status === "PAID") return;
  if (events[0].amount_cents !== order.amount_cents) throw new PaymentError("通知金额不匹配", 409);
  const { rows: users } = await client.query(
    "SELECT * FROM users WHERE id=$1 FOR UPDATE", [order.user_id]);
  const user = users[0];
  let delivery = "REVIEW";
  if (order.purpose === "TEST") {
    // Test receipts use the same verified payment path, but never grant membership.
    delivery = "DELIVERED";
  } else if (user && user.status === "active" && !user.deletion_started_at && user.role !== "admin" && user.trial_ends_at !== null) {
    const { rows } = await client.query(
      `UPDATE users SET paid_ends_at=greatest(clock_timestamp(), trial_ends_at, paid_ends_at)
       + ($2 * interval '1 day') WHERE id=$1 RETURNING paid_ends_at`, [order.user_id, order.duration_days]);
    await client.query("INSERT INTO payment_deliveries(order_id,paid_ends_at) VALUES($1,$2)", [order.id, rows[0].paid_ends_at]);
    delivery = "DELIVERED";
  }
  await client.query("UPDATE payment_orders SET status='PAID', paid_at=clock_timestamp(), delivery_status=$2 WHERE id=$1", [order.id, delivery]);
  await client.query("UPDATE payment_events SET processed_at=clock_timestamp() WHERE order_id=$1 AND local_order_id=$2", [order.id, order.local_order_id]);
}

export async function recordCallback(client: PoolClient, b: PaymentCallback, source: string): Promise<void> {
  const order = await lockPayment(client, b.externalOrderId);
  const cents = amountToCents(b.amount);
  if (order.source !== source || cents !== order.amount_cents || !order.gateway_requested_at ||
      (order.local_order_id !== null && order.local_order_id !== b.localOrderId)) {
    throw new PaymentError("订单来源、金额或支付映射不匹配", 409);
  }
  await client.query(`INSERT INTO payment_events(order_id,local_order_id,amount_cents) VALUES($1,$2,$3)
    ON CONFLICT(order_id,local_order_id) DO NOTHING`, [order.id, b.localOrderId, cents]);
  await deliverPayment(client, order);
}

export async function bindGateway(client: PoolClient, id: string, localOrderId: string, source: string): Promise<void> {
  const order = await lockPayment(client, id);
  if (order.source !== source || (order.local_order_id && order.local_order_id !== localOrderId)) {
    throw new PaymentError("支付订单映射冲突，请联系客服核对", 409);
  }
  const conflicts = await client.query("SELECT 1 FROM payment_events WHERE order_id=$1 AND local_order_id<>$2", [id, localOrderId]);
  if (conflicts.rowCount) throw new PaymentError("已收到不同支付映射的通知，需要核对", 409);
  await client.query("UPDATE payment_orders SET local_order_id=$2, request_lease_until=NULL WHERE id=$1", [id, localOrderId]);
  await deliverPayment(client, { ...order, local_order_id: localOrderId });
}
