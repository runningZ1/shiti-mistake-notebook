import type { Metadata } from "next";
import { getChatGPTUser } from "../chatgpt-auth";
import PricingContent from "./pricing-content";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "会员方案与定价 · 拾题智能错题本",
  description: "新用户免费体验 7 天，VIP 会员每次购买 99 元增加 30 天使用权限。了解拍照批改、错题整理、练习生成与会员支付说明。",
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
