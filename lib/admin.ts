import { env } from "cloudflare:workers";
import { query, transaction } from "@/db/client";

export class AdminInputError extends Error {}

export function adminPagination(params: URLSearchParams) {
  const read = (name: string, defaultValue: number, max: number) => {
    const raw = params.get(name);
    if (raw === null) return defaultValue;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > max) {
      throw new AdminInputError(`${name} 必须是 1–${max} 之间的整数`);
    }
    return value;
  };
  return { page: read("page", 1, 1_000_000), pageSize: read("pageSize", 20, 100) };
}

function stringArray(raw: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("文件索引必须是字符串数组");
  return value;
}

export type AdminOverviewStats = {
  totalUsers: number; activeUsers: number; adminUsers: number;
  totalMistakes: number; totalUploads: number; totalSimilarQuestions: number;
  subjectDistribution: { subject: string; count: number; percentage: number }[];
  recentMistakes: { id: string; subject: string; question: string; knowledgePoint: string; createdAt: string; username: string; displayName: string }[];
  recentUsers: { id: string; username: string; displayName: string; role: string; status: string; createdAt: string; lastLoginAt: string | null }[];
  recentUploads: { id: string; subject: string; fileNames: string[]; createdAt: string; username: string; displayName: string; mistakeCount: number }[];
};

type MistakeRow = {
  id: string; upload_id: string; user_id: string; subject: string; question: string;
  incorrect_answer: string; correct_answer: string; reasoning: string; knowledge_point: string;
  page_number: number; source_name: string; similar_questions: string; created_at: string;
  username: string | null; display_name: string | null;
};
type UploadRow = {
  id: string; user_id: string; subject: string; file_keys: string; file_names: string;
  created_at: string; username: string | null; display_name: string | null; mistake_count: string;
};

export async function getAdminOverviewStats(): Promise<AdminOverviewStats> {
  const [users, mistakes, uploads, subjects, recentMistakes, recentUsers, recentUploads] = await Promise.all([
    query<{ total: string; active: string; admins: string }>("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active' AND deletion_started_at IS NULL) AS active, COUNT(*) FILTER (WHERE role = 'admin') AS admins FROM users"),
    query<{ total: string; similar: string }>("SELECT COUNT(*) AS total, coalesce(SUM(jsonb_array_length(similar_questions)), 0) AS similar FROM mistakes"),
    query<{ total: string }>("SELECT COUNT(*) AS total FROM uploads"),
    query<{ subject: string; count: string }>("SELECT subject, COUNT(*) AS count FROM mistakes GROUP BY subject ORDER BY count DESC"),
    query<MistakeRow>("SELECT m.id, m.subject, m.question, m.knowledge_point, m.created_at, u.username, u.display_name FROM mistakes m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at DESC LIMIT 8"),
    query<{ id: string; username: string; display_name: string; role: string; status: string; created_at: string; last_login_at: string | null }>("SELECT id, username, display_name, role, status, created_at, last_login_at FROM users ORDER BY created_at DESC LIMIT 5"),
    query<UploadRow>("SELECT up.id, up.subject, up.file_names::text, up.created_at, u.username, u.display_name, COUNT(m.id) AS mistake_count FROM uploads up LEFT JOIN users u ON u.id = up.user_id LEFT JOIN mistakes m ON m.upload_id = up.id GROUP BY up.id, u.id ORDER BY up.created_at DESC LIMIT 5"),
  ]);
  const totalMistakes = Number(mistakes.rows[0].total);
  return {
    totalUsers: Number(users.rows[0].total), activeUsers: Number(users.rows[0].active), adminUsers: Number(users.rows[0].admins),
    totalMistakes, totalUploads: Number(uploads.rows[0].total), totalSimilarQuestions: Number(mistakes.rows[0].similar),
    subjectDistribution: subjects.rows.map(row => ({ subject: row.subject || "未分类", count: Number(row.count), percentage: totalMistakes ? Math.round(Number(row.count) / totalMistakes * 100) : 0 })),
    recentMistakes: recentMistakes.rows.map(row => ({ id: row.id, subject: row.subject, question: row.question.length > 80 ? row.question.slice(0, 80) + "..." : row.question, knowledgePoint: row.knowledge_point || "未标明", createdAt: row.created_at, username: row.username || "已删除用户", displayName: row.display_name || "未知用户" })),
    recentUsers: recentUsers.rows.map(row => ({ id: row.id, username: row.username, displayName: row.display_name, role: row.role, status: row.status, createdAt: row.created_at, lastLoginAt: row.last_login_at })),
    recentUploads: recentUploads.rows.map(row => ({ id: row.id, subject: row.subject, fileNames: stringArray(row.file_names), createdAt: row.created_at, username: row.username || "已删除用户", displayName: row.display_name || "未知用户", mistakeCount: Number(row.mistake_count) })),
  };
}

