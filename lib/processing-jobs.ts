import {query,transaction} from '@/db/client';
import {imageStorage} from '@/lib/storage';
import {recognizePages,type OcrPage} from '@/lib/baidu-ocr';
import {analyzePages} from '@/lib/ai';
import {imageBase64,UploadError} from '@/lib/uploads';
import {seedQuestions,listQuestions} from '@/lib/questions';
import {normalizeSubject} from '@/lib/question-types';

export async function enqueueJob(uploadId:string,userId:string,profileId:string,kind:'recognize'|'analyze') {
 return transaction(async c=>{
  const up=await c.query('SELECT id FROM uploads WHERE id=$1 AND user_id=$2 AND profile_id=$3 FOR UPDATE',[uploadId,userId,profileId]);
  if(!up.rowCount)throw new UploadError('作业不存在',404);
  const running=await c.query("SELECT id FROM processing_jobs WHERE upload_id=$1 AND kind=$2 AND status IN ('queued','running')",[uploadId,kind]);
  if(running.rowCount)return running.rows[0];
  const versions:Record<string,number>={};
  if(kind==='analyze'){
   const qs=await c.query<{id:string;version:number}>("SELECT id,version FROM upload_questions WHERE upload_id=$1 AND user_id=$2 AND profile_id=$3 AND state='confirmed'",[uploadId,userId,profileId]);
   if(!qs.rowCount)throw new UploadError('请先保存并确认至少一道题目',409);
   for(const q of qs.rows)versions[q.id]=q.version;
   const missing=await c.query(`SELECT q.id FROM upload_questions q WHERE q.upload_id=$1 AND q.state='confirmed' AND NOT EXISTS(SELECT 1 FROM question_reports r WHERE r.question_id=q.id AND r.input_version=q.version) LIMIT 1`,[uploadId]);
   if(!missing.rowCount){const prior=await c.query("SELECT id FROM processing_jobs WHERE upload_id=$1 AND kind='analyze' AND status='completed' ORDER BY created_at DESC LIMIT 1",[uploadId]);if(prior.rows[0])return prior.rows[0];}
  }
  const id=crypto.randomUUID();
  await c.query('INSERT INTO processing_jobs(id,upload_id,user_id,profile_id,kind,input_versions)VALUES($1,$2,$3,$4,$5,$6::jsonb)',[id,uploadId,userId,profileId,kind,JSON.stringify(versions)]);
  await c.query("UPDATE uploads SET analysis_status='processing',analysis_error=NULL,analysis_started_at=now() WHERE id=$1",[uploadId]);return{id};
 });
}
/** Persistent leases are reclaimed after worker crashes; every result is fenced by attempt. */
export async function runNextJob(only?:{uploadId:string;userId:string;profileId:string}) {
 const job=await transaction(async c=>{
  const {rows}=await c.query<{id:string;upload_id:string;user_id:string;profile_id:string;kind:string;attempt:number;input_versions:Record<string,number>}>(`SELECT j.* FROM processing_jobs j JOIN users u ON u.id=j.user_id WHERE u.status='active' AND u.deletion_started_at IS NULL AND (j.status='queued' OR j.status='running' AND j.lease_until<now()) ${only?'AND j.upload_id=$1 AND j.user_id=$2 AND j.profile_id=$3':''} ORDER BY j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1`,only?[only.uploadId,only.userId,only.profileId]:[]);
  if(!rows[0])return null;const r=rows[0];
  await c.query("UPDATE processing_jobs SET status='running',attempt=attempt+1,lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=$1",[r.id]);return{...r,attempt:r.attempt+1};
 });
 if(!job)return false;
 try {
  const {rows}=await query<{file_keys:string[];ocr_result:{pages:OcrPage[]}|null}>("SELECT file_keys,ocr_result FROM uploads WHERE id=$1 AND user_id=$2 AND profile_id=$3",[job.upload_id,job.user_id,job.profile_id]);
  if(!rows[0])throw new UploadError('作业已删除',404);
  if(job.kind==='recognize'){
   const pages=rows[0].ocr_result?.pages||[];
   for(let i=0;i<rows[0].file_keys.length;i++){
    if(pages.some(p=>p.pageNumber===i+1))continue;
    const key=rows[0].file_keys[i];if(!key.startsWith(`${job.user_id}/${job.upload_id}/`))throw new UploadError('图片索引不正确',422);
    const obj=await imageStorage.get(key);if(!obj)throw new UploadError(`第${i+1}页原图不存在`,422);
    const bytes=new Uint8Array(await obj.arrayBuffer());const recognized=await recognizePages([{bytes,mime:obj.httpMetadata?.contentType||'',base64:imageBase64(bytes)}]);
    const fenced=await query("SELECT id FROM processing_jobs WHERE id=$1 AND attempt=$2 AND status='running'",[job.id,job.attempt]);if(!fenced.rowCount)throw new UploadError('任务已更新',409);
    pages.push({...recognized[0],pageNumber:i+1});pages.sort((a,b)=>a.pageNumber-b.pageNumber);
    await query(`UPDATE uploads SET ocr_result=$4::jsonb WHERE id=$1 AND user_id=$2 AND profile_id=$3 AND EXISTS(SELECT 1 FROM processing_jobs WHERE id=$5 AND attempt=$6 AND status='running')`,[job.upload_id,job.user_id,job.profile_id,JSON.stringify({provider:'baidu-paper-cut-edu',pages}),job.id,job.attempt]);
    await seedQuestions(job.upload_id,job.user_id,job.profile_id,[{...recognized[0],pageNumber:i+1}]);
   }
  }else{
   const questions=(await listQuestions(job.upload_id,job.user_id,job.profile_id)).filter(q=>job.input_versions[q.id]!==undefined);
   if(questions.some(q=>q.version!==job.input_versions[q.id]||q.state!=='confirmed')||questions.length!==Object.keys(job.input_versions).length)throw new UploadError('题目版本已更改，请重新发起确认后分析',409);
   const answered=questions.filter(q=>q.studentAnswer.trim()&&q.question.trim());
   const result=answered.length?await analyzePages([],answered.map(q=>({id:q.id,pageNumber:q.pageNumber,question:q.question,answer:q.studentAnswer,reference:q.referenceAnswer,hasFigure:q.hasFigure,questionBounds:q.bounds}))):{subject:'其他',summary:'没有可判定的完整作答。空白题保持未作答，可人工收藏。',uncertainNote:'',gradingMode:'unmarked' as const,grading:[],mistakes:[]};
   await transaction(async c=>{
    const fenced=await c.query("SELECT id FROM processing_jobs WHERE id=$1 AND attempt=$2 AND status='running' FOR UPDATE",[job.id,job.attempt]);if(!fenced.rowCount)throw new UploadError('任务已更新',409);
    for(const q of questions){
     const g=result.grading.find(g=>g.questionLabel===q.id);const m=result.mistakes.find(m=>m.sourceQuestionId===q.id);
     const report=g?{...g,correctAnswer:m?.correctAnswer||'',reasoning:m?.reasoning||'',knowledgePoint:m?.knowledgePoint||''}:{verdict:q.studentAnswer.trim()?'uncertain':'unanswered',comment:q.studentAnswer.trim()?'题干不完整，请人工核对':'未作答，不默认判错'};
     await c.query('INSERT INTO question_reports(id,question_id,input_version,report)VALUES($1,$2,$3,$4::jsonb)',[crypto.randomUUID(),q.id,job.input_versions[q.id],JSON.stringify(report)]);
    }
    const {mistakes: _recommendations,...report}=result;void _recommendations;
    const current=await c.query<{id:string;version:number;state:string}>('SELECT id,version,state FROM upload_questions WHERE upload_id=$1 FOR SHARE',[job.upload_id]);
    const unchanged=questions.every(q=>current.rows.some(now=>now.id===q.id&&now.version===job.input_versions[q.id]&&now.state==='confirmed'));
    // A result for an old input remains in question_reports; it cannot replace today's summary.
    if(unchanged)await c.query(`UPDATE uploads SET analysis_result=$4::jsonb,original_subject=COALESCE(original_subject,subject),subject=CASE WHEN subject IN ('待识别','其他') THEN $5 ELSE subject END WHERE id=$1 AND user_id=$2 AND profile_id=$3`,[job.upload_id,job.user_id,job.profile_id,JSON.stringify(report),normalizeSubject(result.subject)]);
   });
  }
  await transaction(async c=>{
   const done=await c.query("UPDATE processing_jobs SET status='completed',error=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND attempt=$2 AND status='running' RETURNING id",[job.id,job.attempt]);
   if(done.rowCount)await c.query("UPDATE uploads SET analysis_status='completed',analysis_error=NULL WHERE id=$1 AND user_id=$2 AND profile_id=$3",[job.upload_id,job.user_id,job.profile_id]);
  });return true;
 }catch(e){
  const message=e instanceof Error?e.message:'处理失败，已保存内容可恢复';
  await transaction(async c=>{const failed=await c.query("UPDATE processing_jobs SET status='failed',error=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND attempt=$2 AND status='running' RETURNING id",[job.id,job.attempt,message]);if(failed.rowCount)await c.query("UPDATE uploads SET analysis_status='failed',analysis_error=$4 WHERE id=$1 AND user_id=$2 AND profile_id=$3",[job.upload_id,job.user_id,job.profile_id,message]);});
  return true;
 }
}
