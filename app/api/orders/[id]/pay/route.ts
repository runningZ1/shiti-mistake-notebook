import { paymentUser, paymentFailure, payOrder, paymentHeaders } from "@/lib/payments";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await paymentUser(request);
    return Response.json(await payOrder((await context.params).id, user.userId), { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
