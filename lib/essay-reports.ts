import { query } from "@/db/client";
import { parseEssayReport, type EssayDetail, type EssaySummary } from "@/lib/essay-types";

type EssayRow = {
  id: string; user_id: string; prompt_text: string; original_text: string;
  grade_level: string; report_json: unknown; created_at: string;
};

function summary(row: Pick<EssayRow, "id" | "prompt_text" | "original_text" | "created_at">): EssaySummary {
  return {
    id: row.id, promptText: row.prompt_text,
    excerpt: row.original_text.replace(/\s+/g, " ").slice(0, 100), createdAt: row.created_at,
  };
}

export async function listEssayReports(userId: string): Promise<EssaySummary[]> {
  const { rows } = await query<Pick<EssayRow, "id" | "prompt_text" | "original_text" | "created_at">>(
    "SELECT id, prompt_text, original_text, created_at FROM essay_reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100", [userId]);
  return rows.map(summary);
}

export async function getEssayReport(id: string, userId: string): Promise<EssayDetail | null> {
  const { rows } = await query<EssayRow>(
    "SELECT id, user_id, prompt_text, original_text, grade_level, report_json, created_at FROM essay_reports WHERE id = $1 AND user_id = $2", [id, userId]);
  const row = rows[0];
  if (!row) return null;
  return {
    ...summary(row), originalText: row.original_text, gradeLevel: row.grade_level,
    report: parseEssayReport(row.report_json, row.original_text),
  };
}

export async function insertEssayReport(input: {
  id: string; userId: string; promptText: string; originalText: string;
  gradeLevel: string; reportJson: string; createdAt: string;
}): Promise<void> {
  await query("INSERT INTO essay_reports (id, user_id, prompt_text, original_text, grade_level, report_json, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)",
    [input.id, input.userId, input.promptText, input.originalText, input.gradeLevel, input.reportJson, input.createdAt]);
}
