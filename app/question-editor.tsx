"use client";
import {useEffect,useRef,useState} from 'react';
import type {ConfirmedQuestion} from '@/lib/question-types';
import type {UploadDetail} from '@/lib/upload-types';
import MathText from './math-text';

type Editable=Pick<ConfirmedQuestion,'id'|'version'|'pageNumber'|'question'|'studentAnswer'|'referenceAnswer'|'referenceSource'|'bounds'|'state'|'hasFigure'>;
export default function QuestionEditor({record,item,onSaved}:{record:UploadDetail;item?:ConfirmedQuestion;onSaved:()=>void}){
 const [value,setValue]=useState<Editable>(item||{id:crypto.randomUUID(),version:0,pageNumber:1,question:'',studentAnswer:'',referenceAnswer:'',referenceSource:'用户提供',bounds:[],state:'pending',hasFigure:true});
 const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');const [dirty,setDirty]=useState(false);
 const [draftCycle,setDraftCycle]=useState(0);const lastDraft=useRef('');const [lastDraftValue,setLastDraftValue]=useState('');const [isBlocked,setIsBlocked]=useState(false);
 const [history,setHistory]=useState<{versions:unknown[];reports:unknown[]}|null>(null);
 const [remoteDraft,setRemoteDraft]=useState<{revision:number;payload:Editable}|null>(null);
 const [draftReady,setDraftReady]=useState(false);const [draftNotice,setDraftNotice]=useState('');const revision=useRef(0),draftSaving=useRef(false),blocked=useRef(false);
 const draftUrl=`/api/uploads/${encodeURIComponent(record.id)}/question-drafts?profileId=${encodeURIComponent(record.profileId)}&question=${encodeURIComponent(item?.id||'new')}`;
 useEffect(()=>{const c=new AbortController();fetch(draftUrl,{cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json() as {draft:{revision:number;payload:Editable}|null;error?:string};if(!r.ok)throw new Error(d.error);if(d.draft){revision.current=d.draft.revision;setValue(d.draft.payload);setDirty(true);setDraftNotice('已恢复服务器未提交草稿，请核对后保存确认');}setDraftReady(true);}).catch(e=>{if(!c.signal.aborted){blocked.current=true;setIsBlocked(true);setDraftReady(true);setDraftNotice(e.message);}});return()=>c.abort();},[draftUrl]);
 useEffect(()=>{if(!draftReady||!dirty||busy||blocked.current||JSON.stringify(value)===lastDraft.current)return;const t=setTimeout(async()=>{if(draftSaving.current)return;draftSaving.current=true;try{const r=await fetch(draftUrl,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:revision.current,payload:value})});const d=await r.json() as {revision:number;error?:string};if(!r.ok){if(r.status===409)blocked.current=true;setIsBlocked(true);throw new Error(d.error);}revision.current=d.revision;lastDraft.current=JSON.stringify(value);setLastDraftValue(JSON.stringify(value));setDraftNotice('未提交内容已保存到服务器草稿');}catch(e){blocked.current=true;setIsBlocked(true);setDraftNotice(e instanceof Error?e.message:'草稿保存失败');}finally{draftSaving.current=false;setDraftCycle(n=>n+1);}},700);return()=>clearTimeout(t);},[value,draftReady,dirty,busy,draftUrl,draftCycle]);
 const start=useRef<number[]|null>(null);
 const page=record.ocrPages.find(p=>p.pageNumber===value.pageNumber);const pw=page?.width||1000,ph=page?.height||1400;
 const photo=`/api/uploads/${encodeURIComponent(record.id)}/pages/${value.pageNumber}`;
 function change(p:Partial<Editable>){setValue(v=>({...v,...p}));setDirty(true);setNotice('有未保存的修改');}
 function point(e:React.PointerEvent<HTMLDivElement>){const r=e.currentTarget.getBoundingClientRect();return[Math.max(0,Math.min(1000,Math.round((e.clientX-r.left)/r.width*1000))),Math.max(0,Math.min(1000,Math.round((e.clientY-r.top)/r.height*1000)))];}
 async function send(body:object){const r=await fetch(`/api/uploads/${encodeURIComponent(record.id)}/questions`,{method:'POST',headers:{'Content-Type':'application/json','X-Shiti-Profile':record.profileId},body:JSON.stringify(body)});const d=await r.json() as {id:string;version:number;error?:string};if(!r.ok)throw new Error(d.error||'保存失败');return d;}
 async function save(state:Editable['state']){
  if(draftSaving.current){setNotice('服务器草稿正在保存，请稍后再次确认');return;}setBusy(true);try{const d=await send({...value,id:value.id||undefined,state});setValue(v=>({...v,id:d.id,version:d.version,state}));setDirty(false);if(revision.current){await fetch(`${draftUrl}&revision=${revision.current}`,{method:'DELETE'});revision.current=0;}setDraftNotice('');setNotice(`已保存版本 ${d.version} · ${state==='confirmed'?'已确认':state==='ignored'?'已忽略，可恢复':'待核对'}`);onSaved();}catch(e){setNotice(e instanceof Error?e.message:'保存失败，输入保留');}finally{setBusy(false);}
 }
 async function archive(kind:'mistake'|'collection'){
  setBusy(true);try{if(dirty||!value.id||value.state!=='confirmed')throw new Error('请先保存并确认当前内容');await send({action:'archive',id:value.id,version:value.version,kind});setNotice(kind==='mistake'?'已人工确认归档为错题':'已收藏，不判为错误');onSaved();}catch(e){setNotice(e instanceof Error?e.message:'归档失败');}finally{setBusy(false);}
 }
 const box=value.bounds;
 useEffect(()=>{if(!dirty||JSON.stringify(value)===lastDraft.current)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty,value,draftCycle]);
 return <article data-unsaved-question={dirty&&JSON.stringify(value)!==lastDraftValue?"true":"false"} className="record-question question-editor" aria-label={item?'核对题目':'框选新增题目'}>
  <h3>{item?`第 ${value.pageNumber} 页 · ${item.sourceIndex===null?'手动题目':`第 ${item.sourceIndex+1} 题`}`:'框选新增一道题'} · 版本 {value.version||'未保存'} {item?.archiveId&&' · 已归档'}</h3>
  {item?.report&&<div className="notice-card"><b>{item.reportStale?'旧分析已过期 · ':''}{({correct:'正确',incorrect:'模型建议错误',uncertain:'无法判断',unanswered:'未作答'})[item.report.verdict]}</b><MathText value={item.report.comment}/>{item.report.reasoning&&<MathText value={item.report.reasoning}/>}<small>分析输入版本 {item.reportVersion}；人工归档单独记录。</small></div>}
  <fieldset disabled={busy||!draftReady} className="question-fields">
   <label>原图页码<select value={value.pageNumber} onChange={e=>change({pageNumber:Number(e.target.value),bounds:[]})}>{record.fileNames.map((n,i)=><option key={i} value={i+1}>{i+1} · {n}</option>)}</select></label>
   <label>题干与选项<textarea rows={4} value={value.question} onChange={e=>change({question:e.target.value})}/></label><MathText value={value.question}/>
   <label>学生作答<textarea rows={2} value={value.studentAnswer} onChange={e=>change({studentAnswer:e.target.value})}/></label>
   <label>参考答案<textarea rows={2} value={value.referenceAnswer} onChange={e=>change({referenceAnswer:e.target.value})}/></label>
   <label>参考答案来源<input value={value.referenceSource} onChange={e=>change({referenceSource:e.target.value})}/></label>
   <label><input type="checkbox" checked={value.hasFigure} onChange={e=>change({hasFigure:e.target.checked})}/>包含图形或必须参考原图（保留原图，不要求 AI 猜图）</label>
   <details><summary>调整题框：在原图上拖动框选完整题目</summary>
    <div className="question-crop" onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!start.current)return;const p=point(e),s=start.current;change({bounds:[Math.min(s[0],p[0]),Math.min(s[1],p[1]),Math.max(s[0],p[0]),Math.max(s[1],p[1])]});}} onPointerUp={()=>{start.current=null;}} onPointerCancel={()=>{start.current=null;}}>
     <img src={photo} alt="拖动框选题目区域" draggable={false}/>{box.length===4&&<div className="question-crop-box" style={{left:`${box[0]/10}%`,top:`${box[1]/10}%`,width:`${(box[2]-box[0])/10}%`,height:`${(box[3]-box[1])/10}%`}}/>}
    </div>
    <div className="question-bounds">{['左','上','右','下'].map((label,i)=><label key={i}>{label}（0–1000）<input type="number" min={0} max={1000} value={box[i]??(i<2?0:1000)} onChange={e=>{const next=box.length===4?[...box]:[0,0,1000,1000];next[i]=Number(e.target.value);change({bounds:next});}}/></label>)}</div>
    <button type="button" onClick={()=>change({bounds:[0,0,1000,1000]})}>明确保留整页原图</button>
   </details>
   {box.length===4&&box[2]>box[0]&&box[3]>box[1]&&<figure className="question-crop-preview"><figcaption>题图裁剪预览</figcaption><svg viewBox={`${box[0]*pw/1000} ${box[1]*ph/1000} ${(box[2]-box[0])*pw/1000} ${(box[3]-box[1])*ph/1000}`} role="img" aria-label="选中的题图"><image href={photo} width={pw} height={ph}/></svg></figure>}
  </fieldset>
  <div className="daily-actions"><button disabled={busy} onClick={()=>void save('pending')}>暂存待核对</button><button disabled={busy} onClick={()=>void save('confirmed')}>保存并确认</button><button disabled={busy} onClick={()=>void save(value.state==='ignored'?'pending':'ignored')}>{value.state==='ignored'?'恢复待核对':'忽略残题'}</button><button disabled={busy||dirty||value.state!=='confirmed'} onClick={()=>void archive('mistake')}>老师已判错 · 人工归档</button><button disabled={busy||dirty||value.state!=='confirmed'} onClick={()=>void archive('collection')}>不会做 / 复习收藏</button></div>
  <p role="status">{busy?'正在保存…':notice||`已保存 · ${value.state==='pending'?'待核对':value.state==='confirmed'?'已确认':'已忽略'}`}</p>
  <p role="status">{draftNotice}</p>
  {isBlocked&&<button type="button" onClick={()=>void fetch(draftUrl,{cache:'no-store'}).then(async r=>{const d=await r.json() as {draft:{revision:number;payload:Editable}|null;error?:string};if(!r.ok){setDraftNotice(d.error||'读取草稿失败');return;}setRemoteDraft(d.draft||{revision:0,payload:value});})}>读取服务器草稿以解决冲突（保留当前输入）</button>}
  {remoteDraft&&<div className="notice-card"><details><summary>查看服务器草稿</summary><pre className="ocr-original">{JSON.stringify(remoteDraft.payload,null,2)}</pre></details><button onClick={()=>{revision.current=remoteDraft.revision;blocked.current=false;setIsBlocked(false);setValue(remoteDraft.payload);setDirty(true);setRemoteDraft(null);setDraftCycle(n=>n+1);}}>使用服务器草稿</button><button onClick={()=>{revision.current=remoteDraft.revision;blocked.current=false;setIsBlocked(false);setRemoteDraft(null);setDraftCycle(n=>n+1);}}>保留当前输入并继续保存</button></div>}
  {item?.originalOcr!==null&&<details><summary>查看只读 OCR 原始资料</summary><pre className="ocr-original">{JSON.stringify(item?.originalOcr,null,2)}</pre></details>}
  {item&&<details onToggle={e=>{if(e.currentTarget.open)void fetch(`/api/uploads/${encodeURIComponent(record.id)}/questions?question=${encodeURIComponent(item.id)}`,{cache:'no-store'}).then(async r=>{if(r.ok)setHistory(await r.json() as {versions:unknown[];reports:unknown[]});});}}><summary>历史确认版本与分析报告</summary><pre className="ocr-original">{history?JSON.stringify(history,null,2):'正在读取已保存历史…'}</pre></details>}
 </article>;
}
