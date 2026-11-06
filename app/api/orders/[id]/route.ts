import { paymentUser, paymentFailure, ownedOrder, publicOrder, paymentHeaders } from "@/lib/payments";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await paymentUser();
    return Response.json({ order: publicOrder(await ownedOrder((await context.params).id, user.userId)) }, { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
