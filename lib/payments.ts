import { env } from "cloudflare:workers";
import { query, transaction } from "@/db/client";
import { getSessionUser } from "@/app/chatgpt-auth";
import { isSameOriginRequest } from "@/lib/auth";
import { PaymentError, signPayment, centsToAmount, amountToCents, alipayDestination } from "./payment-protocol";
import { bindGateway, lockPayment, type PaymentOrder } from "./payment-store";

export const MONTH_CARD = { id: "vip-30-days", name: "拾题 VIP 畅学月卡（30天）", amountCents: 9900, days: 30 } as const;
export const PAYMENT_SOURCE = "study.chumenclub.com";
export const paymentHeaders = { "Cache-Control": "no-store" };

export function paymentAvailable(purpose: "MEMBERSHIP" | "TEST" = "MEMBERSHIP"): boolean {
  try { paymentConfig(true, purpose); return true; } catch { return false; }
}
export function paymentConfig(requireEnabled = false, purpose: "MEMBERSHIP" | "TEST" = "MEMBERSHIP") {
  const enabled = purpose === "TEST" ? env.PAYMENT_TEST_ENABLED : env.PAYMENT_ENABLED;
  if (requireEnabled && enabled !== "true") throw new PaymentError(purpose === "TEST" ? "支付测试尚未开放，请等待支付方开放并配置测试开关" : "支付宝支付尚未开放，请稍后再试", 503);
  if (!env.PAYMENT_SHARED_SECRET || env.PAYMENT_SOURCE !== PAYMENT_SOURCE ||
      env.PAYMENT_GATEWAY_URL !== "https://skills.chumenclub.com/api/cross-site-payment/create" ||
      env.PAYMENT_RETURN_URL !== "https://study.chumenclub.com/payment/result") {
    throw new PaymentError("支付服务尚未配置完成", 503);
  }
  return { secret: env.PAYMENT_SHARED_SECRET, source: env.PAYMENT_SOURCE,
    gatewayUrl: env.PAYMENT_GATEWAY_URL, returnUrl: env.PAYMENT_RETURN_URL };
}
export async function paymentUser(request?: Request) {
  if (request && !isSameOriginRequest(request)) throw new PaymentError("不允许跨站操作", 403);
  const user = await getSessionUser();
  if (!user) throw new PaymentError("请先登录", 401);
  return user;
}
export function paymentFailure(error: unknown): Response {
  return Response.json({ error: error instanceof PaymentError ? error.message : "支付服务暂不可用，请稍后重试" },
    { status: error instanceof PaymentError ? error.status : 503, headers: paymentHeaders });
}
export function publicOrder(order: PaymentOrder) {
  return { id: order.id, productName: order.product_name, amount: centsToAmount(order.amount_cents),
    purpose: order.purpose,
    status: order.status, deliveryStatus: order.delivery_status, createdAt: order.created_at, paidAt: order.paid_at };
}
export async function createOrder(userId: string): Promise<PaymentOrder> {
  paymentConfig(true);
  return transaction(async client => {
    const { rows: users } = await client.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const user = users[0];
    if (!user || user.status !== "active" || user.deletion_started_at) throw new PaymentError("账号不可用", 403);
    if (user.role === "admin" || user.trial_ends_at === null) throw new PaymentError("当前账号已拥有长期权限，无需购买", 409);
    const existing = await client.query<PaymentOrder>("SELECT * FROM payment_orders WHERE user_id=$1 AND source=$2 AND purpose='MEMBERSHIP' AND status='PENDING'", [userId, PAYMENT_SOURCE]);
    if (existing.rows[0]) return existing.rows[0];
    const id = `ST_${crypto.randomUUID().replaceAll("-", "")}`;
    const { rows } = await client.query<PaymentOrder>(`INSERT INTO payment_orders
      (id,user_id,product_id,product_name,amount_cents,duration_days,source) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [id, userId, MONTH_CARD.id, MONTH_CARD.name, MONTH_CARD.amountCents, MONTH_CARD.days, PAYMENT_SOURCE]);
    return rows[0];
  });
}
export async function ownedOrder(id: string, userId: string): Promise<PaymentOrder> {
  const { rows } = await query<PaymentOrder>("SELECT * FROM payment_orders WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!rows[0]) throw new PaymentError("订单不存在", 404);
  return rows[0];
}
export async function createTestOrder(userId: string, amount: unknown): Promise<PaymentOrder> {
  paymentConfig(true, "TEST");
  if (typeof amount !== "string") throw new PaymentError("请填写人民币金额，如0.01");
  const text = amount.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) throw new PaymentError("金额最多保留两位小数");
  const cents = amountToCents(text.includes(".") ? text : `${text}.00`);
  if (cents > 10000) throw new PaymentError("测试金额须为0.01～100元");
  return transaction(async client => {
    const { rows: users } = await client.query("SELECT role,status,deletion_started_at FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const user = users[0];
    if (!user || user.role !== "admin" || user.status !== "active" || user.deletion_started_at) throw new PaymentError("需要管理员权限", 403);
    const existing = await client.query<PaymentOrder>(`SELECT * FROM payment_orders
      WHERE user_id=$1 AND source=$2 AND purpose='TEST' AND amount_cents=$3 AND status='PENDING'`, [userId, PAYMENT_SOURCE, cents]);
    if (existing.rows[0]) return existing.rows[0];
    const { rows } = await client.query<PaymentOrder>(`INSERT INTO payment_orders
      (id,user_id,product_id,product_name,amount_cents,duration_days,source,purpose)
      VALUES($1,$2,'payment-test','拾题支付宝支付测试（不含会员权益）',$3,0,$4,'TEST') RETURNING *`,
    [`ST_${crypto.randomUUID().replaceAll("-", "")}`, userId, cents, PAYMENT_SOURCE]);
    return rows[0];
  });
}
export async function payOrder(id: string, userId: string) {
  const order = await transaction(async client => {
    const own = await client.query("SELECT id FROM payment_orders WHERE id=$1 AND user_id=$2", [id, userId]);
    if (!own.rowCount) throw new PaymentError("订单不存在", 404);
    const current = await lockPayment(client, id);
    const { rows } = await client.query("SELECT * FROM users WHERE id=$1", [userId]);
    const user = rows[0];
    if (!user || user.status !== "active" || user.deletion_started_at || current.user_id !== userId) throw new PaymentError("账号不可用", 403);
    if (current.purpose === "TEST" && user.role !== "admin") throw new PaymentError("需要管理员权限", 403);
    if (current.status === "PAID") return current;
    const config = paymentConfig(true, current.purpose);
    if (current.purpose !== "TEST" && (user.role === "admin" || user.trial_ends_at === null)) throw new PaymentError("当前账号已拥有长期权限，无需购买", 409);
    if (current.source !== config.source) throw new PaymentError("订单来源不匹配", 409);
    const leased = await client.query(`UPDATE payment_orders SET gateway_requested_at=coalesce(gateway_requested_at,clock_timestamp()),
      request_lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1
      AND (request_lease_until IS NULL OR request_lease_until < clock_timestamp()) RETURNING id`, [id]);
    if (!leased.rowCount) throw new PaymentError("正在生成付款入口，请稍后重试同一订单", 409);
    return current;
  });
  if (order.status === "PAID") return { order: publicOrder(order), needsReconciliation: false };
  const config = paymentConfig(true, order.purpose);
  try {
    const body = { externalOrderId: order.id, amount: centsToAmount(order.amount_cents), source: config.source,
      timestamp: Date.now(), returnUrl: config.returnUrl, productName: order.product_name, userId };
    const signature = await signPayment(body.externalOrderId + body.amount + body.source + body.timestamp, config.secret);
    const response = await fetch(config.gatewayUrl, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, signature }), signal: AbortSignal.timeout(15000), redirect: "manual" });
    if (!response.ok) throw new PaymentError("暂时无法生成付款入口，请重试同一订单", 502);
    const result = await response.json() as Record<string, unknown>;
    if (result.success !== true || typeof result.localOrderId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(result.localOrderId)) {
      throw new PaymentError("支付服务返回无效订单，请稍后重试", 502);
    }
    await transaction(client => bindGateway(client, id, result.localOrderId as string, config.source));
    const refreshed = await ownedOrder(id, userId);
    if (refreshed.status === "PAID") return { order: publicOrder(refreshed) };
    if (!result.paymentUrl) return { order: publicOrder(refreshed), needsReconciliation: true };
    return { order: publicOrder(refreshed), paymentUrl: alipayDestination(result.paymentUrl) };
  } finally {
    await query("UPDATE payment_orders SET request_lease_until=NULL WHERE id=$1", [id]);
  }
}
