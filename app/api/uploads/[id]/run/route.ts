import {authenticateForAi} from '@/lib/api-guard';
import {requireProfile} from '@/lib/profiles';
import {isSameOriginRequest} from '@/lib/auth';
import {runNextJob} from '@/lib/processing-jobs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const auth=await authenticateForAi();if('response'in auth)return auth.response;
 const p=await requireProfile(auth.user.userId);const {id}=await params;
 try{return Response.json({processed:await runNextJob({uploadId:id,userId:auth.user.userId,profileId:p.id})});}catch{return Response.json({error:'执行失败，任务已保留'},{status:503});}
}
