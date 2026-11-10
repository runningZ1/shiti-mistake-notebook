import { redirect } from "next/navigation";
import { getSessionUser, chatGPTSignInPath } from "@/app/chatgpt-auth";
import { paymentAvailable } from "@/lib/payments";
import PaymentContent from "../payment-content";
import "../payment.css";
export const dynamic = "force-dynamic";
export default async function PaymentResultPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const params = await searchParams;
  const orderId = typeof params.order === "string" ? params.order : undefined;
  const user = await getSessionUser();
  if (!user) redirect(chatGPTSignInPath(`/payment/result${orderId ? `?order=${encodeURIComponent(orderId)}` : ""}`));
  return <PaymentContent name={user.displayName} available={paymentAvailable()} longTerm={user.role === "admin" || user.trialEndsAt === null} result orderId={orderId} />;
}
