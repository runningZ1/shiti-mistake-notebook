import type { Metadata } from "next";
import { getChatGPTUser } from "../chatgpt-auth";
import PricingContent from "./pricing-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "会员方案与定价 · 拾题智能错题本",
  description: "清晰透明的会员方案，新用户免费体验 7 天，VIP 畅学会员每月仅需 99 元，畅享全学科智能批改、举一反三变式练习、知识图谱与作文批改。",
};

export default async function PricingPage() {
  let user = null;
  try {
    user = await getChatGPTUser();
  } catch {
    // 忽略异常，降级为未登录访客渲染
  }

  return <PricingContent user={user} />;
}
