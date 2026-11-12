import { z } from 'zod';
import { getPracticePaper, paperDetail } from '@/lib/practice-papers';
import { authenticate } from '@/lib/api-guard';
import { isSameOriginRequest } from '@/lib/auth';
import { scope,retryMistake,LearningError } from '@/lib/learning-history';
export async function POST(request:Request) {
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const auth=await authenticate();if('response' in auth)return auth.response;
 try {const b=z.object({mistakeId:z.string().min(1).max(256),mode:z.enum(['original','similar'])}).parse(await request.json());
 const s=await scope(auth.user.userId);const id=await retryMistake(s,b.mistakeId,b.mode==='similar');const row=await getPracticePaper(id,s.userId,s.profileId);if(!row)throw new LearningError('练习读取失败',500);return Response.json({paper:paperDetail(row),paperId:id,url:`/?view=practice&paper=${encodeURIComponent(id)}`},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'创建失败'},{status:e instanceof LearningError?e.status:e instanceof z.ZodError?400:500});}
}
