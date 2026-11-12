import {authenticate} from '@/lib/api-guard';
import {isSameOriginRequest} from '@/lib/auth';
import {saveQuestion,archiveQuestion} from '@/lib/questions';
import {UploadError} from '@/lib/uploads';
import {query} from '@/db/client';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const auth=await authenticate();if('response'in auth)return auth.response;const {id}=await params;const questionId=new URL(request.url).searchParams.get('question');
 const owner=await query('SELECT id FROM upload_questions WHERE id=$1 AND upload_id=$2 AND user_id=$3 AND profile_id=$4',[questionId,id,auth.user.userId,auth.profileId]);if(!owner.rowCount)return Response.json({error:'题目不存在'},{status:404});
 const versions=await query('SELECT version,content,created_at FROM question_versions WHERE question_id=$1 ORDER BY version DESC',[questionId]);const reports=await query('SELECT input_version AS "inputVersion",report,created_at FROM question_reports WHERE question_id=$1 ORDER BY created_at DESC,id DESC',[questionId]);
 return Response.json({versions:versions.rows,reports:reports.rows},{headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!isSameOriginRequest(request))return Response.json({error:'请求来源不被允许'},{status:403});
 const auth=await authenticate();if('response'in auth)return auth.response;
 try {
  const body=await request.json() as Record<string,unknown>;if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'请求格式不正确'},{status:400});
  const {id}=await params;
  const result=body.action==='archive'?await archiveQuestion(id,auth.user.userId,String(body.id),Number(body.version),String(body.kind)):await saveQuestion(id,auth.user.userId,body);
  return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch(e){return Response.json({error:e instanceof UploadError?e.message:e instanceof SyntaxError?'请求JSON无效':'保存失败，请保留输入后重试'},{status:e instanceof UploadError?e.status:e instanceof SyntaxError?400:503});}
}
