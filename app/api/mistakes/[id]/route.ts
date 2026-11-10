import { query } from "@/db/client";
import { authenticate } from "@/lib/api-guard";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  const { id } = await params;
  const result = await query("DELETE FROM mistakes WHERE id = $1 AND user_id = $2", [id, user.userId]);
  return Response.json({ deleted: (result.rowCount ?? 0) > 0 });
}
