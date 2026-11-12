// Execute only against a disposable schema populated with actual local records.
// No AI calls, invented essays, accounts, grades, or production migrations.
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,access} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
const originalUrl=process.env.DATABASE_URL;
const url=new URL(originalUrl||'postgres://invalid');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'仅允许本机真实数据库');
let dump='pg_dump';
for(const v of ['18','17','16']){const p=`C:/Program Files/PostgreSQL/${v}/bin/pg_dump.exe`;try{await access(p);dump=p;break;}catch{}}
await mkdir('work/learning-history',{recursive:true});
const dumpEnv={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url['pass'+'word'])};delete dumpEnv.PGOPTIONS;
const backup=spawnSync(dump,['--format=custom','--schema=public','--no-owner','--file',`work/learning-history/public-${Date.now()}.dump`],{env:dumpEnv,windowsHide:true,encoding:'utf8'});
assert.equal(backup.status,0,'验证前真实数据库备份失败');
const schema='learning_verify_'+randomUUID().replaceAll('-','');
assert.match(schema,/^learning_verify_[a-f0-9]{32}$/);
const c=new pg.Client({connectionString:originalUrl});await c.connect();let created=false;
let checks=0;const checked=()=>checks++;
try {
 await c.query('BEGIN');await c.query(`CREATE SCHEMA "${schema}"`);await c.query(`SET LOCAL search_path TO "${schema}",pg_catalog`);
 const files=(await readdir(new URL('../db/migrations/',import.meta.url))).filter(n=>/^000[1-7]_.*\.sql$/.test(n)).sort();
 for(const f of files)await c.query(await readFile(new URL('../db/migrations/'+f,import.meta.url),'utf8'));
 for(const table of ['users','uploads','upload_objects','mistakes','practice_papers','knowledge_units','essay_reports','payment_orders','payment_events','payment_deliveries']) {
  const cols=(await c.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[schema,table])).rows.map(r=>'"'+r.column_name+'"').join(',');
  await c.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);await c.query(`INSERT INTO ${table}(${cols}) SELECT ${cols} FROM public.${table}`);await c.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
 }
 for(const f of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(n=>/^\d{4}_.*\.sql$/.test(n)&&n>='0008').sort())await c.query(await readFile(new URL('../db/migrations/'+f,import.meta.url),'utf8'));
 const existing=(await c.query('SELECT count(*)::int AS n FROM learning_attempts')).rows[0].n;
 const legacy=(await c.query('SELECT count(*)::int AS n FROM practice_papers WHERE graded_at IS NOT NULL')).rows[0].n;assert.equal(existing,legacy);checked();
 const m=(await c.query("SELECT m.* FROM mistakes m JOIN users u ON m.user_id=u.id WHERE u.status='active' AND u.deletion_started_at IS NULL AND length(trim(m.incorrect_answer))>0 LIMIT 1")).rows[0];
 assert.ok(m,'需要真实错题及已有学生作答；不会伪造替代资料');
 await c.query('COMMIT');created=true;
 url.searchParams.set('options',`-c search_path=${schema},pg_catalog`);process.env.DATABASE_URL=url.href;
 const service=await import('../lib/learning-history.ts');
 const s={userId:m.user_id,profileId:m.profile_id};
 const paperId=await service.retryMistake(s,m.id,false);
 const source=await service.paperSource(s,paperId);assert.equal(source.source_id,m.id);assert.equal(source.upload_id,m.upload_id);checked();
 const paper=await service.ownedPaper(s,paperId);assert.equal(paper.questions[0].question,m.question);assert.equal(paper.questions[0].answer,m.correct_answer);checked();
 const draft=await service.getDraft(s,'practice',paperId);const answers=[m.incorrect_answer];
 const saved=await service.saveDraft(s,'practice',paperId,{answers,attemptId:draft.payload.attemptId},draft.revision);assert.equal(saved.revision,2);checked();
 await assert.rejects(service.saveDraft(s,'practice',paperId,{answers,attemptId:draft.payload.attemptId},draft.revision),/草稿已/);checked();
 // Replays of the existing genuine answer exercise persistence only, never counted as new learning.
 const id=draft.payload.attemptId;const started=await service.beginAttempt(s,id,paperId,answers);
 await assert.rejects(service.beginAttempt(s,id,paperId,answers),/正在批改/);checked();
 await service.failAttempt(s,id,started.token,'验证用失败状态（真实作答副本）');
 assert.equal((await service.practiceHistory(s,paperId))[0].status,'failed');checked();
 const again=await service.beginAttempt(s,id,paperId,answers);
 const grading=[{index:0,verdict:'uncertain',comment:'原题待人工核对',answer:m.correct_answer,explanation:m.reasoning,knowledgePoint:m.knowledge_point}];
 await service.finishAttempt(s,id,again.token,grading,'unassessed');
 assert.ok((await service.beginAttempt(s,id,paperId,answers)).cached);checked();
 const second=randomUUID();const next=await service.beginAttempt(s,second,paperId,answers);await service.finishAttempt(s,second,next.token,grading,'unassessed');
 const history=await service.practiceHistory(s,paperId);assert.equal(history.length,2);assert.deepEqual(history.map(a=>a.answers),[answers,answers]);checked();
 await assert.rejects(service.finishAttempt(s,id,started.token,grading),/轮次已变更/);checked();
 // Reuse existing student reflection as evidence; do not invent learning content.
 {
  const actualEvidence=m.reflection?.trim()||m.incorrect_answer;
  const r=await service.addReview(s,id,actualEvidence,'needs_review','2026-11-12');
  const done=await service.addReview(s,id,actualEvidence,'reviewed',null);
  assert.equal(r.id,done.id);assert.equal((await service.reviews(s)).filter(x=>x.attempt_id===id).length,1);checked();
  assert.equal((await service.reviews(s)).filter(x=>x.state==='needs_review').length,0);checked();
  assert.equal((await service.reviewEvents(s)).filter(x=>x.review_id===r.id).length,2);checked();
 }
 const evidence=await service.learningEvidence(s);
 const evidenceRounds=evidence.attempts.filter(a=>a.paperId===paperId);
 assert.equal(evidenceRounds.length,2);assert.equal(new Set(evidenceRounds.map(a=>a.id)).size,2);checked();
 assert.ok(evidenceRounds.every(a=>a.sourceId===m.id&&a.answers[0]===m.incorrect_answer&&a.gradingSource==='unassessed'));checked();
 assert.equal(evidence.legacyPapers.filter(a=>a.paperId===paperId).length,0);checked();
 const {roundKnowledgeEvidence}=await import('../lib/learning-evidence.ts');
 assert.deepEqual(roundKnowledgeEvidence(evidenceRounds),[]);checked();
 const isolatedEvidence=await service.learningEvidence({...s,profileId:'absent'});assert.deepEqual(isolatedEvidence.attempts,[]);assert.deepEqual(isolatedEvidence.legacyPapers,[]);checked();
 const legacyPaper=await service.ownedPaper(s,paperId);assert.deepEqual(legacyPaper.answers,answers);checked();
 await assert.rejects(service.practiceHistory({...s,profileId:'absent'},paperId),/不属于当前档案/);checked();
 await assert.rejects(service.practiceHistory({...s,userId:'absent'},paperId),/不属于当前档案/);checked();
 const realEssay=(await c.query('SELECT * FROM public.essay_reports LIMIT 1')).rows[0];
 if(realEssay){
  const es={userId:realEssay.user_id,profileId:'default:'+realEssay.user_id};
  const v=await service.saveVersion(es,{id:randomUUID(),promptText:realEssay.prompt_text,originalText:realEssay.original_text,gradeLevel:realEssay.grade_level});
  const reportId=await service.saveVersionReport(es,v.id,realEssay.report_json);assert.equal(await service.saveVersionReport(es,v.id,realEssay.report_json),reportId);checked();
 }else console.log('SKIP 作文业务验收：本机没有真实作文记录，未造文');
 console.log(JSON.stringify({checks,legacyRounds:legacy,persistenceReplayRounds:2,actualNewStudentRounds:0,disposableSchema:true,externalAiCalls:0}));
} finally {
 process.env.DATABASE_URL=originalUrl;
 if(!created)await c.query('ROLLBACK');
 if(created)await c.query(`DROP SCHEMA "${schema}" CASCADE`);
 await c.end();
}
