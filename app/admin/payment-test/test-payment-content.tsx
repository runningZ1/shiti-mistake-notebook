"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Order = { id: string; amount: string; status: "PENDING" | "PAID"; deliveryStatus: string };
type Result = { orders?: Order[]; order?: Order; available?: boolean; paymentUrl?: string; error?: string };
async function api(url: string, amount?: string): Promise<Result> {
  const response = await fetch(url, { method: amount === undefined ? "GET" : "POST",
    cache: "no-store", credentials: "same-origin",
    headers: amount === undefined ? undefined : { "Content-Type": "application/json" },
    body: amount === undefined ? undefined : JSON.stringify({ amount }) });
  const body = await response.json() as Result;
  if (!response.ok) throw new Error(body.error || "支付服务暂不可用");
  return body;
}

export default function TestPaymentContent({ name, initialAvailable }: { name: string; initialAvailable: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState("0.01");
  const [orders, setOrders] = useState<Order[]>([]);
  const [available, setAvailable] = useState(initialAvailable);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    const result = await api("/api/admin/payment-test");
    setOrders(result.orders || []);
    setAvailable(result.available === true);
  }, []);
  useEffect(() => {
    let active = true;
    void api("/api/admin/payment-test").then(result => {
      if (!active) return;
      setOrders(result.orders || []);
      setAvailable(result.available === true);
    }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);

  async function pay(orderId?: string) {
    if (busy) return;
    if (!orderId && (!/^\d{1,3}(?:\.\d{1,2})?$/.test(amount) || Number(amount) < 0.01 || Number(amount) > 100)) {
      setMessage("请输入0.01～100元，最多两位小数，例如0.01或1.00。"); return;
    }
    setBusy(true); setMessage("");
    try {
      const id = orderId || (await api("/api/admin/payment-test", amount)).order?.id;
      if (!id) throw new Error("支付服务未返回订单号");
      const response = await fetch(`/api/orders/${encodeURIComponent(id)}/pay`, { method: "POST", credentials: "same-origin", cache: "no-store" });
      const result = await response.json() as Result;
      if (!response.ok) throw new Error(result.error || "暂时无法发起付款，请重试同一订单");
      if (result.paymentUrl) {
        const url = new URL(result.paymentUrl);
        if (url.origin !== "https://openapi.alipay.com" || url.pathname !== "/gateway.do" || url.username || url.password) throw new Error("付款链接无效");
        window.location.assign(url.href);
      } else { router.push(`/payment/result?order=${encodeURIComponent(id)}`); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "付款入口暂不可用");
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }

  return <div className="pricing-page"><main className="payment-main">
    <nav><Link href="/admin">← 返回管理后台</Link></nav>
    <section className="payment-card">
      <span className="pricing-kicker">管理员专用 · 支付联调</span>
      <h1>支付宝小额支付测试</h1>
      <p>当前管理员：<strong>{name}</strong></p>
      <p>这是实际收款测试，付款后会真实扣款。测试订单不增加会员天数，不自动退款。</p>
      <p>使用电脑浏览器付款。支付完成后，请查看订单结果，只有服务端核对成功才显示“已确认到账”。</p>
      {!available && <p className="payment-message" role="status">测试支付尚未开放。请等待支付维护者开放接口，并配置共享密钥和测试开关后再操作。</p>}
      <form onSubmit={event => { event.preventDefault(); void pay(); }}>
        <label htmlFor="test-payment-amount">支付金额（人民币元，0.01～100）</label>
        <input id="test-payment-amount" className="payment-amount-input" type="number" min="0.01" max="100" step="0.01" inputMode="decimal"
          required value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} />
        <div className="payment-presets">{["0.01", "0.10", "1.00"].map(value => <button type="button" key={value} disabled={busy} onClick={() => setAmount(value)}>¥{value}</button>)}</div>
        <button className="pricing-cta-button primary" disabled={busy || !available}>{busy ? "正在生成付款入口…" : `前往支付宝支付 ¥${amount || "0.01"}`}</button>
      </form>
      {message && <p className="payment-message" role="alert">{message}</p>}
    </section>
    <section className="payment-card"><h2>我的测试订单</h2><p>同一金额的待付款订单会复用，避免网络重试产生新订单。已付款请勿再次支付。</p>
      <button className="payment-refresh" disabled={busy} onClick={() => { void refresh().catch(error => setMessage(error.message)); }}>刷新收款状态</button>
      {orders.length === 0 ? <p>暂无测试订单。</p> : <ul className="payment-orders">{orders.map(order => <li key={order.id}>
        <div><strong>¥{order.amount}</strong><p>{order.status === "PAID" ? "已确认到账 · 不含会员权益" : "待付款／待确认"}</p><p className="payment-id">{order.id}</p></div>
        <div><Link href={`/payment/result?order=${encodeURIComponent(order.id)}`}>查看结果</Link>{order.status === "PENDING" && <button disabled={busy || !available} onClick={() => void pay(order.id)}>继续支付 ¥{order.amount}</button>}</div>
      </li>)}</ul>}
    </section>
  </main></div>;
}
