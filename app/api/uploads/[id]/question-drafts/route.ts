import {z} from 'zod';
import {authenticate} from '@/lib/api-guard';
import {query} from '@/db/client';
import {isSameOriginRequest} from '@/lib/auth';
const payload=z.object({id:z.string(),version:z.number().int().min(0),pageNumber:z.number().int().min(1).max(4),question:z.string().max(20000),studentAnswer:z.string().max(20000),referenceAnswer:z.string().max(20000),referenceSource:z.string().max(20000),bounds:z.array(z.number().int().min(0).max(1000)).max(4),state:z.enum(['pending','confirmed','ignored']),hasFigure:z.boolean()});
async function scope(request:Request,id:string){
 const a=await authenticate();if('response'in a)return a;
 const p=new URL(request.url).searchParams;if(p.get('profileId')!==a.profileId)return{response:Response.json({error:'档案已切换，当前输入保留'},{status:409})};
 const key=p.get('question')||'new';if(!/^[\w:-]{1,128}$/.test(key))return{response:Response.json({error:'草稿标识无效'},{status:400})};
 const up=await query('SELECT id FROM uploads WHERE id=$1 AND user_id=$2 AND profile_id=$3',[id,a.user.userId,a.profileId]);
 if(!up.rowCount)return{response:Response.json({error:'作业不存在'},{status:404})};return{userId:a.user.userId,profileId:a.profileId,key};
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const{id}=await params;const s=await scope(request,id);if('response'in s)return s.response;
 const{rows}=await query('SELECT revision,payload FROM question_edit_drafts WHERE upload_id=$1 AND user_id=$2 AND profile_id=$3 AND draft_key=$4',[id,s.userId,s.profileId,s.key]);return Response.json({draft:rows[0]||null},{headers:{'Cache-Control':'private, no-store'}});
}
export async function PUT(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const{id}=await params;const s=await scope(request,id);if('response'in s)return s.response;
 try{const b=z.object({revision:z.number().int().min(0),payload}).parse(await request.json());
 const result=b.revision===0?await query(`INSERT INTO question_edit_drafts(upload_id,user_id,profile_id,draft_key,payload)VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING revision`,[id,s.userId,s.profileId,s.key,JSON.stringify(b.payload)]):await query(`UPDATE question_edit_drafts SET payload=$5::jsonb,revision=revision+1,updated_at=now() WHERE upload_id=$1 AND user_id=$2 AND profile_id=$3 AND draft_key=$4 AND revision=$6 RETURNING revision`,[id,s.userId,s.profileId,s.key,JSON.stringify(b.payload),b.revision]);
 if(!result.rowCount)return Response.json({error:'其他页面已更新草稿，请重新加载草稿后合并；当前输入仍保留'},{status:409});return Response.json({revision:result.rows[0].revision});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'草稿字段无效':'草稿保存失败，输入仍保留'},{status:e instanceof z.ZodError?400:503});}
}
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const{id}=await params;const s=await scope(request,id);if('response'in s)return s.response;
 const revision=Number(new URL(request.url).searchParams.get('revision'));
 if(!Number.isSafeInteger(revision)||revision<1)return Response.json({error:'草稿版本无效'},{status:400});
 const r=await query('DELETE FROM question_edit_drafts WHERE upload_id=$1 AND user_id=$2 AND profile_id=$3 AND draft_key=$4 AND revision=$5',[id,s.userId,s.profileId,s.key,revision]);return Response.json({deleted:Boolean(r.rowCount)});
}
