import { scope, saveVersion, saveVersionReport, storedVersionReport, essayAnalysisError, LearningError } from '@/lib/learning-history';
import { authenticate, authenticateForAi } from "@/lib/api-guard";
import { aiConfigured, analyzeEssay } from "@/lib/ai";
import { isSameOriginRequest } from "@/lib/auth";
import { EssayImageError, readEssayImages } from "@/lib/essay-images";
import { listEssayReports } from "@/lib/essay-reports";

export const runtime = "edge";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    return Response.json({ essays: await listEssayReports(auth.user.userId) }, { headers: noStore });
  } catch (error) {
    console.error("Essay list failed", error);
    return Response.json({ error: "作文记录加载失败" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "请求来源不被允许" }, { status: 403 });
  const auth = await authenticateForAi();
  if ("response" in auth) return auth.response;
  if (!aiConfigured()) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });

  let active: {s:Awaited<ReturnType<typeof scope>>;versionId:string}|null=null;
  try {
    const form = await request.formData();
    const prompt = form.get("promptText");
    const original = form.get("confirmedText");
    const grade = form.get("gradeLevel");
    const promptText = typeof prompt === "string" ? prompt.trim() : "";
    const originalText = typeof original === "string" ? original.trim() : "";
    const gradeLevel = typeof grade === "string" ? grade.trim() : "";
    if (!promptText || promptText.length > 2000 || originalText.length < 10 || originalText.length > 10000 ||
      !/[A-Za-z]/.test(originalText) || gradeLevel.length > 30) {
      return Response.json({ error: "请确认题目要求和作文原文，原文应为可辨认的英语内容" }, { status: 400 });
    }
    const s = await scope(auth.user.userId);
    const suppliedId=form.get('versionId');
    const parent=form.get('parentId');
    const versionId=typeof suppliedId==='string'&&/^[0-9a-f-]{36}$/i.test(suppliedId)?suppliedId:crypto.randomUUID();
    await saveVersion(s,{id:versionId,parentId:typeof parent==='string'&&parent?parent:undefined,promptText,originalText,gradeLevel});
    const cached=await storedVersionReport(s,versionId);
    if(cached)return Response.json({versionId,essay:{id:cached.id,promptText:cached.prompt_text,originalText:cached.original_text,gradeLevel:cached.grade_level,report:cached.report_json,createdAt:cached.created_at,excerpt:cached.original_text.replace(/\s+/g,' ').slice(0,100)}},{headers:noStore});
    active={s,versionId};
    const images = form.getAll('files').length ? await readEssayImages(form) : [];
    const report = await analyzeEssay({ confirmedText: originalText, promptText, gradeLevel, images });
    const id = await saveVersionReport(s,versionId,report);
    await essayAnalysisError(s,versionId,null);
    const stored=await storedVersionReport(s,versionId);
    const createdAt = stored!.created_at as string;

    return Response.json({ versionId, essay: { id, promptText, originalText, gradeLevel, report:stored!.report_json, createdAt,
      excerpt: originalText.replace(/\s+/g, " ").slice(0, 100) } }, { status: 201, headers: noStore });
  } catch (error) {
    if(active) await essayAnalysisError(active.s,active.versionId,error instanceof Error?error.message:'作文分析失败');
    if (error instanceof EssayImageError) return Response.json({ error: error.message }, { status: 400 });
    console.error("Essay analysis failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "作文分析失败，请重试" }, { status: error instanceof LearningError ? error.status : 500 });
  }
}
