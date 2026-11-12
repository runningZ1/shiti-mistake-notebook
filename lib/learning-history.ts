import { query, transaction } from '@/db/client';
import { requireProfile } from '@/lib/profiles';
import type { PracticeGrade } from '@/lib/practice-types';

export class LearningError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function scope(userId: string) { return { userId, profileId: (await requireProfile(userId)).id }; }
export type Scope = Awaited<ReturnType<typeof scope>>;
const args = (s: Scope) => [s.userId, s.profileId];
export async function ownedPaper(s: Scope, id: string) {
 const {rows} = await query('SELECT * FROM practice_papers WHERE id=$1 AND user_id=$2 AND profile_id=$3', [id,...args(s)]);
 if (!rows[0]) throw new LearningError('练习不存在或不属于当前档案',404);
 return rows[0];
}
export async function practiceHistory(s: Scope, paperId: string) {
 await ownedPaper(s,paperId);
 const {rows} = await query('SELECT * FROM learning_attempts WHERE user_id=$1 AND profile_id=$2 AND paper_id=$3 ORDER BY started_at DESC', [...args(s),paperId]);
 return rows;
}
export async function beginAttempt(s: Scope, id: string, paperId: string, answers: string[]) {
 await ownedPaper(s,paperId);
 return transaction(async c => {
  await c.query("INSERT INTO learning_attempts(id,user_id,profile_id,paper_id,answers) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO NOTHING",[id,...args(s),paperId,JSON.stringify(answers)]);
  const {rows} = await c.query('SELECT * FROM learning_attempts WHERE id=$1 AND user_id=$2 AND profile_id=$3 AND paper_id=$4 FOR UPDATE',[id,...args(s),paperId]);
  const row=rows[0]; if(!row) throw new LearningError('轮次标识冲突',409);
  if(JSON.stringify(row.answers)!==JSON.stringify(answers)) throw new LearningError('该轮次已有不同答案，请开始新轮次',409);
  if(row.status==='completed') return {cached:row, token:null};
  if(row.status==='grading' && Date.now()-new Date(row.started_at).getTime()<180000) throw new LearningError('本轮正在批改，请稍后重试',409);
  const source=await c.query('SELECT source,source_id FROM learning_paper_sources WHERE paper_id=$1 AND user_id=$2 AND profile_id=$3',[paperId,...args(s)]);
  if(source.rows[0]) await c.query('UPDATE learning_attempts SET source=$1,source_id=$2 WHERE id=$3',[source.rows[0].source,source.rows[0].source_id,id]);
  const token=crypto.randomUUID();
  // A fencing token prevents a timed-out worker from overwriting a later retry.
  await c.query("UPDATE learning_attempts SET status='grading', error=$1, started_at=now() WHERE id=$2",[token,id]);
  return {cached:null,token};
 });
}
export async function finishAttempt(s: Scope,id:string,token:string,grading:PracticeGrade[],gradingSource = 'ai') {
 return transaction(async c=>{
  const {rows}=await c.query("UPDATE learning_attempts SET grading=$1::jsonb,status='completed',grading_source=$6,error=NULL,completed_at=now() WHERE id=$2 AND user_id=$3 AND profile_id=$4 AND status='grading' AND error=$5 RETURNING *",[JSON.stringify(grading),id,...args(s),token,gradingSource]);
  if(!rows[0]) throw new LearningError('批改轮次已变更，请重新加载',409);
  // Keep legacy latest-grading readers working, without discarding any history.
  await c.query('UPDATE practice_papers SET answers=$1::jsonb,grading=$2::jsonb,graded_at=$3 WHERE id=$4 AND user_id=$5 AND profile_id=$6',[JSON.stringify(rows[0].answers),JSON.stringify(grading),rows[0].completed_at,rows[0].paper_id,...args(s)]);
  return rows[0];
 });
}
export async function failAttempt(s:Scope,id:string,token:string,error:string) {
 await query("UPDATE learning_attempts SET status='failed',error=$1 WHERE id=$2 AND user_id=$3 AND profile_id=$4 AND error=$5 AND status='grading'",[error.slice(0,1000),id,...args(s),token]);
}
export async function getDraft(s:Scope,kind:string,sourceId:string) {
 const {rows}=await query('SELECT * FROM learning_drafts WHERE user_id=$1 AND profile_id=$2 AND kind=$3 AND source_id=$4',[...args(s),kind,sourceId]); return rows[0]??null;
}
export async function saveDraft(s:Scope,kind:string,sourceId:string,payload:unknown,revision:number) {
 if(kind==='practice') {const paper=await ownedPaper(s,sourceId);if((payload as {answers:string[]}).answers.length!==paper.questions.length)throw new LearningError('草稿答案数量不匹配');}
 const {rows}=await query(`INSERT INTO learning_drafts(id,user_id,profile_id,kind,source_id,payload) SELECT $1,$2,$3,$4,$5,$6::jsonb WHERE $7=0
 ON CONFLICT(user_id,profile_id,kind,source_id) DO UPDATE SET payload=EXCLUDED.payload,revision=learning_drafts.revision+1,updated_at=now() WHERE learning_drafts.revision=$7 RETURNING *`,[crypto.randomUUID(),...args(s),kind,sourceId,JSON.stringify(payload),revision]);
 // UPDATE is separate because INSERT SELECT with revision>0 deliberately produces no rows.
 if(rows[0]) return rows[0];
 if(revision>0) { const r=await query('UPDATE learning_drafts SET payload=$1::jsonb,revision=revision+1,updated_at=now() WHERE user_id=$2 AND profile_id=$3 AND kind=$4 AND source_id=$5 AND revision=$6 RETURNING *',[JSON.stringify(payload),...args(s),kind,sourceId,revision]); if(r.rows[0])return r.rows[0]; }
 throw new LearningError('草稿已在其他页面更新，请重新打开后保存（当前输入仍保留）',409);
}
export async function saveVersion(s:Scope,input:{id:string;parentId?:string;promptText:string;originalText:string;gradeLevel:string}) {
 return transaction(async c=>{
 if(input.parentId) {const r=await c.query('SELECT id FROM learning_essay_versions WHERE id=$1 AND user_id=$2 AND profile_id=$3',[input.parentId,...args(s)]);if(!r.rows[0])throw new LearningError('原稿版本不存在',404);}
 await c.query('INSERT INTO learning_essay_versions(id,user_id,profile_id,parent_id,kind,prompt_text,original_text,grade_level) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',[input.id,...args(s),input.parentId||null,input.parentId?'revision':'original',input.promptText,input.originalText,input.gradeLevel]);
 const {rows}=await c.query('SELECT * FROM learning_essay_versions WHERE id=$1 AND user_id=$2 AND profile_id=$3',[input.id,...args(s)]);
 const v=rows[0];if(!v||v.original_text!==input.originalText||v.prompt_text!==input.promptText||v.grade_level!==input.gradeLevel||v.parent_id!==(input.parentId||null))throw new LearningError('版本已保存，请创建新版本',409);return v;
 });
}
export async function listVersions(s:Scope) {
 return (await query('SELECT v.*,r.report_id FROM learning_essay_versions v LEFT JOIN learning_essay_reports r ON r.version_id=v.id WHERE v.user_id=$1 AND v.profile_id=$2 ORDER BY v.created_at DESC LIMIT 100',args(s))).rows;
}
export async function saveVersionReport(s:Scope,versionId:string,report:unknown) {
 return transaction(async c=>{
 const {rows}=await c.query('SELECT * FROM learning_essay_versions WHERE id=$1 AND user_id=$2 AND profile_id=$3 FOR UPDATE',[versionId,...args(s)]);const v=rows[0];if(!v)throw new LearningError('作文版本不存在',404);
 const prior=await c.query('SELECT report_id FROM learning_essay_reports WHERE version_id=$1',[versionId]);if(prior.rows[0])return prior.rows[0].report_id as string;
 const id=crypto.randomUUID();
 await c.query('INSERT INTO essay_reports(id,user_id,profile_id,prompt_text,original_text,grade_level,report_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[id,...args(s),v.prompt_text,v.original_text,v.grade_level,JSON.stringify(report)]);
 await c.query('INSERT INTO learning_essay_reports(report_id,version_id,user_id,profile_id) VALUES($1,$2,$3,$4)',[id,versionId,...args(s)]);return id;
 });
}
export async function reviews(s:Scope) {return (await query('SELECT r.*,a.paper_id,a.answers,a.grading,a.grading_source,a.source,a.source_id,a.completed_at FROM learning_reviews r JOIN learning_attempts a ON a.id=r.attempt_id WHERE r.user_id=$1 AND r.profile_id=$2 ORDER BY r.created_at DESC LIMIT 100',args(s))).rows;}
export async function addReview(s:Scope,attemptId:string,evidence:string,state:string,reviewOn:string|null) {
 return transaction(async c=>{
 const attempt=await c.query("SELECT id FROM learning_attempts WHERE id=$1 AND user_id=$2 AND profile_id=$3 AND status='completed' FOR UPDATE",[attemptId,...args(s)]);
 if(!attempt.rows[0])throw new LearningError('请先完成一轮作答，再保存复习证据');
 const {rows}=await c.query(`INSERT INTO learning_reviews(id,user_id,profile_id,attempt_id,evidence,state,review_on) VALUES($1,$2,$3,$4,$5,$6,$7::date)
 ON CONFLICT(attempt_id) DO UPDATE SET evidence=EXCLUDED.evidence,state=EXCLUDED.state,review_on=EXCLUDED.review_on RETURNING *`,[crypto.randomUUID(),...args(s),attemptId,evidence,state,reviewOn]);
 const review=rows[0];
 await c.query('INSERT INTO learning_review_events(id,review_id,user_id,profile_id,evidence,state,review_on) VALUES($1,$2,$3,$4,$5,$6,$7::date)',[crypto.randomUUID(),review.id,...args(s),evidence,state,reviewOn]);
 return review;
 });
}
export async function reviewEvents(s:Scope) {
 return (await query('SELECT e.*,r.attempt_id FROM learning_review_events e JOIN learning_reviews r ON r.id=e.review_id WHERE e.user_id=$1 AND e.profile_id=$2 ORDER BY e.created_at DESC LIMIT 200',args(s))).rows;
}
export async function retryMistake(s:Scope,mistakeId:string,similar:boolean) {
 return transaction(async c=>{
 const {rows}=await c.query('SELECT * FROM mistakes WHERE id=$1 AND user_id=$2 AND profile_id=$3 AND removed_at IS NULL',[mistakeId,...args(s)]);const m=rows[0];if(!m)throw new LearningError('错题不存在',404);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,10))',[s.userId+':'+s.profileId+':'+mistakeId+':'+similar]);
 const pending=await c.query('SELECT p.id FROM practice_papers p JOIN learning_paper_sources x ON x.paper_id=p.id WHERE p.user_id=$1 AND p.profile_id=$2 AND x.source_id=$3 AND x.source=$4 AND p.graded_at IS NULL ORDER BY p.created_at LIMIT 1',[...args(s),mistakeId,similar?'similar':'original']);
 if(pending.rows[0])return pending.rows[0].id as string;
 const questions=similar ? m.similar_questions?.map((q:{question:string;answer:string;explanation:string})=>({...q,knowledgePoint:m.knowledge_point,format:'short'})) : [{question:m.question,answer:m.correct_answer,explanation:m.reasoning,knowledgePoint:m.knowledge_point,format:'short'}];
 if(!Array.isArray(questions)||!questions.length)throw new LearningError('请先在错题本生成针对练习');
 const id=crypto.randomUUID();
 await c.query("INSERT INTO practice_papers(id,user_id,profile_id,subject,unit_name,questions) VALUES($1,$2,$3,$4,$5,$6::jsonb)",[id,...args(s),m.subject,similar?'错题针对练习':'原题重做',JSON.stringify(questions)]);
 await c.query('INSERT INTO learning_paper_sources(paper_id,user_id,profile_id,source,source_id) VALUES($1,$2,$3,$4,$5)',[id,...args(s),similar?'similar':'original',mistakeId]);
 // Source belongs to this paper and will be copied into every attempt.
 await c.query("INSERT INTO learning_drafts(id,user_id,profile_id,kind,source_id,payload) VALUES($1,$2,$3,'practice',$4,$5::jsonb)",[crypto.randomUUID(),...args(s),id,JSON.stringify({answers:questions.map(()=>''),attemptId:crypto.randomUUID(),source:similar?'similar':'original',sourceId:mistakeId})]);
 return id;
 });
}

