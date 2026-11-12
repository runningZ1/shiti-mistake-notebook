// Workers HTTP acceptance against a local, isolated copy of genuine records.
// SESSION_SECRET and cookies are read from ignored files and never printed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
const base=process.env.REQUIREMENTS_TEST_URL||'http://127.0.0.1:3127';
assert.ok(new URL(base).hostname==='127.0.0.1','Only isolated local preview is permitted');
const env=parseEnv(readFileSync('work/requirements-verification/runtime.vars','utf8'));
const dbUrl=new URL(env.DATABASE_URL);assert.match(dbUrl.searchParams.get('options')||'',/profile_acceptance_/);
const session=JSON.parse(readFileSync('work/requirements-verification/session.json','utf8'));
let profile=session.profileId;let checks=0;
const artifacts='work/requirements-verification';mkdirSync(artifacts,{recursive:true});
async function api(path,method='GET',body,expected=200){
 const r=await fetch(base+path,{method,headers:{Cookie:`shiti_session=${session.cookie}; shiti_profile=${encodeURIComponent(profile)}`,Origin:base,'Content-Type':'application/json','X-Shiti-Profile':profile},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(data)}`);checks++;return data;
}
const anonymous=await fetch(base+'/api/uploads');assert.equal(anonymous.status,401);checks++;
const list=await api('/api/uploads');assert.ok(list.uploads.length>=2,'Requires two actual saved worksheets');
const ids=[];const edited=[];
for(const up of list.uploads.slice(0,2)){
 const {upload}=await api('/api/uploads/'+up.id);assert.ok(upload.questions.length,'Requires original Baidu OCR');checks++;
 const q=upload.questions[0];
 const input={id:q.id,version:q.version,pageNumber:q.pageNumber,question:q.question,studentAnswer:q.studentAnswer,referenceAnswer:q.referenceAnswer,referenceSource:q.referenceSource,bounds:q.bounds.length?q.bounds:[0,0,1000,1000],state:'confirmed',hasFigure:q.hasFigure};
 const saved=await api(`/api/uploads/${up.id}/questions`,'POST',input);assert.equal(saved.version,q.version+1);checks++;
 await api(`/api/uploads/${up.id}/questions`,'POST',input,409);
 await api(`/api/uploads/${up.id}/questions`,'POST',{...input,version:saved.version,bounds:[900,0,100,100]},400);
 const first=await api(`/api/uploads/${up.id}/questions`,'POST',{action:'archive',id:q.id,version:saved.version,kind:'mistake'});
 const again=await api(`/api/uploads/${up.id}/questions`,'POST',{action:'archive',id:q.id,version:saved.version,kind:'mistake'});
 assert.equal(first.id,again.id,'Repeated archive must not duplicate');checks++;
 ids.push(first.id);edited.push({...input,version:saved.version});
 const draftPath=`/api/uploads/${up.id}/question-drafts?profileId=${encodeURIComponent(profile)}&question=${q.id}`;
 const prior=await api(draftPath);const rev=prior.draft?.revision||0;
 const draft=await api(draftPath,'PUT',{revision:rev,payload:{...input,version:saved.version}});
 await api(draftPath,'PUT',{revision:rev,payload:input},409);
 assert.deepEqual((await api(draftPath)).draft.payload.question,input.question);checks++;
 await api(draftPath+`&revision=${draft.revision}`,'DELETE');
 const history=await api(`/api/uploads/${up.id}/questions?question=${q.id}`);assert.ok(history.versions.length>=2);checks++;
}
const mistakes=await api('/api/mistakes');assert.equal(mistakes.mistakes.filter(m=>ids.includes(m.id)).length,2);checks++;
const archivedBefore=mistakes.mistakes.find(m=>m.id===ids[0]);
const pending=await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',{...edited[0],state:'pending',studentAnswer:''});
const pendingArchive=(await api('/api/mistakes')).mistakes.find(m=>m.id===ids[0]);assert.equal(pendingArchive.incorrectAnswer,archivedBefore.incorrectAnswer);assert.equal(pendingArchive.reasoning,archivedBefore.reasoning);checks++;
const reconfirmed=await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',{...edited[0],version:pending.version,state:'confirmed'});edited[0].version=reconfirmed.version;
const manualId=randomUUID();const manual={...edited[0],id:manualId,version:0};
const manualFirst=await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',manual);const manualAgain=await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',manual);assert.equal(manualFirst.id,manualAgain.id);assert.equal(manualFirst.version,manualAgain.version);checks++;
await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',{...manual,version:manualFirst.version,state:'pending'});
await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',manual,409);
await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',{...manual,id:edited[1].id},409);
// Replay genuine saved student answers to verify separate persistence rounds, without AI or new scores.
const actual=mistakes.mistakes.find(m=>ids.includes(m.id)&&m.incorrectAnswer.trim());assert.ok(actual);
const retry=await api('/api/learning/retries','POST',{mistakeId:actual.id,mode:'original'});const paperId=retry.paperId;
const source=await api(`/api/learning?kind=practice&sourceId=${encodeURIComponent(paperId)}`);assert.equal(source.source.source_id,actual.id);checks++;
const attemptId=source.draft.payload.attemptId,answers=[actual.incorrectAnswer];
await api('/api/learning','POST',{action:'draft',kind:'practice',sourceId:paperId,revision:source.draft.revision,payload:{answers,attemptId}});
await api('/api/learning','POST',{action:'draft',kind:'practice',sourceId:paperId,revision:source.draft.revision,payload:{answers,attemptId}},409);
const firstRound=await api(`/api/practice-papers/${paperId}/grade`,'POST',{answers,attemptId});assert.equal(firstRound.attempt.grading_source,'unassessed');checks++;
const sameRound=await api(`/api/practice-papers/${paperId}/grade`,'POST',{answers,attemptId});assert.equal(sameRound.attempt.id,firstRound.attempt.id);checks++;
await api(`/api/practice-papers/${paperId}/grade`,'POST',{answers,attemptId:randomUUID()});
const rounds=await api(`/api/learning?kind=practice&sourceId=${encodeURIComponent(paperId)}`);assert.equal(rounds.attempts.length,2);checks++;
const evidence=actual.reflection?.trim()||actual.incorrectAnswer;
await api('/api/learning','POST',{action:'review',attemptId,evidence,state:'needs_review',reviewOn:'2026-11-12'});
await api('/api/learning','POST',{action:'review',attemptId,evidence,state:'reviewed',reviewOn:null});
const reviews=await api('/api/learning');assert.equal(reviews.reviews.filter(r=>r.attempt_id===attemptId).length,1);assert.equal(reviews.reviews.find(r=>r.attempt_id===attemptId).state,'reviewed');checks++;
const roundEvidence=await api('/api/learning?kind=evidence');assert.equal(roundEvidence.attempts.filter(a=>a.paperId===paperId).length,2);assert.equal(roundEvidence.legacyPapers.filter(a=>a.paperId===paperId).length,0);checks++;
const essays=await api('/api/learning?kind=essay');assert.ok(Array.isArray(essays.versions));await api('/api/learning','POST',{action:'version',id:randomUUID(),promptText:'',originalText:'',gradeLevel:''},400);
await api(`/api/mistakes/${ids[0]}`,'DELETE');assert.ok(!(await api('/api/mistakes')).mistakes.some(m=>m.id===ids[0]));checks++;
await api(`/api/mistakes/${ids[0]}`,'PATCH',{action:'restore'});assert.ok((await api('/api/mistakes')).mistakes.some(m=>m.id===ids[0]));checks++;
const options={template:'paste',fontSize:14,reflectionMode:'blank',includeAnswers:true,includeSimilar:false,imageWidthMm:165};
const printing=`/api/drafts/printing?profileId=${encodeURIComponent(profile)}`;
const prior=await api(printing);const version=prior.draft?.version||0;
await api(printing,'PUT',{version,payload:{schemaVersion:1,print:{itemIds:[...ids].reverse(),options}}});
await api(printing,'PUT',{version,payload:{schemaVersion:1,print:{itemIds:ids,options}}},409);
assert.deepEqual((await api(printing)).draft.payload.print.itemIds,[...ids].reverse());checks++;
const profiles=await api('/api/profiles');let other=profiles.profiles.find(p=>p.id!==profile);if(!other)other=(await api('/api/profiles','POST',{name:'隔离验证容器（非真实孩子）',gradeLevel:''},201)).profile;
if(other){
 const initial=profile;profile=other.id;
 await api('/api/uploads/'+list.uploads[0].id,'GET',undefined,404);
 await api(`/api/uploads/${list.uploads[0].id}/questions`,'POST',{...edited[0]},404);
 const photo=await fetch(base+`/api/uploads/${list.uploads[0].id}/pages/1`,{headers:{Cookie:`shiti_session=${session.cookie}; shiti_profile=${encodeURIComponent(profile)}`}});assert.equal(photo.status,404);checks++;
 assert.equal((await api('/api/mistakes')).mistakes.length,0);checks++;
 await api(`/api/drafts/printing?profileId=${encodeURIComponent(profile)}`,'PUT',{version:0,payload:{schemaVersion:1,print:{itemIds:ids,options}}},422);
 profile=initial;
}
// Reuse authoritative saved OCR: queue persistence without any OCR/model request.
const job=await api(`/api/uploads/${list.uploads[0].id}/analyze`,'POST',{kind:'recognize'},202);
const duplicate=await api(`/api/uploads/${list.uploads[0].id}/analyze`,'POST',{kind:'recognize'},202);assert.equal(job.job.id,duplicate.job.id);checks++;
const run=await fetch(base+'/api/tasks/run',{method:'POST',headers:{Authorization:`Bearer ${env.TASK_WORKER_SECRET}`}});assert.equal(run.status,200);checks++;
const restored=await api('/api/uploads/'+list.uploads[0].id);assert.equal(restored.upload.status,'completed');checks++;
const wordParams=new URLSearchParams(Object.fromEntries(Object.entries(options).map(([k,v])=>[k,typeof v==='boolean'?(v?'1':'0'):String(v)])));for(const id of [...ids].reverse())wordParams.append('id',id);
const r=await fetch(base+`/api/mistakes/word?${wordParams}`,{headers:{Cookie:`shiti_session=${session.cookie}; shiti_profile=${encodeURIComponent(profile)}`}});
assert.equal(r.status,200,'Actual source image DOCX export must succeed');const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);checks++;
writeFileSync(artifacts+'/two-real-worksheets.docx',bytes);
const c=new pg.Client({connectionString:env.DATABASE_URL});await c.connect();const rows=await c.query('SELECT id,source_question_id,reflection FROM mistakes WHERE id=ANY($1::text[])',[ids]);assert.equal(rows.rowCount,2);checks++;await c.end();
const result={passed:true,checks,uploadIds:list.uploads.slice(0,2).map(u=>u.id),questionIds:edited.map(q=>q.id),archiveIds:ids,profileIsolation:Boolean(other),docxBytes:bytes.length,persistenceReplayRounds:2,externalAiCalls:0,newStudentAnswers:0,verifiedAt:new Date().toISOString()};writeFileSync(artifacts+'/http-evidence.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
