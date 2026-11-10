import { query } from "@/db/client";
import { authenticate } from "@/lib/api-guard";
import { isSameOriginRequest } from "@/lib/auth";
import { normalizeKnowledgePoint, type KnowledgeGuide, type KnowledgeProfile } from "@/lib/knowledge-types";

type Row = {
  subject: string;
  knowledge_point: string;
  unit_name: string;
  guide: KnowledgeGuide | null;
};

function profile(row: Row): KnowledgeProfile {
  return { subject: row.subject, knowledgePoint: row.knowledge_point, unitName: row.unit_name, guide: row.guide };
}

export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    const { rows } = await query<Row>("SELECT subject, knowledge_point, unit_name, guide FROM knowledge_units WHERE user_id = $1", [auth.user.userId]);
    return Response.json({ profiles: rows.map(profile) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Knowledge profiles load failed", error);
    return Response.json({ error: "知识点归属加载失败" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null) as { subject?: unknown; knowledgePoint?: unknown; unitName?: unknown } | null;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const point = typeof body?.knowledgePoint === "string" ? normalizeKnowledgePoint(body.knowledgePoint) : "";
  const unit = typeof body?.unitName === "string" ? body.unitName.trim() : "";
  if (!subject || subject.length > 30 || !point || point.length > 100 || unit.length > 80) {
    return Response.json({ error: "知识点或单元名称不符合要求" }, { status: 400 });
  }
  try {
    const updatedAt = new Date().toISOString();
    const { rows } = await query<Row>("INSERT INTO knowledge_units (user_id, subject, knowledge_point, unit_name, updated_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(user_id, subject, knowledge_point) DO UPDATE SET unit_name = excluded.unit_name, guide = CASE WHEN knowledge_units.unit_name = excluded.unit_name THEN knowledge_units.guide ELSE NULL END, updated_at = excluded.updated_at RETURNING subject, knowledge_point, unit_name, guide",
      [auth.user.userId, subject, point, unit, updatedAt]);
    return Response.json({ profile: profile(rows[0]) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Knowledge unit save failed", error);
    return Response.json({ error: "单元归属保存失败" }, { status: 503 });
  }
}
