import { query, transaction } from "@/db/client";
import { authenticate } from "@/lib/api-guard";
import { requireProfile, ProfileAccessError } from "@/lib/profiles";
import { validDraftKey, workspaceDraftWriteSchema, type WorkspaceDraft } from "@/lib/workspace-drafts";

const headers = { "Cache-Control": "private, no-store" };
const columns = 'draft_key AS key, profile_id AS "profileId", version, payload, updated_at AS "updatedAt"';
type Context = { params: Promise<{ key: string }> };
function fail(error: string, status: number) { return Response.json({ error }, { status, headers }); }

async function scope(request: Request, context: Context) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const { key } = await context.params;
  const params = new URL(request.url).searchParams;
  if (!validDraftKey(key) || params.getAll("profileId").length > 1) return fail("草稿参数无效", 400);
  const requested = params.get("profileId");
  if (requested !== null && (!requested || requested.length > 128)) return fail("档案参数无效", 400);
  // requireProfile validates ownership, including explicit IDs fixed at request creation.
  const profile = await requireProfile(auth.user.userId, requested ?? undefined);
  return { userId: auth.user.userId, profileId: profile.id, key };
}

export async function GET(request: Request, context: Context) {
  try {
    const target = await scope(request, context);
    if (target instanceof Response) return target;
    const { rows } = await query<WorkspaceDraft>(`SELECT ${columns} FROM workspace_drafts WHERE user_id=$1 AND profile_id=$2 AND draft_key=$3`, [target.userId, target.profileId, target.key]);
    return Response.json({ draft: rows[0] ?? null, profileId: target.profileId }, { headers });
  } catch (error) {
    if (error instanceof ProfileAccessError) return fail("当前学习档案不可用", 403);
    return fail("草稿加载失败，请稍后重试", 503);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const target = await scope(request, context);
    if (target instanceof Response) return target;
    // Bound bytes, not just Content-Length (which may be absent or untrusted).
    const reader = request.body?.getReader();
    if (!reader) return fail("草稿内容无效", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); return fail("草稿过大", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { return fail("草稿内容无效", 400); }
    const parsed = workspaceDraftWriteSchema.safeParse(body);
    if (!parsed.success) return fail("草稿格式或打印参数无效", 400);
    const { version, payload } = parsed.data;
    const result = await transaction(async client => {
      const ids = [...new Set([...(payload.print?.itemIds ?? []), ...Object.keys(payload.reflections ?? {})])];
      if (ids.length) {
        const owned = await client.query<{ id: string }>("SELECT id FROM mistakes WHERE user_id=$1 AND profile_id=$2 AND id=ANY($3::text[]) FOR SHARE", [target.userId, target.profileId, ids]);
        if (owned.rows.length !== ids.length) return fail("部分题目已不存在或不属于当前档案，请重新核对清单", 422);
      }
      const values = [target.userId, target.profileId, target.key, JSON.stringify(payload), version];
      // One atomic statement: stale updates and simultaneous first writes both conflict.
      const saved = version === 0
        ? await client.query<WorkspaceDraft>(`INSERT INTO workspace_drafts(user_id,profile_id,draft_key,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING ${columns}`, values.slice(0, 4))
        : await client.query<WorkspaceDraft>(`UPDATE workspace_drafts SET payload=$4::jsonb,version=version+1,updated_at=now() WHERE user_id=$1 AND profile_id=$2 AND draft_key=$3 AND version=$5 RETURNING ${columns}`, values);
      return saved.rows[0] ? Response.json({ draft: saved.rows[0], profileId: target.profileId }, { headers })
        : fail("草稿已在其他页面更新，请加载服务端版本后再保存；当前编辑仍保留", 409);
    });
    return result;
  } catch (error) {
    if (error instanceof ProfileAccessError) return fail("当前学习档案不可用", 403);
    return fail("草稿保存失败，当前编辑仍保留", 503);
  }
}
