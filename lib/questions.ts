import {query, transaction} from '@/db/client';
import {questionText, questionBounds, type OcrPage} from '@/lib/baidu-ocr';
import {UploadError} from '@/lib/uploads';
import {requireProfile} from '@/lib/profiles';
import type {ConfirmedQuestion} from './question-types';

export async function seedQuestions(uploadId:string,userId:string,profileId:string,pages:OcrPage[]) {
  await transaction(async c=>{
    const owner=await c.query('SELECT id FROM uploads WHERE id=$1 AND user_id=$2 AND profile_id=$3 FOR UPDATE',[uploadId,userId,profileId]);
    if(!owner.rowCount)throw new UploadError('作业不属于当前档案',404);
    for(const page of pages)for(const [i,q] of page.result.qus_result.entries()) {
      const id=crypto.randomUUID();
      const content={pageNumber:page.pageNumber,question:questionText(q),studentAnswer:questionText(q,[2]),referenceAnswer:questionText(q,[5]),referenceSource:'照片识别',bounds:questionBounds(page,q),state:'pending',hasFigure:q.qus_element.some(e=>Number(e.elem_type)===4)};
      const inserted=await c.query(`INSERT INTO upload_questions(id,upload_id,user_id,profile_id,page_number,source_index,original_ocr,question,student_answer,reference_answer,bounds,has_figure)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12) ON CONFLICT(upload_id,page_number,source_index) DO NOTHING RETURNING id`,[id,uploadId,userId,profileId,page.pageNumber,i,JSON.stringify(q),content.question,content.studentAnswer,content.referenceAnswer,JSON.stringify(content.bounds),content.hasFigure]);
      if(inserted.rowCount)await c.query('INSERT INTO question_versions(question_id,version,content) VALUES($1,1,$2::jsonb)',[id,JSON.stringify(content)]);
      if(inserted.rowCount)await c.query(`UPDATE mistakes SET source_question_id=$1,question_version=1 WHERE id=(SELECT id FROM mistakes WHERE upload_id=$2 AND user_id=$3 AND profile_id=$4 AND page_number=$5 AND question=$6 AND source_question_id IS NULL ORDER BY created_at,id LIMIT 1)`,[id,uploadId,userId,profileId,page.pageNumber,content.question]);
    }
  });
}
export async function listQuestions(uploadId:string,userId:string,profileId:string):Promise<ConfirmedQuestion[]> {
  const {rows}=await query<ConfirmedQuestion>(`SELECT q.id,q.upload_id AS "uploadId",q.page_number AS "pageNumber",q.source_index AS "sourceIndex",q.original_ocr AS "originalOcr",q.version,q.question,q.student_answer AS "studentAnswer",q.reference_answer AS "referenceAnswer",q.reference_source AS "referenceSource",q.bounds,q.state,q.has_figure AS "hasFigure",m.id AS "archiveId",m.archive_kind AS "archiveKind",r.report,r.input_version AS "reportVersion",COALESCE(r.input_version<>q.version,false) AS "reportStale"
   FROM upload_questions q LEFT JOIN mistakes m ON m.source_question_id=q.id AND m.removed_at IS NULL
   LEFT JOIN LATERAL(SELECT report,input_version FROM question_reports WHERE question_id=q.id ORDER BY created_at DESC,id DESC LIMIT 1)r ON true
   WHERE q.upload_id=$1 AND q.user_id=$2 AND q.profile_id=$3 ORDER BY q.page_number,q.source_index NULLS LAST,q.created_at,q.id`,[uploadId,userId,profileId]);
  return rows;
}
export function validateQuestion(body:Record<string,unknown>,pageCount:number) {
  if(body.id!==undefined&&(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id)))throw new UploadError('题目标识无效',400);
  if(!Number.isSafeInteger(body.version)||Number(body.version)<0||Number(body.version)>2147483646)throw new UploadError('题目版本无效',400);
  for(const key of ['question','studentAnswer','referenceAnswer','referenceSource'])if(typeof body[key]!=='string'||(body[key] as string).length>20000)throw new UploadError('题目字段必须为文本，最多20000字符',400);
  if(!['pending','confirmed','ignored'].includes(String(body.state))||typeof body.hasFigure!=='boolean')throw new UploadError('题目状态不正确',400);
  if(!Number.isInteger(body.pageNumber)||Number(body.pageNumber)<1||Number(body.pageNumber)>pageCount)throw new UploadError('页码无效',400);
  const b=body.bounds;
  if(!Array.isArray(b)|| !(b.length===0 || b.length===4&&b.every(v=>Number.isInteger(v)&&v>=0&&v<=1000)&&b[0]<b[2]&&b[1]<b[3]))throw new UploadError('题框坐标无效',400);
  if(body.state==='confirmed'&&!(body.question as string).trim()&&b.length!==4)throw new UploadError('请填写题干或框选完整原题',400);
}
export async function saveQuestion(uploadId:string,userId:string,body:Record<string,unknown>) {
  const profile=await requireProfile(userId);
  return transaction(async c=>{
    const up=await c.query<{file_names:string[]}>('SELECT file_names FROM uploads WHERE id=$1 AND user_id=$2 AND profile_id=$3 FOR UPDATE',[uploadId,userId,profile.id]);
    if(!up.rows[0])throw new UploadError('作业不存在',404);
    validateQuestion(body,up.rows[0].file_names.length);
    const id=typeof body.id==='string'?body.id:crypto.randomUUID();
    const previous=await c.query<{version:number}>('SELECT version FROM upload_questions WHERE id=$1 AND upload_id=$2 AND user_id=$3 AND profile_id=$4 FOR UPDATE',[id,uploadId,userId,profile.id]);
    if(body.id&&!previous.rowCount&&body.version!==0)throw new UploadError('题目不存在',404);
    const version=previous.rows[0]?.version || 0;
    if(version&&body.version===0){if(version>1)throw new UploadError('此题已被继续编辑，请重新加载后合并；当前输入保留',409);const first=await c.query<{content:Record<string,unknown>}>('SELECT content FROM question_versions WHERE question_id=$1 AND version=1',[id]);const content=first.rows[0]?.content;const keys=['pageNumber','question','studentAnswer','referenceAnswer','referenceSource','bounds','state','hasFigure'];if(content&&keys.every(k=>JSON.stringify(content[k])===JSON.stringify(body[k])))return{id,version};throw new UploadError('新增题目标识已使用，请重新加载后合并输入',409);}
    if(version && body.version!==version)throw new UploadError('其他页面已修改此题，请重新加载后合并；当前输入仍保留',409);
    const v=version+1;
    const vals=[id,uploadId,userId,profile.id,body.pageNumber,body.question,body.studentAnswer,body.referenceAnswer,body.referenceSource,JSON.stringify(body.bounds),body.state,body.hasFigure,v];
    const written=await c.query(`INSERT INTO upload_questions(id,upload_id,user_id,profile_id,page_number,question,student_answer,reference_answer,reference_source,bounds,state,has_figure,version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13)
     ON CONFLICT(id) DO UPDATE SET page_number=$5,question=$6,student_answer=$7,reference_answer=$8,reference_source=$9,bounds=$10::jsonb,state=$11,has_figure=$12,version=$13,updated_at=now() WHERE upload_questions.upload_id=$2 AND upload_questions.user_id=$3 AND upload_questions.profile_id=$4 RETURNING id`,vals);
    if(!written.rowCount)throw new UploadError('题目标识已使用，请重新加载后重试',409);
    await c.query('INSERT INTO question_versions(question_id,version,content) VALUES($1,$2,$3::jsonb)',[id,v,JSON.stringify(body)]);
    // Unconfirmed edits never change the printable confirmed original.
    if(body.state==='confirmed'){
      const archived=await c.query<{content:Record<string,unknown>}>('SELECT v.content FROM mistakes m LEFT JOIN question_versions v ON v.question_id=m.source_question_id AND v.version=m.question_version WHERE m.source_question_id=$1',[id]);
      const content=archived.rows[0]?.content;
      const materialChange=!content||['question','studentAnswer','referenceAnswer','bounds','pageNumber','hasFigure'].some(k=>JSON.stringify(content[k])!==JSON.stringify(body[k]));
      if(materialChange)await c.query(`UPDATE mistakes SET question=$2,incorrect_answer=$3,question_bounds=$4::jsonb,page_number=$5,question_version=$6,correct_answer=$7,reasoning='',source_name=$8 WHERE source_question_id=$1`,[id,body.question || '原图题目（见题图）',body.studentAnswer,JSON.stringify(body.bounds),body.pageNumber,v,body.referenceAnswer,up.rows[0].file_names[Number(body.pageNumber)-1]]);
      else await c.query('UPDATE mistakes SET question_version=$2 WHERE source_question_id=$1',[id,v]);
    }
    return {id,version:v};
  });
}
export async function archiveQuestion(uploadId:string,userId:string,id:string,version:number,kind:string) {
  if(!['mistake','collection'].includes(kind))throw new UploadError('请选择错题或复习收藏',400);
  const p=await requireProfile(userId);
  return transaction(async c=>{
    const {rows}=await c.query(`SELECT q.*,up.subject,up.file_names FROM upload_questions q JOIN uploads up ON up.id=q.upload_id WHERE q.id=$1 AND q.upload_id=$2 AND q.user_id=$3 AND q.profile_id=$4 FOR UPDATE OF q`,[id,uploadId,userId,p.id]);
    const q=rows[0];if(!q)throw new UploadError('题目不存在',404);
    if(q.version!==version)throw new UploadError('题目已更新，请重新核对后归档',409);
    if(q.state!=='confirmed')throw new UploadError('请先保存并确认题目',409);
    const reports=await c.query<{report:{correctAnswer?:string;reasoning?:string;knowledgePoint?:string}}>('SELECT report FROM question_reports WHERE question_id=$1 AND input_version=$2 ORDER BY created_at DESC LIMIT 1',[id,version]);const report=reports.rows[0]?.report;
    const result=await c.query(`INSERT INTO mistakes(id,upload_id,user_id,profile_id,subject,question,question_bounds,incorrect_answer,correct_answer,reasoning,knowledge_point,page_number,source_name,source_question_id,question_version,archive_kind,judgement_source)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$15,$16,$10,$11,$12,$13,$14,'manual')
     ON CONFLICT(source_question_id) WHERE source_question_id IS NOT NULL DO UPDATE SET removed_at=NULL,archive_kind=$14,judgement_source='manual',correct_answer=$9,reasoning=$15,knowledge_point=$16 RETURNING id`,[crypto.randomUUID(),uploadId,userId,p.id,q.subject,q.question||'原图题目（见题图）',JSON.stringify(q.bounds),q.student_answer,q.reference_answer||report?.correctAnswer||'',q.page_number,q.file_names[q.page_number-1],id,version,kind,report?.reasoning||'',report?.knowledgePoint||'']);
    return result.rows[0];
  });
}
