import { query } from "@/db/client";
import { createOrder, paymentUser, paymentFailure, publicOrder, paymentHeaders } from "@/lib/payments";
import type { PaymentOrder } from "@/lib/payment-store";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await paymentUser();
    const { rows } = await query<PaymentOrder>("SELECT * FROM payment_orders WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 50", [user.userId]);
    return Response.json({ orders: rows.map(publicOrder) }, { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await paymentUser(request);
    return Response.json({ order: publicOrder(await createOrder(user.userId)) }, { status: 201, headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
