"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- vinext beta 实测 next/link 客户端跳转抛错，使用原生链接整页导航。 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ShieldCheck } from "lucide-react";

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
  const [amount, setAmount] = useState("0.01");
  const [orders, setOrders] = useState<Order[]>([]);
  const [available, setAvailable] = useState(initialAvailable);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api("/api/admin/payment-test");
      setOrders(result.orders || []);
      setAvailable(result.available === true);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void api("/api/admin/payment-test").then(result => {
      if (!active) return;
      setOrders(result.orders || []);
      setAvailable(result.available === true);
    }).catch(error => { if (active) setMessage(error.message); }).finally(() => { if (active) setLoading(false); });
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
      } else { window.location.assign(`/payment/result?order=${encodeURIComponent(id)}`); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "付款入口暂不可用");
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }

  return <div className="payment-page">
    <header className="payment-header">
      <a className="payment-brand" href="/"><span className="payment-brand-mark"><BookOpen size={22} aria-hidden="true" /></span><strong>拾题</strong><small>管理后台</small></a>
      <a className="payment-nav-link" href="/admin"><ArrowLeft size={16} aria-hidden="true" /> 返回后台</a>
    </header>
    <main className="payment-main">
      <section className="payment-card" aria-labelledby="test-payment-title">
        <span className="payment-kicker"><ShieldCheck size={16} aria-hidden="true" /> 管理员专用 · 支付联调</span>
        <h1 id="test-payment-title">支付宝小额支付测试</h1>
        <p className="payment-account">当前管理员：<strong>{name}</strong></p>
        <p className="payment-message">这是实际收款测试，付款后会真实扣款。测试订单不增加会员天数，不自动退款。</p>
        <p className="payment-hint">使用电脑浏览器付款。支付完成后，请查看订单结果，只有服务端核对成功才显示“已确认到账”。</p>
        {!available && <p className="payment-message" role="status">测试支付尚未开放，当前无法付款。</p>}
        <form onSubmit={event => { event.preventDefault(); void pay(); }} aria-busy={busy}>
          <label htmlFor="test-payment-amount">支付金额 <span className="payment-hint">（人民币元，0.01～100）</span></label>
          <input id="test-payment-amount" className="payment-amount-input" type="number" min="0.01" max="100" step="0.01" inputMode="decimal"
            required value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} />
          <div className="payment-presets" role="group" aria-label="选择常用测试金额">{["0.01", "0.10", "1.00"].map(value => <button type="button" key={value} aria-pressed={amount === value} disabled={busy} onClick={() => setAmount(value)}>¥{value}</button>)}</div>
          <button type="submit" className="payment-cta" disabled={busy || !available || loading}>{busy ? "正在生成付款入口…" : `前往支付宝支付 ¥${amount || "0.01"}`}<ArrowRight size={16} aria-hidden="true" /></button>
        </form>
        {message && <p className="payment-message" role="alert">{message}</p>}
      </section>
      <section className="payment-card payment-history" aria-labelledby="test-orders-title">
        <div className="payment-section-heading"><h2 id="test-orders-title">我的测试订单</h2><span>共 {orders.length} 笔</span></div>
        <p className="payment-hint">同一金额的待付款订单会复用。已付款请勿再次支付。</p>
        <button className="payment-refresh" disabled={busy || refreshing || loading} onClick={() => { setMessage(""); void refresh().catch(error => setMessage(error.message)); }}>{refreshing ? "正在刷新…" : "刷新收款状态"}</button>
        {loading ? <p className="payment-empty" role="status">正在加载测试订单…</p> : orders.length === 0 ? <p className="payment-empty">暂无可显示的测试订单。</p> : <div className="payment-orders-scroll" role="region" aria-label="我的测试订单列表" tabIndex={0}><ul className="payment-orders">{orders.map(order => <li key={order.id}>
          <div className="payment-order-info"><strong>小额支付测试</strong><p>{order.status === "PAID" ? "已确认到账 · 不含会员权益" : "待付款／待确认"}</p><p className="payment-id">{order.id}</p></div>
          <div className="payment-order-actions"><strong className="payment-order-amount">¥{order.amount}</strong><a href={`/payment/result?order=${encodeURIComponent(order.id)}`}>查看结果 <ArrowRight size={14} aria-hidden="true" /></a>{order.status === "PENDING" && <button disabled={busy || !available} onClick={() => void pay(order.id)}>继续支付</button>}</div>
        </li>)}</ul></div>}
      </section>
    </main>
  </div>;
}
