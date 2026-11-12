import {query} from '@/db/client';
import type {Analysis} from '@/lib/ai';
import type {OcrPage} from '@/lib/baidu-ocr';
import {requireProfile} from '@/lib/profiles';
import {listQuestions,seedQuestions} from '@/lib/questions';
import type {UploadDetail,UploadSummary,SavedMistake} from '@/lib/upload-types';

type UploadRow={id:string;profile_id:string;subject:string;title:string;homework_date:string|null;grade_level:string;intent:UploadSummary['intent'];file_names:string[];created_at:string;analysis_result:Omit<Analysis,'mistakes'>|null;analysis_status:UploadSummary['status'];analysis_error:string|null;analysis_started_at:string|null;ocr_result:{pages:OcrPage[]}|null;mistake_count:number;pending_count:number;question_count:number};
export class UploadError extends Error {constructor(message:string,public status:number){super(message);}}
function summary(r:UploadRow):UploadSummary {
 const grading=r.analysis_result?.grading;
 const expired=!r.analysis_started_at||Date.now()-new Date(r.analysis_started_at).getTime()>15*60_000;
 return {id:r.id,profileId:r.profile_id,subject:r.subject,title:r.title||r.file_names.join('、'),homeworkDate:r.homework_date?.slice(0,10)||null,gradeLevel:r.grade_level,intent:r.intent,fileNames:r.file_names,createdAt:r.created_at,status:r.analysis_status,error:r.analysis_error,hasAnalysis:Boolean(r.analysis_result),questionCount:Number(r.question_count)||grading?.length||r.ocr_result?.pages?.reduce((s,p)=>s+p.result.qus_result_num,0)||null,uncertainCount:grading?.filter(g=>g.verdict==='uncertain').length??null,pendingCount:Number(r.pending_count),mistakeCount:Number(r.mistake_count),canRetry:r.analysis_status==='failed'||r.analysis_status==='processing'&&expired};
}
const columns=`up.*,CASE WHEN EXISTS(SELECT 1 FROM processing_jobs j WHERE j.upload_id=up.id AND j.status IN ('queued','running')) THEN 'processing' ELSE up.analysis_status END AS analysis_status,to_char(up.homework_date,'YYYY-MM-DD') AS homework_date,
 (SELECT count(*)::int FROM mistakes m WHERE m.upload_id=up.id AND m.user_id=up.user_id AND m.removed_at IS NULL) AS mistake_count,
 (SELECT count(*)::int FROM upload_questions q WHERE q.upload_id=up.id AND q.state='pending') AS pending_count,
 (SELECT count(*)::int FROM upload_questions q WHERE q.upload_id=up.id) AS question_count`;
export async function listUploads(userId:string,page:number,limit:number,filters?:{date?:string;subject?:string;homeworkDate?:string}) {
 const profile=await requireProfile(userId);
 const vals:unknown[]=[userId,profile.id];const cond=['up.user_id=$1','up.profile_id=$2'];
 if(filters?.date){vals.push(filters.date);cond.push(`(up.created_at AT TIME ZONE 'Asia/Shanghai')::date=$${vals.length}::date`);}
 if(filters?.homeworkDate){vals.push(filters.homeworkDate);cond.push(`up.homework_date=$${vals.length}::date`);}
 if(filters?.subject){vals.push(filters.subject);cond.push(`up.subject=$${vals.length}`);}
 const where=cond.join(' AND ');vals.push(limit,(page-1)*limit);
 const {rows}=await query<{total:number;items:UploadRow[]}>(`SELECT(SELECT count(*)::int FROM uploads up WHERE ${where}) AS total,COALESCE((SELECT jsonb_agg(item ORDER BY item.created_at DESC,item.id DESC) FROM(SELECT ${columns} FROM uploads up WHERE ${where} ORDER BY up.created_at DESC,up.id DESC LIMIT $${vals.length-1} OFFSET $${vals.length})item),'[]'::jsonb)AS items`,vals);
 const r=rows[0];return {uploads:r.items.map(summary),total:r.total,page,pageSize:limit,totalPages:Math.max(1,Math.ceil(r.total/limit))};
}
export async function getUpload(id:string,userId:string,fixedProfileId?:string):Promise<UploadDetail|null> {
 const profileId=fixedProfileId||(await requireProfile(userId)).id;
 const {rows}=await query<UploadRow>(`SELECT ${columns} FROM uploads up WHERE up.id=$1 AND up.user_id=$2 AND up.profile_id=$3`,[id,userId,profileId]);const r=rows[0];if(!r)return null;
 if(r.ocr_result?.pages?.length)await seedQuestions(id,userId,profileId,r.ocr_result.pages);
 const mistakes=await query<SavedMistake>(`SELECT id,upload_id AS "uploadId",subject,question,question_bounds AS "questionBounds",incorrect_answer AS "incorrectAnswer",correct_answer AS "correctAnswer",reasoning,knowledge_point AS "knowledgePoint",page_number AS "pageNumber",source_name AS "sourceName",similar_questions AS "similarQuestions",reflection,archive_kind AS "archiveKind",judgement_source AS "judgementSource",created_at AS "createdAt" FROM mistakes WHERE upload_id=$1 AND user_id=$2 AND profile_id=$3 AND removed_at IS NULL ORDER BY page_number,id`,[id,userId,profileId]);
 const jobs=await query<UploadDetail['jobs'][number]>('SELECT id,kind,status,error FROM processing_jobs WHERE upload_id=$1 AND user_id=$2 AND profile_id=$3 ORDER BY created_at DESC',[id,userId,profileId]);
 const questions=await listQuestions(id,userId,profileId);
 return {...summary(r),questionCount:questions.length||summary(r).questionCount,pendingCount:questions.filter(q=>q.state==='pending').length,analysis:r.analysis_result,ocrPages:r.ocr_result?.pages||[],mistakes:mistakes.rows,questions,jobs:jobs.rows};
}
export function imageBase64(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
