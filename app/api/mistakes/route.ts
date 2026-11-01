import { query } from "@/db/client";
import type { SimilarQuestion } from "@/lib/ai";
import { authenticate } from "@/lib/api-guard";

type Row = {
  id: string; upload_id: string; subject: string; question: string;
  incorrect_answer: string; correct_answer: string; reasoning: string;
  knowledge_point: string; page_number: number; source_name: string;
  similar_questions: SimilarQuestion[]; created_at: string;
};

export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  const { rows } = await query<Row>("SELECT id, upload_id, subject, question, incorrect_answer, correct_answer, reasoning, knowledge_point, page_number, source_name, similar_questions, created_at FROM mistakes WHERE user_id = $1 ORDER BY created_at DESC", [user.userId]);
  const mistakes = rows.map(row => ({
    id: row.id, uploadId: row.upload_id, subject: row.subject, question: row.question,
    incorrectAnswer: row.incorrect_answer, correctAnswer: row.correct_answer,
    reasoning: row.reasoning, knowledgePoint: row.knowledge_point,
    pageNumber: row.page_number, sourceName: row.source_name,
    similarQuestions: row.similar_questions, createdAt: row.created_at,
  }));
  return Response.json({ mistakes });
}
