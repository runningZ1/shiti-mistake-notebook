import { query } from "@/db/client";
import { authenticate } from "@/lib/api-guard";

const headers = { "Cache-Control": "private, no-store" };

function fail(error: string, status: number): Response {
  return Response.json({ error }, { status, headers });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("请求 JSON 格式不正确", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return fail("请求格式不正确", 400);
  }
  if (Object.keys(body).length !== 1 || !("reflection" in body)) {
    return fail("只允许保存我的错因字段", 400);
  }
  if (typeof body.reflection !== "string") return fail("我的错因必须是文本", 400);
  const reflection = body.reflection.trim();
  if ([...reflection].length > 1000) return fail("我的错因最多填写1000个字符", 400);

  const { id } = await params;
  try {
    const { rows } = await query(
      `UPDATE mistakes SET reflection = $3 WHERE id = $1 AND user_id = $2
       RETURNING id, upload_id AS "uploadId", subject, question, question_bounds AS "questionBounds",
         incorrect_answer AS "incorrectAnswer", correct_answer AS "correctAnswer", reasoning, reflection,
         knowledge_point AS "knowledgePoint", page_number AS "pageNumber", source_name AS "sourceName",
         similar_questions AS "similarQuestions", created_at AS "createdAt"`,
      [id, auth.user.userId, reflection],
    );
    if (!rows[0]) return fail("错题不存在", 404);
    return Response.json({ mistake: rows[0] }, { headers });
  } catch (error) {
    // 账号状态触发器拒绝在认证后被停用或开始删除的账号继续写入。
    if (error !== null && typeof error === "object" && "code" in error && error.code === "23514"
      && (!("constraint" in error) || !error.constraint)) {
      return fail("账号不可用，无法保存我的错因", 403);
    }
    console.error("Mistake reflection update failed");
    return fail("我的错因保存失败，请稍后重试", 500);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const user = auth.user;
  const { id } = await params;
  try {
    const result = await query("DELETE FROM mistakes WHERE id = $1 AND user_id = $2", [id, user.userId]);
    return Response.json({ deleted: (result.rowCount ?? 0) > 0 }, { headers });
  } catch {
    console.error("Mistake deletion failed");
    return fail("删除错题失败，请稍后重试", 500);
  }
}
