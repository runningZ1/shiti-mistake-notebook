import { transaction } from "@/db/client";
import { paymentConfig, paymentFailure, paymentHeaders } from "@/lib/payments";
import { PaymentError, verifyCallback } from "@/lib/payment-protocol";
import { recordCallback } from "@/lib/payment-store";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const config = paymentConfig();
    const reader = request.body?.getReader();
    if (!reader) throw new PaymentError("通知内容为空");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 8192) { await reader.cancel(); throw new PaymentError("通知内容过大", 413); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new PaymentError("通知必须为有效 JSON"); }
    const body = await verifyCallback(input, config.secret);
    await transaction(client => recordCallback(client, body, config.source));
    return Response.json({ success: true }, { headers: paymentHeaders });
  } catch (error) { return paymentFailure(error); }
}
