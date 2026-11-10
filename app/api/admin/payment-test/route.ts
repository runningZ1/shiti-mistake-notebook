import { query } from "@/db/client";
import { createTestOrder, paymentUser, paymentFailure, paymentHeaders, publicOrder, paymentAvailable } from "@/lib/payments";
import { PaymentError } from "@/lib/payment-protocol";
import type { PaymentOrder } from "@/lib/payment-store";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await paymentUser();
    if (user.role !== "admin") throw new PaymentError("需要管理员权限", 403);
    const { rows } = await query<PaymentOrder>(`SELECT * FROM payment_orders
      WHERE user_id=$1 AND purpose='TEST' ORDER BY created_at DESC,id DESC LIMIT 50`, [user.userId]);
    return Response.json({ orders: rows.map(publicOrder), available: paymentAvailable("TEST") }, { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}

export async function POST(request: Request) {
  try {
    const user = await paymentUser(request);
    if (user.role !== "admin") throw new PaymentError("需要管理员权限", 403);
    const length = request.headers.get("content-length");
    if (length && Number(length) > 1024) throw new PaymentError("请求过大", 413);
    const text = await request.text();
    if (text.length > 1024) throw new PaymentError("请求过大", 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new PaymentError("金额请求格式错误"); }
    const amount = body && typeof body === "object" && "amount" in body ? body.amount : undefined;
    const order = await createTestOrder(user.userId, amount);
    return Response.json({ order: publicOrder(order) }, { status: 201, headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
