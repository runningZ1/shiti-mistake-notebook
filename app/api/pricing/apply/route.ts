import { getChatGPTUser } from "@/app/chatgpt-auth";
import { setWechat, findUserById } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    const body = (await request.json().catch(() => ({}))) as {
      account?: string;
      txId?: string;
      userId?: string;
      username?: string;
    };

    const targetUserId = user?.userId || body.userId;
    const accountInfo = body.account ? String(body.account).trim() : "";
    const txId = body.txId ? String(body.txId).trim() : "";

    // 如果用户提交了微信号/手机号，且当前用户已有记录，更新联系微信号方便管理员联系开通
    if (targetUserId && accountInfo) {
      try {
        const existing = await findUserById(targetUserId);
        if (existing) {
          await setWechat(targetUserId, accountInfo);
        }
      } catch {
        // 存储写入异常时保持容错
      }
    }

    console.log(`[Pricing-Apply] 用户申请开通VIP: userId=${targetUserId}, account=${accountInfo}, txId=${txId}`);

    return Response.json({
      ok: true,
      message: "申请已记录，工作人员将在 5~10 分钟内核对并开通。",
    });
  } catch (cause) {
    return Response.json(
      { error: cause instanceof Error ? cause.message : "提交失败，请重试" },
      { status: 500 }
    );
  }
}