export async function paperSource(s:Scope,paperId:string) {
 const {rows}=await query(`SELECT p.source,p.source_id,m.upload_id,m.page_number,m.question_bounds FROM learning_paper_sources p LEFT JOIN mistakes m ON m.id=p.source_id AND m.user_id=p.user_id AND m.profile_id=p.profile_id WHERE p.paper_id=$1 AND p.user_id=$2 AND p.profile_id=$3`,[paperId,...args(s)]);
 return rows[0]??null;
}
export async function essayAnalysisError(s:Scope,versionId:string,error:string|null) {
 await query('UPDATE learning_essay_versions SET analysis_error=$1 WHERE id=$2 AND user_id=$3 AND profile_id=$4',[error?.slice(0,1000)||null,versionId,...args(s)]);
}

export async function storedVersionReport(s:Scope,versionId:string) {
 return (await query('SELECT e.* FROM essay_reports e JOIN learning_essay_reports r ON r.report_id=e.id WHERE r.version_id=$1 AND r.user_id=$2 AND r.profile_id=$3',[versionId,...args(s)])).rows[0]??null;
}

/** The legacy fallback is decided against ALL attempts, not just the bounded result window. */
export async function learningEvidence(s:Scope) {
 const limit=500;
 const roundColumns=`a.id,a.paper_id AS "paperId",p.subject,p.unit_name AS "unitName",a.answers,a.grading,
 p.questions,a.source,a.source_id AS "sourceId",a.status,a.grading_source AS "gradingSource",
 a.started_at AS "startedAt",a.completed_at AS "completedAt",CASE WHEN a.status='failed' THEN a.error ELSE NULL END AS error,false AS legacy`;
 return transaction(async c=>{
  await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const attempts=await c.query<import('./learning-evidence').LearningEvidenceRound>(`SELECT ${roundColumns} FROM learning_attempts a JOIN practice_papers p ON p.id=a.paper_id AND p.user_id=a.user_id AND p.profile_id=a.profile_id WHERE a.user_id=$1 AND a.profile_id=$2 ORDER BY a.started_at DESC,a.id DESC LIMIT $3`,[...args(s),limit+1]);
  const legacy=await c.query<import('./learning-evidence').LearningEvidenceRound>(`SELECT 'legacy:'||p.id AS id,p.id AS "paperId",p.subject,p.unit_name AS "unitName",p.answers,p.grading,p.questions,'legacy' AS source,NULL::text AS "sourceId",'completed' AS status,'legacy' AS "gradingSource",p.created_at AS "startedAt",p.graded_at AS "completedAt",NULL::text AS error,true AS legacy FROM practice_papers p WHERE p.user_id=$1 AND p.profile_id=$2 AND p.graded_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM learning_attempts a WHERE a.paper_id=p.id AND a.user_id=p.user_id AND a.profile_id=p.profile_id) ORDER BY p.graded_at DESC,p.id DESC LIMIT $3`,[...args(s),limit+1]);
  // Only public question text and point metadata are needed for source inspection.
  const publicRound=(r:import('./learning-evidence').LearningEvidenceRound)=>({...r,questions:r.questions.map(q=>({question:q.question,knowledgePoint:q.knowledgePoint}))});
  return {profileId:s.profileId,attempts:attempts.rows.slice(0,limit).map(publicRound),legacyPapers:legacy.rows.slice(0,limit).map(publicRound),limit,truncated:attempts.rows.length>limit||legacy.rows.length>limit};
 });
}
