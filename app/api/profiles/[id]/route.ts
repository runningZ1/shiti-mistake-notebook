import { getChatGPTUser } from "@/app/chatgpt-auth";
import { updateProfile, parseProfileInput } from "@/lib/profiles";
import { isSameOriginRequest } from "@/lib/auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403, headers });
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
    const input = parseProfileInput(await request.json().catch(() => null));
    if (!input) return Response.json({ error: "档案名称或年级不符合要求" }, { status: 400, headers });
    const profile = await updateProfile(user.userId, (await params).id, input);
    return profile ? Response.json({ profile }, { headers }) : Response.json({ error: "档案不存在" }, { status: 404, headers });
  } catch {
    return Response.json({ error: "档案保存失败" }, { status: 503, headers });
  }
}
