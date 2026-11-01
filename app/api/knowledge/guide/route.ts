import { query } from "@/db/client";
import { authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, createKnowledgeGuide } from "@/lib/ai";
import { isSameOriginRequest } from "@/lib/auth";
import { normalizeKnowledgePoint, type KnowledgeGuide } from "@/lib/knowledge-types";

type Example = { question: string; incorrect_answer: string; correct_answer: string };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => null) as { subject?: unknown; knowledgePoint?: unknown } | null;
  const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
  const point = typeof body?.knowledgePoint === "string" ? normalizeKnowledgePoint(body.knowledgePoint) : "";
  if (!subject || subject.length > 30 || !point || point.length > 100) {
    return Response.json({ error: "请选择有效的知识点" }, { status: 400 });
  }
  if (!aiConfigured()) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });

  try {
    const { rows: profiles } = await query<{ unit_name: string; guide: KnowledgeGuide | null }>("SELECT unit_name, guide FROM knowledge_units WHERE user_id = $1 AND subject = $2 AND knowledge_point = $3",
      [auth.user.userId, subject, point]);
    const profile = profiles[0];
    if (profile?.guide) {
      return Response.json({ guide: profile.guide, cached: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const { rows: results } = await query<Example>("SELECT question, incorrect_answer, correct_answer FROM mistakes WHERE user_id = $1 AND subject = $2 AND TRIM(knowledge_point) = $3 ORDER BY created_at DESC LIMIT 2",
      [auth.user.userId, subject, point]);
    const guide = await createKnowledgeGuide({
      subject, knowledgePoint: point, unitName: profile?.unit_name || "",
      examples: results.map(row => ({ question: row.question, incorrectAnswer: row.incorrect_answer, correctAnswer: row.correct_answer })),
    });
    await query("INSERT INTO knowledge_units (user_id, subject, knowledge_point, unit_name, guide, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT(user_id, subject, knowledge_point) DO UPDATE SET guide = CASE WHEN knowledge_units.unit_name = excluded.unit_name THEN excluded.guide ELSE knowledge_units.guide END, updated_at = excluded.updated_at",
      [auth.user.userId, subject, point, profile?.unit_name || "", JSON.stringify(guide), new Date().toISOString()]);
    return Response.json({ guide, cached: false }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Knowledge guide failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "概念提示生成失败" }, { status: 500 });
  }
}
