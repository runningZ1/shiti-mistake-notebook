import { query } from "@/db/client";
import type { SimilarQuestion } from "@/lib/ai";
import { authenticate } from "@/lib/api-guard";
import { isCalendarDate } from "@/lib/mistake-dates";

type Row = {
  id: string; upload_id: string; subject: string; question: string; question_bounds: number[];
  incorrect_answer: string; correct_answer: string; reasoning: string; reflection: string;
  archive_kind: "mistake" | "collection"; judgement_source: string; knowledge_point: string; page_number: number; source_name: string;
  similar_questions: SimilarQuestion[]; created_at: string; removed_at: string | null;
};

export async function GET(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  const headers = { "Cache-Control": "private, no-store" };
  const params = new URL(request.url).searchParams;
  const date = params.get("date");
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const hasDate = params.has("date");
  const hasRange = params.has("dateFrom") || params.has("dateTo");
  if (["date", "dateFrom", "dateTo", "subject", "q"].some(key => params.getAll(key).length > 1)
    || (hasDate && hasRange)
    || ((hasDate || hasRange) && params.has("month"))
    || (hasDate && !isCalendarDate(date!))
    || (hasRange && (!dateFrom || !dateTo || !isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo))) {
    return Response.json({ error: "请检查日期范围或筛选参数" }, { status: 400, headers });
  }

  const values: unknown[] = [user.userId, auth.profileId];
  const conditions = ["user_id = $1", "profile_id = $2", params.get("removed") === "true" ? "removed_at IS NOT NULL" : "removed_at IS NULL"];
  if (hasDate || hasRange) {
    const start = new Date(`${hasDate ? date : dateFrom}T00:00:00+08:00`);
    const end = new Date(`${hasDate ? date : dateTo}T00:00:00+08:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    values.push(start, end);
    conditions.push(`created_at >= $${values.length - 1} AND created_at < $${values.length}`);
  }
  const subject = params.get("subject");
  if (subject && subject !== "全部科目") {
    values.push(subject);
    conditions.push(`subject = $${values.length}`);
  }
  // 沿用旧列表的纯文字、大小写不敏感 includes 语义，% 和 _ 不是通配符。
  const keyword = (params.get("q") ?? "").toLowerCase();
  try {
    const { rows } = await query<Row>(
      `SELECT id, upload_id, subject, question, question_bounds, incorrect_answer, correct_answer, reasoning, reflection, knowledge_point, page_number, source_name, similar_questions, created_at, removed_at, archive_kind, judgement_source FROM mistakes WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC, page_number ASC, id ASC`,
      values,
    );
    const mistakes = rows
      .filter(row => !keyword || `${row.question} ${row.knowledge_point} ${row.source_name}`.toLowerCase().includes(keyword))
      .map(row => ({
        id: row.id, uploadId: row.upload_id, subject: row.subject, question: row.question,
        questionBounds: row.question_bounds, archiveKind: row.archive_kind, judgementSource: row.judgement_source,
        incorrectAnswer: row.incorrect_answer, correctAnswer: row.correct_answer,
        reasoning: row.reasoning, reflection: row.reflection, knowledgePoint: row.knowledge_point,
        pageNumber: row.page_number, sourceName: row.source_name,
        similarQuestions: row.similar_questions, createdAt: row.created_at, removedAt: row.removed_at, profileId: auth.profileId,
      }));
    return Response.json({ mistakes }, { headers });
  } catch {
    console.error("Mistake list load failed");
    return Response.json({ error: "错题列表加载失败，请稍后重试" }, { status: 500, headers });
  }
}
