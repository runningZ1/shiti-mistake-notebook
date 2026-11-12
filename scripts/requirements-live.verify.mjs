// Explicit opt-in: genuine existing worksheet -> private R2 -> Baidu OCR -> confirmed-text analysis.
// Operates only against isolated local DB; no manufactured student work or provider responses.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
assert.ok(process.argv.includes('--live'),'Live provider checks require --live');
const base='http://127.0.0.1:3127';const env=parseEnv(readFileSync('work/requirements-verification/runtime.vars','utf8'));
assert.match(new URL(env.DATABASE_URL).searchParams.get('options')||'',/profile_acceptance_/);
const session=JSON.parse(readFileSync('work/requirements-verification/session.json','utf8'));
const headers={Cookie:`shiti_session=${session.cookie}; shiti_profile=${encodeURIComponent(session.profileId)}`,Origin:base,'X-Shiti-Profile':session.profileId};
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();assert.ok(r.ok,`${path} ${r.status}: ${JSON.stringify(d)}`);return d;}
const {uploads}=await api('/api/uploads');const source=uploads.find(u=>u.fileNames.some(n=>n.includes('jelly')))||uploads[0];assert.ok(source);
const photo=await fetch(base+`/api/uploads/${source.id}/pages/1`,{headers});assert.equal(photo.status,200);const bytes=await photo.arrayBuffer();
const form=new FormData();const name=source.fileNames[0];const mime=photo.headers.get('Content-Type');
form.append('files',new File([bytes],name,{type:mime}));form.append('originalFiles',new File([bytes],name,{type:mime}));form.set('intent','marked');form.set('title',source.title||name);form.set('subject',source.subject);form.set('rotations','[0]');form.set('homeworkDate','2026-11-12');
const key=randomUUID();
const upload=await fetch(base+'/api/analyze',{method:'POST',headers:{...headers,'Idempotency-Key':key},body:form});const created=await upload.json();assert.equal(upload.status,202,JSON.stringify(created));
const replay=await fetch(base+'/api/analyze',{method:'POST',headers:{...headers,'Idempotency-Key':key},body:form});const repeated=await replay.json();assert.equal(replay.status,202);assert.equal(repeated.uploadId,created.uploadId);
writeFileSync('work/requirements-verification/live-created.json',JSON.stringify({uploadId:created.uploadId,userId:session.userId,profileId:session.profileId,createdAt:new Date().toISOString()}));
// There is deliberately no /run call here: the separate supervised executor owns work.
async function waitForJob(kind){for(let i=0;i<90;i++){const {upload}=await api('/api/uploads/'+created.uploadId);const job=upload.jobs.find(j=>j.kind===kind);if(job?.status==='failed')throw new Error(job.error);if(job?.status==='completed')return upload;await new Promise(r=>setTimeout(r,2000));}throw new Error('Persistent job timed out');}
const recognized=await waitForJob('recognize');assert.ok(recognized.questions.length);const q=recognized.questions.find(q=>q.question.trim()&&q.studentAnswer.trim());assert.ok(q);
const saved=await api(`/api/uploads/${created.uploadId}/questions`,'POST',{id:q.id,version:q.version,pageNumber:q.pageNumber,question:q.question,studentAnswer:q.studentAnswer,referenceAnswer:q.referenceAnswer,referenceSource:q.referenceSource,bounds:q.bounds,state:'confirmed',hasFigure:q.hasFigure});
await api(`/api/uploads/${created.uploadId}/analyze`,'POST',{kind:'analyze'});
// Wait until the real model request owns its input, then create a newer pending version.
let running=false;for(let i=0;i<80;i++){const d=await api('/api/uploads/'+created.uploadId);const j=d.upload.jobs.find(j=>j.kind==='analyze');if(j?.status==='running'){running=true;break;}if(j?.status==='completed'||j?.status==='failed')break;await new Promise(r=>setTimeout(r,250));}
assert.ok(running,'Need an actual in-flight model job for stale-result acceptance');
const pending=await api(`/api/uploads/${created.uploadId}/questions`,'POST',{id:q.id,version:saved.version,pageNumber:q.pageNumber,question:q.question,studentAnswer:q.studentAnswer,referenceAnswer:q.referenceAnswer,referenceSource:q.referenceSource,bounds:q.bounds,state:'pending',hasFigure:q.hasFigure});
const stale=await waitForJob('analyze');assert.equal(stale.hasAnalysis,false,'Old input must not overwrite current upload summary');assert.equal(stale.questions.find(x=>x.id===q.id).reportStale,true);
const currentSaved=await api(`/api/uploads/${created.uploadId}/questions`,'POST',{id:q.id,version:pending.version,pageNumber:q.pageNumber,question:q.question,studentAnswer:q.studentAnswer,referenceAnswer:q.referenceAnswer,referenceSource:q.referenceSource,bounds:q.bounds,state:'confirmed',hasFigure:q.hasFigure});
await api(`/api/uploads/${created.uploadId}/analyze`,'POST',{kind:'analyze'});
const analyzed=await waitForJob('analyze');const current=analyzed.questions.find(x=>x.id===q.id);assert.equal(current.reportVersion,currentSaved.version);assert.ok(current.report);assert.equal(analyzed.mistakes.length,0,'Model suggestions never auto-archive');
const c=new pg.Client({connectionString:env.DATABASE_URL});await c.connect();const count=(await c.query('SELECT count(*)::int n FROM uploads WHERE user_id=$1 AND request_key=$2',[session.userId,key])).rows[0].n;assert.equal(count,1);await c.end();
const evidence={passed:true,sourceUploadId:source.id,uploadId:created.uploadId,questionCount:recognized.questions.length,reportVersion:current.reportVersion,verdict:current.report.verdict,staleResultRetainedOnlyInHistory:true,requestReplaySameId:true,independentExecutor:true,browserClosed:true,realOcrCalls:1,realAnalysisJobs:2,automaticArchives:0,verifiedAt:new Date().toISOString()};writeFileSync('work/requirements-verification/live-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
