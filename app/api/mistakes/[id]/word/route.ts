import { query } from "@/db/client";
import { authenticate } from "@/lib/api-guard";
import { makeMistakeDocx, mistakeDocxFilename } from "@/lib/mistake-docx";
import { isVisualQuestion, loadWordSourceImage, needsOriginalPicture } from "@/lib/word-source";
import { parseMistakePrintOptions, type MistakePrintOptions } from "@/lib/mistake-print-options";

type MistakeRow = {
  archive_kind: "mistake" | "collection"; judgement_source: string;
  upload_id: string;
  subject: string;
  question: string;
  question_bounds: number[];
  incorrect_answer: string;
  correct_answer: string;
  reasoning: string;
  reflection: string;
  knowledge_point: string;
  page_number: number;
  source_name: string;
  created_at: string;
  similar_questions: { question: string; answer: string; explanation: string }[];
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  let options: MistakePrintOptions | undefined;
  try {
    options = parseMistakePrintOptions(new URL(request.url).searchParams);
  } catch {
    return Response.json({ error: "打印设置无效，请重新选择" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  let imageFailure = false;

  try {
    const { rows } = await query<MistakeRow>(
      "SELECT upload_id, subject, question, question_bounds, incorrect_answer, correct_answer, reasoning, reflection, knowledge_point, page_number, source_name, created_at, similar_questions, archive_kind, judgement_source FROM mistakes WHERE id = $1 AND user_id = $2 AND profile_id = $3 AND removed_at IS NULL",
      [(await params).id, auth.user.userId, auth.profileId]);
    const row = rows[0];
    if (!row) return Response.json({ error: "错题不存在或无权访问" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

    let sourceImage;
    if (needsOriginalPicture(row.subject, row.question, row.archive_kind, row.judgement_source)) {
      try {
        sourceImage = await loadWordSourceImage(auth.user.userId, row.upload_id, row.page_number);
      } catch {
        imageFailure = true;
        throw new Error("Source image unavailable");
      }
    }
    const item = {
      subject: row.subject,
      question: row.question,
      questionBounds: row.question_bounds, archiveKind: row.archive_kind, judgementSource: row.judgement_source,
      incorrectAnswer: row.incorrect_answer,
      correctAnswer: row.correct_answer,
      reasoning: row.reasoning,
      reflection: row.reflection,
      knowledgePoint: row.knowledge_point,
      pageNumber: row.page_number,
      sourceName: row.source_name,
      createdAt: row.created_at,
      similarQuestions: row.similar_questions,
      visualQuestion: isVisualQuestion(row.question),
      ...(sourceImage ? { sourceImage } : {}),
    };
    const bytes = makeMistakeDocx(item, options);
    const name = mistakeDocxFilename(item, options);
    return new Response(bytes.buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="mistake.docx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    console.error("Mistake Word export failed");
    return Response.json({ error: imageFailure ? "第 1 题原图不可读或暂不可用，请使用页面生成 Word 转换原图，或重新加载后重试" : "Word 文档生成失败，请稍后重试" }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
