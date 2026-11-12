import { getChatGPTUser } from "@/app/chatgpt-auth";
import { requireProfile, listProfiles, createProfile, parseProfileInput, ProfileAccessError, ensureDefaultProfile } from "@/lib/profiles";
import { isSameOriginRequest } from "@/lib/auth";

const headers = { "Cache-Control": "private, no-store" };

// Does not use authenticate(): users with a stale/foreign profile cookie must
// still be able to list their own profiles and repair their selection.
export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
    const profiles = await listProfiles(user.userId);
    let currentProfileId: string | null = null;
    try { currentProfileId = (await requireProfile(user.userId)).id; }
    catch (error) { if (!(error instanceof ProfileAccessError)) throw error; }
    return Response.json({ profiles, currentProfileId }, { headers });
  } catch {
    return Response.json({ error: "学习档案加载失败" }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403, headers });
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "请先登录" }, { status: 401, headers });
    const input = parseProfileInput(await request.json().catch(() => null));
    if (!input) return Response.json({ error: "请填写1–40字名称，年级最多30字" }, { status: 400, headers });
    await ensureDefaultProfile(user.userId);
    return Response.json({ profile: await createProfile(user.userId, input) }, { status: 201, headers });
  } catch {
    return Response.json({ error: "学习档案创建失败" }, { status: 503, headers });
  }
}
