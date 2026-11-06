import { requireAdmin } from "@/app/chatgpt-auth";
import { paymentAvailable } from "@/lib/payments";
import TestPaymentContent from "./test-payment-content";
import "../../payment/payment.css";
export const dynamic = "force-dynamic";
export default async function TestPaymentPage() {
  const user = await requireAdmin("/admin/payment-test");
  return <TestPaymentContent name={user.displayName} initialAvailable={paymentAvailable("TEST")} />;
}
