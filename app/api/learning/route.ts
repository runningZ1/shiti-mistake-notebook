import { authenticate } from '@/lib/api-guard';
import { isSameOriginRequest } from '@/lib/auth';
import { z } from 'zod';
import { scope, learningEvidence, getDraft, saveDraft, practiceHistory, paperSource, listVersions, saveVersion, reviews, reviewEvents, addReview, LearningError } from '@/lib/learning-history';
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request) {
 const auth=await authenticate();if('response' in auth)return auth.response;
 try {const s=await scope(auth.user.userId);const u=new URL(request.url);const kind=u.searchParams.get('kind');
 if(kind==='evidence')return Response.json(await learningEvidence(s),{headers});
 if(kind==='practice')return Response.json({profileId:s.profileId,source:await paperSource(s,u.searchParams.get('sourceId')||''),attempts:await practiceHistory(s,u.searchParams.get('sourceId')||''),draft:await getDraft(s,'practice',u.searchParams.get('sourceId')||'')},{headers});
 if(kind==='essay')return Response.json({profileId:s.profileId,versions:await listVersions(s),draft:await getDraft(s,'essay','current')},{headers});
 return Response.json({profileId:s.profileId,reviews:await reviews(s),events:await reviewEvents(s)},{headers});
 }catch(e){return failure(e);}
}
const draft=z.object({action:z.literal('draft'),kind:z.enum(['practice','essay']),sourceId:z.string().min(1).max(200),revision:z.number().int().min(0),payload:z.unknown()});
const version=z.object({action:z.literal('version'),id:z.string().uuid(),parentId:z.string().uuid().optional(),promptText:z.string().min(1).max(2000),originalText:z.string().min(1).max(10000),gradeLevel:z.string().max(30)});
const review=z.object({action:z.literal('review'),attemptId:z.string().uuid(),evidence:z.string().trim().min(1).max(4000),state:z.enum(['needs_correction','needs_review','reviewed']),reviewOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()});
const practicePayload=z.object({answers:z.array(z.string().max(2000)).max(30),attemptId:z.string().uuid()});
const essayPayload=z.object({promptText:z.string().max(2000),essayText:z.string().max(10000),gradeLevel:z.string().max(30),parentId:z.string().uuid().optional()});
export async function POST(request:Request) {
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const auth=await authenticate();if('response' in auth)return auth.response;
 try {const s=await scope(auth.user.userId);const b=z.discriminatedUnion('action',[draft,version,review]).parse(await request.json());
 if(b.action==='draft') {const payload=(b.kind==='practice'?practicePayload:essayPayload).parse(b.payload);if(b.kind==='essay'&&b.sourceId!=='current')throw new LearningError('作文草稿来源无效');return Response.json({draft:await saveDraft(s,b.kind,b.sourceId,payload,b.revision)},{headers});}
 if(b.action==='version')return Response.json({version:await saveVersion(s,b)},{headers});
 return Response.json({review:await addReview(s,b.attemptId,b.evidence,b.state,b.reviewOn)},{headers});
 }catch(e){return failure(e);}
}
function failure(e:unknown){return Response.json({error:e instanceof z.ZodError?'提交格式不正确':e instanceof Error?e.message:'学习记录保存失败'},{status:e instanceof LearningError?e.status:e instanceof z.ZodError?400:500,headers});}
