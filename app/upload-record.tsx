"use client";

import type { UploadDetail } from "@/lib/upload-types";
import MathText from "./math-text";
import {useState} from 'react';
import QuestionEditor from './question-editor';
import {subjectNames} from '@/lib/question-types';

export default function UploadRecord({record,busy,trialExpired,onRetry,onViewPhoto,onSaved}:{record:UploadDetail;busy:boolean;trialExpired:boolean;onRetry:(kind?:'recognize'|'analyze')=>void;onViewPhoto:(url:string,title:string)=>void;onSaved:()=>void}) {
 const [adding,setAdding]=useState(false);const [meta,setMeta]=useState({title:record.title,subject:record.subject,gradeLevel:record.gradeLevel,homeworkDate:record.homeworkDate||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())});const [message,setMessage]=useState('');
 async function saveMeta(){try{const r=await fetch(`/api/uploads/${encodeURIComponent(record.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(meta)});const d=await r.json() as {error?:string};if(!r.ok)throw new Error(d.error);setMessage('作业信息已保存');onSaved();}catch(e){setMessage(e instanceof Error?e.message:'保存失败');}}
  return <section className="upload-record" aria-label="原始作业与识别文字">
    {record.jobs.length>0&&<details><summary>处理任务与失败原因</summary>{record.jobs.map(j=><p key={j.id}>{j.kind==='recognize'?'识别任务':'确认后分析'} · {({queued:'排队中',running:'处理中',completed:'已完成',failed:'未完成'})[j.status as 'queued'|'running'|'completed'|'failed']} {j.error||''}</p>)}</details>}
    <fieldset className="question-fields"><legend>作业信息</legend><label>作业名称<input maxLength={200} value={meta.title} onChange={e=>setMeta(v=>({...v,title:e.target.value}))}/></label><label>学科<select value={meta.subject} onChange={e=>setMeta(v=>({...v,subject:e.target.value}))}>{subjectNames.map(s=><option key={s}>{s}</option>)}</select></label><label>年级<input maxLength={60} value={meta.gradeLevel} onChange={e=>setMeta(v=>({...v,gradeLevel:e.target.value}))}/></label><label>作业日期<input type="date" value={meta.homeworkDate} onChange={e=>setMeta(v=>({...v,homeworkDate:e.target.value}))}/></label><small>上传时间：{new Date(record.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}；归档日期以每题实际归档时间为准。</small><button onClick={()=>void saveMeta()}>保存作业信息</button><p role="status">{message}</p></fieldset>
    {!record.hasAnalysis&&<div className="notice-card" role="status">{record.status==="processing"?"作业处理任务已保存，稍后可从作业列表继续查看。":record.status==="failed"?record.error||"处理未完成，原图已保存。":record.questions.length?"识别结果已保存。请核对题目和题框，再选择人工归档、复习收藏或分析确认后的作答。":"这是一条升级前的历史记录。当时未保存完整判题结果，下面展示真实保留的原图、识别文字和已归档题目。"}</div>}
    {record.canRetry&&<div className="daily-actions"><button onClick={()=>onRetry('recognize')} disabled={busy||trialExpired}>重试未完成页识别</button><span>已成功的页保留，仅处理失败或未识别的页。</span></div>}
    {record.questions.length>0&&<div className="daily-actions"><button onClick={()=>onRetry('analyze')} disabled={busy||trialExpired||!record.questions.some(q=>q.state==='confirmed')}>分析已保存并确认的题目</button><span>仅此按钮调用判题服务；图形与缺失信息仍可人工处理。</span></div>}
    <h2>核对用照片（按上传页序与旋转结果）</h2><p>题框、OCR 和导出均使用下方同一图像版本。<a href={`/api/uploads/${encodeURIComponent(record.id)}/pages/1?original=1`} target="_blank" rel="noreferrer">查看第1页未变换原始照片</a></p><div className="record-photos">{record.fileNames.map((name,index)=>{
      const url=`/api/uploads/${encodeURIComponent(record.id)}/pages/${index+1}`;
      return <button type="button" key={index} onClick={()=>onViewPhoto(url,`第 ${index+1} 页 · ${name}`)}><img src={url} alt={`第 ${index+1} 页原图：${name}`} loading="lazy"/><span>第 {index+1} 页 · {name}</span></button>;
    })}</div>
    <h2>逐题核对、人工归档与收藏</h2><p>可先处理部分题。手动归档、编辑和打印无需 AI；空白题可收藏，不会自动判错。</p>
    {record.questions.map(q=><QuestionEditor key={q.id} record={record} item={q} onSaved={onSaved}/>)}
    <button onClick={()=>setAdding(v=>!v)}>{adding?'收起新增题目':'框选新增一道题'}</button>{adding&&<QuestionEditor record={record} onSaved={()=>{setAdding(false);onSaved();}}/>}
    {record.ocrPages.length>0&&record.questions.length===0&&<><h2>识别文字 · 请对照原图核对</h2><p>待核对表示尚不能确认对错；不等于作业没有错误。</p>{record.ocrPages.map(page=><div key={page.pageNumber}>{page.result.qus_result.map((question,index)=>{
      const text=(types:number[])=>question.qus_element.filter(e=>types.includes(Number(e.elem_type))).flatMap(e=>e.elem_word.map(w=>w.word)).join("\n");
      const verdict=record.analysis?.grading.find(g=>g.pageNumber===page.pageNumber&&g.questionLabel===`${page.pageNumber}:${index+1}`);
      return <article className="record-question" key={index}><h3>第 {page.pageNumber} 页 · 第 {index+1} 个识别题目{verdict?` · ${verdict.verdict==="uncertain"?"待核对":verdict.verdict==="correct"?"正确":"错误"}`:""}</h3><div><b>题干与选项</b><MathText value={text([0,1,3])||"未识别到完整题干，请查看原图。"}/></div><div><b>识别到的作答</b><MathText value={text([2])||"未识别到作答。"}/></div>{text([5])&&<div><b>照片中的参考答案</b><MathText value={text([5])}/></div>}{verdict&&<p><MathText value={verdict.comment}/></p>}</article>;
    })}</div>)}</>}
  </section>;
}
