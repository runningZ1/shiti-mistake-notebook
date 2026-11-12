import { imageStorage, storageConfigured } from "@/lib/storage";
import { env } from "cloudflare:workers";
import { query } from "@/db/client";
import { authenticate } from "@/lib/api-guard";

export const runtime = "edge";

/** Serve only the current user's original page, for faithful offline Word exports. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; page: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  if (!storageConfigured() && !env.BUCKET) return Response.json({ error: "图片存储暂不可用" }, { status: 503 });
  const { id, page } = await params;
  const pageNumber = Number(page);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 4) return Response.json({ error: "页码无效" }, { status: 400 });
  try {
    const { rows } = await query<{ file_keys: string[];page_metadata:Array<{originalKey?:string}> }>(
      "SELECT file_keys,page_metadata FROM uploads WHERE id = $1 AND user_id = $2 AND profile_id = $3", [id, auth.user.userId, auth.profileId]);
    const upload = rows[0];
    if (!upload) return Response.json({ error: "原图不存在" }, { status: 404 });
    const keys = upload.file_keys;
    const key = new URL(request.url).searchParams.get('original')==='1' ? upload.page_metadata?.[pageNumber-1]?.originalKey || keys[pageNumber-1] : Array.isArray(keys) ? keys[pageNumber - 1] : undefined;
    if (typeof key !== "string" || !key.startsWith(`${auth.user.userId}/${id}/`)) return Response.json({ error: "原图不存在" }, { status: 404 });
    const file = await imageStorage.get(key);
    if (!file) return Response.json({ error: "原图不存在" }, { status: 404 });
    const mime = file.httpMetadata?.contentType;
    if (mime !== "image/jpeg" && mime !== "image/png" && mime !== "image/webp") return Response.json({ error: "图片格式不支持" }, { status: 415 });
    return new Response(file.body, { headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("Original page read failed", error);
    return Response.json({ error: "原图读取失败" }, { status: 503 });
  }
}
