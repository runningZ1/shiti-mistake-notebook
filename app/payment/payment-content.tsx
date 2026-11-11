"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- vinext beta 实测 next/link 客户端跳转抛错，使用原生链接整页导航。 */
import { useCallback, useEffect, useState } from "react";
import { BookOpen, ShieldCheck, ArrowRight } from "lucide-react";

type Order = { id: string; productName: string; amount: string; status: "PENDING" | "PAID";
  purpose: "MEMBERSHIP" | "TEST";
  deliveryStatus: "PENDING" | "DELIVERED" | "REVIEW"; createdAt: string; paidAt: string | null };

async function api(path: string, method = "GET") {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store" });
  const data = await response.json() as { error?: string; orders: Order[]; order: Order; paymentUrl?: string };
  if (!response.ok) throw new Error(data.error || "服务暂不可用，请稍后重试");
  return data;
}
function label(order: Order) {
  if (order.purpose === "TEST") return order.status === "PAID" ? "测试收款已确认 · 不含会员权益" : "测试订单待付款／待确认";
  return order.status === "PENDING" ? "待付款／待确认" : order.deliveryStatus === "DELIVERED" ? "已付款 · 已开通" : "已付款 · 等待人工核对";
}

export default function PaymentContent({ name, available, longTerm, result = false, orderId }: {
  name: string; available: boolean; longTerm: boolean; result?: boolean; orderId?: string;
}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api("/api/orders");
      setOrders(data.orders);
      const current = orderId ? (await api(`/api/orders/${encodeURIComponent(orderId)}`)).order : data.orders[0];
      setSelected(current || null);
      return current as Order | undefined;
    } finally {
      setRefreshing(false);
    }
  }, [orderId]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    async function check() {
      try {
        const order = await refresh();
        if (stopped) return;
        setLoading(false);
        if (!result || !order || order.status === "PAID") return;
        attempts++;
        if (attempts >= 20) { setMessage("付款结果仍在确认。请稍后刷新订单；请勿重复付款。需要帮助时请提供订单号。"); return; }
        timer = setTimeout(check, 3000);
      } catch (error) {
        if (!stopped) { setLoading(false); setMessage(error instanceof Error ? error.message : "暂时无法查询订单"); }
      }
    }
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [refresh, result]);

  async function pay(id?: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const order: Order = id ? orders.find(item => item.id === id)! : (await api("/api/orders", "POST")).order;
      const data = await api(`/api/orders/${encodeURIComponent(order.id)}/pay`, "POST");
      if (data.paymentUrl) {
        const url = new URL(data.paymentUrl);
        if (url.origin !== "https://openapi.alipay.com" || url.pathname !== "/gateway.do" || url.username || url.password) throw new Error("付款链接无效，请稍后重试");
        window.location.assign(url.href);
      } else {
        window.location.assign(`/payment/result?order=${encodeURIComponent(order.id)}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法发起付款");
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }

  return <div className="payment-page">
    <header className="payment-header">
      <a className="payment-brand" href="/"><span className="payment-brand-mark"><BookOpen size={22} aria-hidden="true" /></span><strong>拾题</strong><small>智能错题本</small></a>
      <a className="payment-nav-link" href="/pricing">会员方案 <ArrowRight size={16} aria-hidden="true" /></a>
    </header>
    <main className="payment-main">
      <section className="payment-card" aria-labelledby="payment-title">
        <span className="payment-kicker"><ShieldCheck size={16} aria-hidden="true" /> 支付宝安全付款</span>
        <h1 id="payment-title">{result ? "付款结果" : "开通 VIP 畅学月卡"}</h1>
        <p className="payment-account">当前账户：<strong>{name}</strong></p>
        {result ? <div className="payment-result" aria-live="polite" aria-busy={loading || refreshing}>
          <h2>{loading ? "正在查询订单…" : selected ? label(selected) : "暂未找到订单"}</h2>
          {selected && <><p className="payment-id">订单号：{selected.id}</p><p>{selected.productName} · <strong>¥{selected.amount}</strong></p></>}
          {!loading && !selected && <p>请从历史订单选择一笔订单查看结果，或刷新后重试。</p>}
          {selected?.status === "PENDING" && <p>以服务端确认结果为准。若您已完成付款，请等待通知并刷新，勿重复付款。</p>}
          {selected?.deliveryStatus === "REVIEW" && <p>付款已记录，账号权益需要人工核对，请保留订单号联系客服。</p>}
          {selected?.deliveryStatus === "DELIVERED" && (selected.purpose === "TEST" ? <a className="payment-cta" href="/admin/payment-test">返回支付测试页 <ArrowRight size={16} aria-hidden="true" /></a> : <a className="payment-cta" href="/">进入学习空间 <ArrowRight size={16} aria-hidden="true" /></a>)}
        </div> : <>
          <div className="payment-price">¥99 <small>／30 天</small></div>
          <p>包含智能批改、相似题、知识图谱、练习卷及英语作文分析。</p>
          <ul className="payment-benefits"><li>单次购买，不自动续费</li><li>保留未用完的有效期，再顺延 30 天</li></ul>
          <p className="payment-hint">请使用电脑浏览器前往支付宝官方收银台；手机唤起暂未完成验证。</p>
          {longTerm ? <p className="payment-success" role="status">当前账号已拥有长期权限，无需购买。</p> : <>
            {!available && <p className="payment-message" role="status">支付宝支付暂未开放，当前无法付款。</p>}
            <button className="payment-cta" disabled={!available || busy || loading} onClick={() => void pay()}>{busy ? "正在生成付款入口…" : "前往支付宝付款 · ¥99"}<ArrowRight size={16} aria-hidden="true" /></button>
          </>}
        </>}
        {message && <p className="payment-message" role="alert">{message}</p>}
        <div className="payment-links">
          <button className="payment-refresh" disabled={busy || refreshing} onClick={() => { setMessage(""); void refresh().catch(error => setMessage(error.message)); }}>{refreshing ? "正在刷新…" : "刷新订单"}</button>
          {result && <a className="payment-refresh" href="/payment">返回收银页</a>}
        </div>
      </section>
      <section className="payment-card payment-history" aria-labelledby="payment-history-title">
        <div className="payment-section-heading"><h2 id="payment-history-title">我的订单</h2><span>共 {orders.length} 笔</span></div>
        <p className="payment-hint">已完成付款的订单，请查看结果并等待确认。</p>
        {loading ? <p className="payment-empty" role="status">正在加载订单…</p> : orders.length === 0 ? <p className="payment-empty">暂无可显示的订单。</p> : <div className="payment-orders-scroll" role="region" aria-label="我的订单列表" tabIndex={0}><ul className="payment-orders">{orders.map(order => <li key={order.id}>
          <div className="payment-order-info"><strong>{order.productName}</strong><p>{label(order)}</p><p className="payment-id">{order.id}</p></div>
          <div className="payment-order-actions"><strong className="payment-order-amount">¥{order.amount}</strong><a href={`/payment/result?order=${encodeURIComponent(order.id)}`}>查看结果 <ArrowRight size={14} aria-hidden="true" /></a>
            {order.purpose === "TEST" ? <a href="/admin/payment-test">前往测试页</a> : !result && order.status === "PENDING" && !longTerm && <button disabled={!available || busy} onClick={() => void pay(order.id)}>继续付款</button>}</div>
        </li>)}</ul></div>}
      </section>
    </main>
  </div>;
}
