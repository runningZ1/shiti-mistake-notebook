import { scope, paperSource, beginAttempt, finishAttempt, failAttempt, LearningError } from '@/lib/learning-history';
import { isSameOriginRequest } from '@/lib/auth';
import { authenticate, authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, gradeUnitPaper } from "@/lib/ai";
import { getPracticePaper, paperDetail, parsePaper } from "@/lib/practice-papers";
import type { PracticeGrade } from "@/lib/practice-types";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return Response.json({error:"请求来源不被允许"},{status:403});
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  const body = await request.json().catch(() => null) as { answers?: unknown; attemptId?: unknown } | null;
  if (!Array.isArray(body?.answers) || body.answers.some(answer => typeof answer !== "string" || answer.length > 2000) ||
    !body.answers.some(answer => answer.trim())) {
    return Response.json({ error: "作答格式不正确，请至少完成一题，单题最多 2000 字" }, { status: 400 });
  }
  let active: { s: Awaited<ReturnType<typeof scope>>; id:string; token:string } | null = null;
  if (typeof body?.attemptId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.attemptId)) return Response.json({error:'请提供有效的 attemptId'},{status:400});
  try {
    const id = (await params).id;
    const row = await getPracticePaper(id, auth.user.userId);
    if (!row) return Response.json({ error: "练习卷不存在" }, { status: 404 });

    const { questions } = parsePaper(row);
    if (body.answers.length !== questions.length) {
      return Response.json({ error: "作答数量与题目数量不一致" }, { status: 400 });
    }
    const answers = body.answers.map(answer => answer.trim()) as string[];
    const s = await scope(auth.user.userId);
    const source=await paperSource(s,id);
    const needsHuman=source?.source==='original'||questions.some(q=>!q.answer?.trim());
    if(!needsHuman){const access=await authenticateForAi();if('response' in access)return access.response;}
    const started = await beginAttempt(s,body.attemptId,id,answers);
    if(started.cached) return Response.json({paper:paperDetail({...row,answers:started.cached.answers,grading:started.cached.grading,graded_at:started.cached.completed_at}),attempt:started.cached},{headers:{'Cache-Control':'no-store'}});
    active={s,id:body.attemptId,token:started.token!};
    // Original images are shown for human review; this text grader cannot assess them.
    if(!needsHuman&&!aiConfigured())throw new LearningError('AI 服务尚未配置',503);
    const result = needsHuman ? questions.map((_,index)=>({index,verdict:'uncertain' as const,comment:'原题/缺少可靠参考答案：仅保存实际作答，请对照原图和老师答案人工核对。'})) : await gradeUnitPaper(questions, answers);
    const grading: PracticeGrade[] = result.map((item, index) => ({
      ...item, answer: questions[index].answer, explanation: questions[index].explanation,
      knowledgePoint: questions[index].knowledgePoint,
    }));
    const gradedAt = new Date().toISOString();
    const attempt = await finishAttempt(s,body.attemptId,active.token,grading,needsHuman?'unassessed':'ai');
    return Response.json({ paper: paperDetail({ ...row, answers, grading, graded_at: gradedAt }), attempt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if(active) await failAttempt(active.s,active.id,active.token,error instanceof Error?error.message:"批改失败");
    return Response.json({ error: error instanceof Error ? error.message : "批改失败，请重试" }, { status: error instanceof LearningError ? error.status : 500 });
  }
}
