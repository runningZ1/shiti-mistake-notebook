import { query } from "@/db/client";
import { authenticate } from "@/lib/api-guard";
import { makeMistakesDocx, mistakesDocxFilename } from "@/lib/mistake-docx";
import { isVisualQuestion, loadWordSourceImage, needsOriginalPicture } from "@/lib/word-source";
import { parseMistakePrintOptions, type MistakePrintOptions } from "@/lib/mistake-print-options";

type Row = {
  id: string; upload_id: string; subject: string; question: string; question_bounds: number[];
  incorrect_answer: string; correct_answer: string; reasoning: string; reflection: string; knowledge_point: string;
  page_number: number; source_name: string; created_at: string;
  similar_questions: { question: string; answer: string; explanation: string }[];
};

export async function GET(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const searchParams = new URL(request.url).searchParams;
  let options: MistakePrintOptions | undefined;
  try {
    options = parseMistakePrintOptions(searchParams);
  } catch {
    return Response.json({ error: "打印设置无效，请重新选择" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  const ids = [...new Set(searchParams.getAll("id"))];
  if (ids.length < 2 || ids.length > 30 || ids.some(id => !id || id.length > 128)) {
    return Response.json({ error: "请选择 2 至 30 道错题合并下载" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  let imageFailure = "";
  try {
    const placeholders = ids.map((_, index) => `$${index + 2}`).join(",");
    const { rows: results } = await query<Row>(
      `SELECT id, upload_id, subject, question, question_bounds, incorrect_answer, correct_answer, reasoning, reflection, knowledge_point, page_number, source_name, created_at, similar_questions FROM mistakes WHERE user_id = $1 AND id IN (${placeholders})`,
      [auth.user.userId, ...ids]);
    if (results.length !== ids.length) return Response.json({ error: "部分错题不存在或无权访问" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
    const rows = new Map(results.map(row => [row.id, row]));
    const imageCache = new Map<string, ReturnType<typeof loadWordSourceImage>>();
    const sourceFor = (row: Row) => {
      const key = `${row.upload_id}:${row.page_number}`;
      let pending = imageCache.get(key);
      if (!pending) {
        pending = loadWordSourceImage(auth.user.userId, row.upload_id, row.page_number);
        imageCache.set(key, pending);
      }
      return pending;
    };
    const items = await Promise.all(ids.map(async (id, index) => {
      const row = rows.get(id)!;
      let sourceImage;
      if (needsOriginalPicture(row.subject, row.question)) {
        try {
          sourceImage = await sourceFor(row);
        } catch {
          imageFailure = `第 ${index + 1} 题原图不可读或暂不可用，请使用页面生成 Word 转换原图，或重新加载后重试`;
          throw new Error("Source image unavailable");
        }
      }
      return {
        subject: row.subject, question: row.question, incorrectAnswer: row.incorrect_answer,
        questionBounds: row.question_bounds,
        correctAnswer: row.correct_answer, reasoning: row.reasoning, reflection: row.reflection, knowledgePoint: row.knowledge_point,
        pageNumber: row.page_number, sourceName: row.source_name, createdAt: row.created_at,
        similarQuestions: row.similar_questions,
        visualQuestion: isVisualQuestion(row.question),
        ...(sourceImage ? { sourceImage } : {}),
      };
    }));
    const bytes = makeMistakesDocx(items, options);
    const name = mistakesDocxFilename(items, options);
    return new Response(bytes.buffer, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="mistake-batch.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    } });
  } catch {
    console.error("Batch Word export failed");
    return Response.json({ error: imageFailure || "Word 文档生成失败，请稍后重试" }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
