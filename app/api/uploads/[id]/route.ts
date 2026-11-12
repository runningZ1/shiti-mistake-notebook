import { authenticate } from "@/lib/api-guard";
import { getUpload } from "@/lib/uploads";
import {query} from '@/db/client';
import {requireProfile} from '@/lib/profiles';
import {isSameOriginRequest} from '@/lib/auth';
import {isCalendarDate} from '@/lib/mistake-dates';
import {normalizeSubject} from '@/lib/question-types';

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const auth=await authenticate();if('response'in auth)return auth.response;
 try{const b=await request.json() as Record<string,unknown>;
  if(!b||typeof b!=="object")return Response.json({error:"请求无效"},{status:400});
  if(typeof b.title!=='string'||!b.title.trim()||b.title.length>200||typeof b.gradeLevel!=='string'||b.gradeLevel.length>60||typeof b.subject!=='string'||(typeof b.homeworkDate!=="string"||!isCalendarDate(b.homeworkDate)))return Response.json({error:'作业名称、年级、学科或日期无效'},{status:400});
  const p=await requireProfile(auth.user.userId);const {id}=await params;
  const result=await query('UPDATE uploads SET title=$4,grade_level=$5,original_subject=COALESCE(original_subject,subject),subject=$6,homework_date=$7::date WHERE id=$1 AND user_id=$2 AND profile_id=$3 RETURNING id',[id,auth.user.userId,p.id,b.title.trim(),b.gradeLevel.trim(),normalizeSubject(b.subject),b.homeworkDate]);
  if(!result.rowCount)return Response.json({error:'作业不存在'},{status:404});
  await query('UPDATE mistakes SET subject=$4 WHERE upload_id=$1 AND user_id=$2 AND profile_id=$3',[id,auth.user.userId,p.id,normalizeSubject(b.subject)]);
  return Response.json({saved:true});
 }catch{return Response.json({error:'保存失败，请重试'},{status:503});}
}

export async function GET(_request: Request, {params}: {params: Promise<{id:string}>}) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;
  try {
    const {id}=await params;
    const upload=await getUpload(id,auth.user.userId);
    return Response.json(upload ? {upload} : {error:"上传记录不存在"},{status:upload?200:404,headers:{"Cache-Control":"private, no-store"}});
  } catch { return Response.json({error:"分析记录读取失败，请重试"},{status:503}); }
}
