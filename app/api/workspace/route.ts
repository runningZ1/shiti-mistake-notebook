import {authenticate} from '@/lib/api-guard';
import {query} from '@/db/client';
export async function GET(){
 const auth=await authenticate();if('response'in auth)return auth.response;
 try{const {rows}=await query<{pending:number;corrections:number;reviews:number;continueUpload:string|null}>(`SELECT
  (SELECT count(*)::int FROM upload_questions WHERE user_id=$1 AND profile_id=$2 AND state='pending') AS pending,
  (SELECT count(*)::int FROM learning_reviews WHERE user_id=$1 AND profile_id=$2 AND state='needs_correction') AS corrections,
  (SELECT count(*)::int FROM learning_reviews WHERE user_id=$1 AND profile_id=$2 AND state='needs_review' AND review_on<=(now() AT TIME ZONE 'Asia/Shanghai')::date) AS reviews,
  (SELECT id FROM uploads u WHERE user_id=$1 AND profile_id=$2 AND (analysis_status<>'completed' OR EXISTS(SELECT 1 FROM upload_questions q WHERE q.upload_id=u.id AND q.state='pending')) ORDER BY created_at DESC LIMIT 1) AS "continueUpload"`,[auth.user.userId,auth.profileId]);return Response.json(rows[0],{headers:{'Cache-Control':'private, no-store'}});}catch{return Response.json({error:'待办读取失败'},{status:503});}
}
