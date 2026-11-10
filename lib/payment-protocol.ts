/** Pure protocol helpers shared by Workers and isolated protocol verification. */
const encoder = new TextEncoder();

export class PaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function amountToCents(text: string): number {
  if (!/^[0-9]{1,8}\.[0-9]{1,2}$/.test(text)) throw new PaymentError("无效支付金额");
  const [yuan, fraction] = text.split(".");
  const value = BigInt(yuan) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (value <= BigInt(0) || value > BigInt(2147483647)) throw new PaymentError("无效支付金额");
  return Number(value);
}

export function centsToAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new PaymentError("无效订单金额");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

async function key(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export async function signPayment(text: string, secret: string): Promise<string> {
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, ["sign"]), encoder.encode(text)));
  return btoa(String.fromCharCode(...signature));
}

export type PaymentCallback = {
  externalOrderId: string; localOrderId: string; status: "success";
  amount: string; timestamp: number; signature: string;
};

export async function verifyCallback(input: unknown, secret: string, now = Date.now()): Promise<PaymentCallback> {
  if (!input || typeof input !== "object") throw new PaymentError("无效通知");
  const b = input as PaymentCallback;
  if (typeof b.externalOrderId !== "string" || !/^ST_[a-f0-9]{32}$/.test(b.externalOrderId) ||
      typeof b.localOrderId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(b.localOrderId) ||
      b.status !== "success" || typeof b.amount !== "string" ||
      !Number.isSafeInteger(b.timestamp) || Math.abs(now - b.timestamp) > 300000 ||
      typeof b.signature !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(b.signature)) {
    throw new PaymentError("无效通知字段或时间戳");
  }
  const text = b.externalOrderId + b.localOrderId + b.status + b.amount + b.timestamp;
  const signature = Uint8Array.from(atob(b.signature), c => c.charCodeAt(0));
  if (!await crypto.subtle.verify("HMAC", await key(secret, ["verify"]), signature, encoder.encode(text))) {
    throw new PaymentError("通知签名错误", 401);
  }
  amountToCents(b.amount);
  return b;
}

export function alipayDestination(value: unknown): string {
  if (typeof value !== "string") throw new PaymentError("支付服务未返回付款链接", 502);
  let url: URL;
  try { url = new URL(value); } catch { throw new PaymentError("付款链接无效", 502); }
  if (url.origin !== "https://openapi.alipay.com" || url.username || url.password || url.pathname !== "/gateway.do") {
    throw new PaymentError("付款链接不在支付宝官方收银台", 502);
  }
  return url.href;
}
