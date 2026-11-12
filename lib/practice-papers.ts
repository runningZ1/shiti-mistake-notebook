import { requireProfile } from "@/lib/profiles";
import { query } from "@/db/client";
import type { PracticeDetail, PracticeGrade, PracticeQuestion, PracticeSummary } from "@/lib/practice-types";

export type PracticePaperRow = {
  id: string; user_id: string; profile_id?: string; subject: string; unit_name: string; grade_level: string;
  questions: PracticeQuestion[]; answers: string[]; grading: PracticeGrade[]; created_at: string; graded_at: string | null;
};

const columns = "id, user_id, profile_id, subject, unit_name, grade_level, questions, answers, grading, created_at, graded_at";

export function parsePaper(row: PracticePaperRow) {
  return {
    questions: row.questions,
    answers: row.answers,
    grading: row.grading,
  };
}

export function paperSummary(row: PracticePaperRow): PracticeSummary {
  const { questions, grading } = parsePaper(row);
  return {
    id: row.id, subject: row.subject, unitName: row.unit_name, gradeLevel: row.grade_level,
    questionCount: questions.length, createdAt: row.created_at, gradedAt: row.graded_at,
    correctCount: grading.filter(item => item.verdict === "correct").length,
    incorrectCount: grading.filter(item => item.verdict === "incorrect").length,
    uncertainCount: grading.filter(item => item.verdict === "uncertain").length,
    wrongKnowledgePoints: grading.filter(item => item.verdict === "incorrect").map(item => item.knowledgePoint),
    correctKnowledgePoints: grading.filter(item => item.verdict === "correct").map(item => item.knowledgePoint),
  };
}

export function paperDetail(row: PracticePaperRow): PracticeDetail {
  const { questions, answers, grading } = parsePaper(row);
  return {
    ...paperSummary(row),
    questions: questions.map(item => ({ question: item.question, knowledgePoint: item.knowledgePoint, kind: item.kind, format: item.format, options: item.options, table: item.table })),
    answers, grading,
  };
}

export async function listPracticePapers(userId: string, fixedProfileId?: string): Promise<PracticePaperRow[]> {
  const { id: profileId } = await requireProfile(userId, fixedProfileId);
  const { rows } = await query<PracticePaperRow>(`SELECT ${columns} FROM practice_papers WHERE user_id = $1 AND profile_id = $2 ORDER BY created_at DESC LIMIT 100`, [userId, profileId]);
  return rows;
}

export async function getPracticePaper(id: string, userId: string, fixedProfileId?: string): Promise<PracticePaperRow | null> {
  const { id: profileId } = await requireProfile(userId, fixedProfileId);
  const { rows } = await query<PracticePaperRow>(`SELECT ${columns} FROM practice_papers WHERE id = $1 AND user_id = $2 AND profile_id = $3`, [id, userId, profileId]);
  return rows[0] ?? null;
}

export async function insertPracticePaper(input: {
  id: string; userId: string; profileId?: string; subject: string; unitName: string; gradeLevel: string;
  questions: PracticeQuestion[]; createdAt: string;
}): Promise<void> {
  const { id: profileId } = await requireProfile(input.userId, input.profileId);
  await query("INSERT INTO practice_papers (id, user_id, subject, unit_name, grade_level, questions, answers, grading, created_at, profile_id) VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, '[]'::jsonb, $7, $8)",
    [input.id, input.userId, input.subject, input.unitName, input.gradeLevel, JSON.stringify(input.questions), input.createdAt, profileId]);
}

export async function savePracticeGrade(id: string, userId: string, answers: string[], grading: PracticeGrade[], gradedAt: string, fixedProfileId?: string): Promise<void> {
  const { id: profileId } = await requireProfile(userId, fixedProfileId);
  const result = await query("UPDATE practice_papers SET answers = $1::jsonb, grading = $2::jsonb, graded_at = $3 WHERE id = $4 AND user_id = $5 AND profile_id = $6",
    [JSON.stringify(answers), JSON.stringify(grading), gradedAt, id, userId, profileId]);
  if (!result.rowCount) throw new Error("练习不存在或不属于当前档案");
}