export type AdminMistakeItem = {
  id: string; uploadId: string; userId: string; username: string; displayName: string;
  subject: string; question: string; incorrectAnswer: string; correctAnswer: string;
  reasoning: string; knowledgePoint: string; pageNumber: number; sourceName: string;
  similarQuestions: Array<{ question: string; answer: string; explanation: string }>;
  createdAt: string;
};
export async function listAdminMistakes(params: {
  page?: number; pageSize?: number; search?: string; subject?: string; userId?: string; uploadId?: string;
}): Promise<{ mistakes: AdminMistakeItem[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.search?.trim()) {
    values.push(`%${params.search.trim()}%`);
    const parameter = `$${values.length}`;
    conditions.push(`(m.question ILIKE ${parameter} OR m.knowledge_point ILIKE ${parameter} OR m.source_name ILIKE ${parameter} OR m.incorrect_answer ILIKE ${parameter} OR m.correct_answer ILIKE ${parameter})`);
  }
  if (params.subject && !["all", "全部科目"].includes(params.subject)) {
    values.push(params.subject);
    conditions.push(`m.subject = $${values.length}`);
  }
  for (const [column, value] of [["m.user_id", params.userId], ["m.upload_id", params.uploadId]] as const) {
    if (value?.trim()) {
      values.push(value.trim());
      conditions.push(`${column} = $${values.length}`);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await query<{ total: string }>(`SELECT COUNT(*) AS total FROM mistakes m ${where}`, values);
  const total = Number(count.rows[0].total);
  const { rows } = await query<MistakeRow>(
    `SELECT m.id, m.upload_id, m.user_id, m.subject, m.question, m.incorrect_answer, m.correct_answer, m.reasoning, m.knowledge_point, m.page_number, m.source_name, m.similar_questions::text, m.created_at, u.username, u.display_name FROM mistakes m LEFT JOIN users u ON u.id = m.user_id ${where} ORDER BY m.created_at DESC, m.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    mistakes: rows.map(row => ({ id: row.id, uploadId: row.upload_id, userId: row.user_id, username: row.username || "已删除用户", displayName: row.display_name || "未知用户", subject: row.subject, question: row.question, incorrectAnswer: row.incorrect_answer, correctAnswer: row.correct_answer, reasoning: row.reasoning, knowledgePoint: row.knowledge_point, pageNumber: row.page_number, sourceName: row.source_name, similarQuestions: JSON.parse(row.similar_questions), createdAt: row.created_at })),
    total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1,
  };
}

export async function updateAdminMistake(id: string, data: {
  subject?: string; question?: string; incorrectAnswer?: string; correctAnswer?: string; reasoning?: string; knowledgePoint?: string;
}): Promise<boolean> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new AdminInputError("请提交错题修改内容");
  const columns = { subject: "subject", question: "question", incorrectAnswer: "incorrect_answer", correctAnswer: "correct_answer", reasoning: "reasoning", knowledgePoint: "knowledge_point" } as const;
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(data)) {
    if (!Object.hasOwn(columns, key)) throw new AdminInputError("包含不支持修改的字段");
    const field = key as keyof typeof columns;
    const value = data[field];
    if (typeof value !== "string" || value.length > (key === "subject" ? 100 : 50_000)) throw new AdminInputError("修改内容格式错误或过长");
    if (["subject", "question", "correctAnswer"].includes(key) && !value.trim()) throw new AdminInputError("科目、题干和正确答案不能为空");
    values.push(value.trim());
    sets.push(`${columns[field]} = $${values.length}`);
  }
  if (sets.length === 0) throw new AdminInputError("请至少修改一个字段");
  values.push(id);
  const result = await query(`UPDATE mistakes SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  return (result.rowCount ?? 0) > 0;
}
export async function deleteAdminMistake(id: string): Promise<boolean> {
  const result = await query("DELETE FROM mistakes WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

export type AdminUploadItem = {
  id: string; userId: string; username: string; displayName: string; subject: string;
  fileKeys: string[]; fileNames: string[]; mistakeCount: number; createdAt: string;
};
export async function listAdminUploads(params: {
  page?: number; pageSize?: number; search?: string; userId?: string;
}): Promise<{ uploads: AdminUploadItem[]; total: number; page: number; pageSize: number; totalPages: number }> {
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (params.search?.trim()) {
    values.push(`%${params.search.trim()}%`);
    conditions.push(`(up.file_names::text ILIKE $${values.length} OR up.subject ILIKE $${values.length})`);
  }
  if (params.userId?.trim()) {
    values.push(params.userId.trim());
    conditions.push(`up.user_id = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await query<{ total: string }>(`SELECT COUNT(*) AS total FROM uploads up ${where}`, values);
  const total = Number(count.rows[0].total);
  const { rows } = await query<UploadRow>(
    `SELECT up.id, up.user_id, up.subject, up.file_keys::text, up.file_names::text, up.created_at, u.username, u.display_name, COUNT(m.id) AS mistake_count FROM uploads up LEFT JOIN users u ON u.id = up.user_id LEFT JOIN mistakes m ON m.upload_id = up.id ${where} GROUP BY up.id, u.id ORDER BY up.created_at DESC, up.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );
  return {
    uploads: rows.map(row => ({ id: row.id, userId: row.user_id, username: row.username || "已删除用户", displayName: row.display_name || "未知用户", subject: row.subject, fileKeys: stringArray(row.file_keys), fileNames: stringArray(row.file_names), mistakeCount: Number(row.mistake_count), createdAt: row.created_at })),
    total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1,
  };
}
export async function deleteAdminUpload(id: string): Promise<string[] | null> {
  return transaction(async client => {
    const { rows } = await client.query<{ file_keys: string }>("SELECT file_keys::text FROM uploads WHERE id = $1 FOR UPDATE", [id]);
    if (!rows[0]) return null;
    const keys = [...new Set(stringArray(rows[0].file_keys))];
    if (keys.some(key => !key)) throw new Error("上传文件索引损坏，请先修复后再删除");
    if (keys.length) {
      if (!env.BUCKET) throw new Error("R2 未绑定，已保留批次以便重试");
      for (let offset = 0; offset < keys.length; offset += 1000) await env.BUCKET.delete(keys.slice(offset, offset + 1000));
    }
    await client.query("DELETE FROM mistakes WHERE upload_id = $1", [id]);
    await client.query("DELETE FROM uploads WHERE id = $1", [id]);
    await client.query("DELETE FROM upload_objects WHERE key = ANY($1::text[])", [keys]);
    return keys;
  });
}

export type AdminSystemStatus = {
  dbStatus: "ok" | "error"; dbLatencyMs: number;
  tableStats: { users: number; uploads: number; mistakes: number };
  r2Configured: boolean; aiConfigured: boolean; aiModel: string;
  security: { sessionSecretConfigured: boolean; trustOaiHeadersDisabled: boolean };
  timestamp: string;
};
export async function getAdminSystemStatus(): Promise<AdminSystemStatus> {
  const startTime = Date.now();
  const { rows } = await query<{ users: string; uploads: string; mistakes: string }>("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM uploads) AS uploads, (SELECT COUNT(*) FROM mistakes) AS mistakes");
  const key = env.DEEPSEEK_API_KEY?.trim();
  return {
    dbStatus: "ok", dbLatencyMs: Date.now() - startTime,
    tableStats: { users: Number(rows[0].users), uploads: Number(rows[0].uploads), mistakes: Number(rows[0].mistakes) },
    r2Configured: Boolean(env.BUCKET), aiConfigured: Boolean(key && !["placeholder_key", "local-e2e-dummy-key"].includes(key)),
    aiModel: "deepseek-flash (多模态视觉识别与解析)",
    security: { sessionSecretConfigured: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32), trustOaiHeadersDisabled: env.TRUST_OAI_HEADERS !== "1" },
    timestamp: new Date().toISOString(),
  };
}
