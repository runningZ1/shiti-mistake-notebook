import { authenticateForAi } from "@/lib/api-guard";
import { isSameOriginRequest } from "@/lib/auth";
import { UploadError } from "@/lib/uploads";
import { enqueueJob } from "@/lib/processing-jobs";
import { requireProfile } from "@/lib/profiles";
import { OcrError } from "@/lib/baidu-ocr";
import { AiServiceError } from "@/lib/ai";

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  if (!isSameOriginRequest(request)) return Response.json({error:"请求来源不被允许"},{status:403});
  const auth=await authenticateForAi();
  if ("response" in auth) return auth.response;
  const {id}=await params;
  try { const p=await requireProfile(auth.user.userId);let body:{kind?:string}={};try{body=await request.json();}catch{/* Legacy empty POST means analyze confirmed questions. */} const kind=body.kind==='recognize'?'recognize':'analyze';return Response.json({job:await enqueueJob(id,auth.user.userId,p.id,kind)},{status:202,headers:{"Cache-Control":"private, no-store"}}); }
  catch(error) { return Response.json({error:error instanceof UploadError || error instanceof OcrError || error instanceof AiServiceError ? error.message : "分析失败，原图已保留，请重试",uploadId:id},{status:error instanceof UploadError || error instanceof OcrError || error instanceof AiServiceError ? error.status : 500}); }
}
