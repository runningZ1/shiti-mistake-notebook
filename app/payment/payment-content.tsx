"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Order | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const data = await api("/api/orders");
    setOrders(data.orders);
    const current = orderId ? (await api(`/api/orders/${encodeURIComponent(orderId)}`)).order : data.orders[0];
    setSelected(current || null);
    return current as Order | undefined;
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
        router.push(`/payment/result?order=${encodeURIComponent(order.id)}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法发起付款");
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }

  return <div className="pricing-page">
    <header className="pricing-header"><Link className="pricing-brand" href="/"><span className="pricing-brand-mark"><BookOpen size={22} /></span><strong>拾题</strong><small>智能错题本</small></Link><Link className="pricing-nav-link" href="/pricing">会员方案</Link></header>
    <main className="payment-main">
      <section className="payment-card">
        <span className="pricing-kicker"><ShieldCheck size={16} /> 支付宝付款</span>
        <h1>{result ? "付款结果" : "开通 VIP 畅学月卡"}</h1>
        <p>当前账户：<strong>{name}</strong></p>
        {result ? <div aria-live="polite">
          <h2>{loading ? "正在查询订单…" : selected ? label(selected) : "暂未找到订单"}</h2>
          {selected && <><p className="payment-id">订单号：{selected.id}</p><p>{selected.productName} · ¥{selected.amount}</p></>}
          {selected?.status === "PENDING" && <p>以服务端确认结果为准。若您已完成付款，请等待通知并刷新，勿重复付款。</p>}
          {selected?.deliveryStatus === "REVIEW" && <p>付款已记录，账号权益需要人工核对，请保留订单号联系客服。</p>}
          {selected?.deliveryStatus === "DELIVERED" && (selected.purpose === "TEST" ? <Link className="pricing-cta-button primary" href="/admin/payment-test">返回支付测试页 <ArrowRight size={16} /></Link> : <Link className="pricing-cta-button primary" href="/">进入学习空间 <ArrowRight size={16} /></Link>)}
        </div> : <>
          <div className="payment-price">¥99 <small>／30天</small></div>
          <p>包含智能批改、相似题、知识图谱、练习卷及英语作文分析。单次购买，不自动续费。</p>
          <p>开通后保留未用完的有效期限，再顺延 30 天。</p>
          <p>请使用电脑浏览器前往支付宝官方收银台；手机唤起暂未完成验证。</p>
          {longTerm ? <p role="status">当前账号已拥有长期权限，无需购买。</p> : <>
            {!available && <p role="status">支付宝支付暂未开放，当前无法付款。</p>}
            <button className="pricing-cta-button primary" disabled={!available || busy || loading} onClick={() => void pay()}>{busy ? "正在生成付款入口…" : "前往支付宝付款 · ¥99"}</button>
          </>}
        </>}
        {message && <p className="payment-message" role="alert">{message}</p>}
        <button className="payment-refresh" disabled={busy} onClick={() => { setMessage(""); void refresh().catch(error => setMessage(error.message)); }}>刷新订单</button>
        {result && <Link className="payment-refresh" href="/payment">返回收银页／查看历史订单</Link>}
      </section>
      <section className="payment-card"><h2>我的订单</h2>
        {loading ? <p>正在加载…</p> : orders.length === 0 ? <p>暂无订单。</p> : <ul className="payment-orders">{orders.map(order => <li key={order.id}>
          <div><strong>{order.productName}</strong><p>{label(order)} · ¥{order.amount}</p><p className="payment-id">{order.id}</p></div>
          <div><Link href={`/payment/result?order=${encodeURIComponent(order.id)}`}>查看结果</Link>
            {order.purpose === "TEST" ? <Link className="payment-refresh" href="/admin/payment-test">前往测试页</Link> : !result && order.status === "PENDING" && !longTerm && <button disabled={!available || busy} onClick={() => void pay(order.id)}>继续付款</button>}</div>
        </li>)}</ul>}
      </section>
    </main>
  </div>;
}
