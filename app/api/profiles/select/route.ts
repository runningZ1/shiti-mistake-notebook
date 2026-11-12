import { cookies } from "next/headers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { PROFILE_COOKIE, validateProfile, ProfileAccessError } from "@/lib/profiles";
import { isSameOriginRequest, isHttpsRequest, sessionCookieOptions } from "@/lib/auth";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403, headers });
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
    const body = await request.json().catch(() => null) as { profileId?: unknown } | null;
    if (typeof body?.profileId !== "string" || !body.profileId || body.profileId.length > 256) return Response.json({ error: "请选择有效档案" }, { status: 400, headers });
    const profile = await validateProfile(user.userId, body.profileId);
    (await cookies()).set(PROFILE_COOKIE, profile.id, sessionCookieOptions(isHttpsRequest(request)));
    return Response.json({ profile, reload: true }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof ProfileAccessError ? error.message : "切换档案失败" }, { status: error instanceof ProfileAccessError ? 404 : 503, headers });
  }
}
