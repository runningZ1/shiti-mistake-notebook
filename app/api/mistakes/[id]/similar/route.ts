import { query } from "@/db/client";
import { authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, createSimilar, type SimilarQuestion } from "@/lib/ai";

type Row = { question: string; knowledge_point: string; subject: string; similar_questions: SimilarQuestion[] };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  if (!aiConfigured()) return Response.json({ error: "AI 分析服务尚未配置" }, { status: 503 });
  const body = await request.json().catch(() => null) as { count?: unknown } | null;
  const count = body?.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 5) {
    return Response.json({ error: "类似题数量只能是 1 到 5 的整数" }, { status: 400 });
  }
  const { id } = await params;
  const { rows } = await query<Row>("SELECT question, knowledge_point, subject, similar_questions FROM mistakes WHERE id = $1 AND user_id = $2", [id, user.userId]);
  const row = rows[0];
  if (!row) return Response.json({ error: "没有找到这道错题" }, { status: 404 });
  try {
    const previous = row.similar_questions;
    const questions = await createSimilar(row.question, row.knowledge_point, row.subject, count, previous.map(item => item.question));
    const allQuestions = [...previous, ...questions];
    await query("UPDATE mistakes SET similar_questions = $1::jsonb WHERE id = $2 AND user_id = $3", [JSON.stringify(allQuestions), id, user.userId]);
    return Response.json({ questions: allQuestions });
  } catch (error) {
    console.error("Similar question generation failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "生成失败，请重试" }, { status: 500 });
  }
}
