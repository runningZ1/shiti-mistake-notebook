"use client";

import { useEffect, useState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import type { UploadSummary } from "@/lib/upload-types";

export default function UploadHistory({compact=false,refreshKey,onOpen,onAll,onCollect}:{compact?:boolean;refreshKey:number;onOpen:(id:string)=>void;onAll:()=>void;onCollect?:(ids:string[])=>void}) {
  const [uploadDate,setUploadDate]=useState('');const [homeworkDate,setHomeworkDate]=useState('');const [subject,setSubject]=useState('');const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [page,setPage]=useState(1);
  const [data,setData]=useState<{uploads:UploadSummary[];total:number;totalPages:number}|null>(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    // Reset stale page/error state while loading an external, authenticated resource.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);setError("");
    const filters=new URLSearchParams({page:String(page),limit:String(compact?5:20)});if(uploadDate)filters.set('date',uploadDate);if(homeworkDate)filters.set('homeworkDate',homeworkDate);if(subject)filters.set('subject',subject);
    fetch(`/api/uploads?${filters}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(response.status===401){
        // A full navigation clears account-specific client state after session expiry.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href="/login";return;
      }
      const result=await response.json() as {uploads:UploadSummary[];total:number;totalPages:number;error?:string};
      if(!response.ok || !Array.isArray(result.uploads))throw new Error(result.error||"分析记录加载失败");
      setData(result);
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:"记录加载失败");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[page,compact,refreshKey,attempt,uploadDate,homeworkDate,subject]);
  return <section className="recent-section upload-history" aria-label="作业分析记录">
    <div className="section-heading"><div><span className="section-kicker">UPLOAD HISTORY</span><h2>{compact?"最近作业":"作业"}</h2><p>每次上传都保留记录；待核对、没有错题和处理失败的作业也可在这里找回。</p></div>{compact&&<button onClick={onAll}>查看全部 <ArrowRight size={16}/></button>}</div>
    {!compact&&<><fieldset className="upload-metadata"><legend>按作业查找</legend><label>上传日期<input type="date" value={uploadDate} onChange={e=>{setUploadDate(e.target.value);setPage(1);setSelectedIds([]);}}/></label><label>作业日期<input type="date" value={homeworkDate} onChange={e=>{setHomeworkDate(e.target.value);setPage(1);setSelectedIds([]);}}/></label><label>学科<select value={subject} onChange={e=>{setSubject(e.target.value);setPage(1);setSelectedIds([]);}}><option value="">全部</option>{['数学','语文','英语','物理','化学','生物','历史','地理','道德与法治','科学','其他'].map(s=><option key={s}>{s}</option>)}</select></label><button onClick={()=>{setUploadDate(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));setPage(1);setSelectedIds([]);}}>今天上传</button></fieldset><div className="daily-actions"><button disabled={!data?.uploads.length} onClick={()=>setSelectedIds(v=>Array.from(new Set([...v,...(data?.uploads.map(u=>u.id)||[])])))}>选择本页作业</button><button disabled={!selectedIds.length} onClick={()=>setSelectedIds([])}>清空选择</button><button disabled={!selectedIds.length} onClick={()=>onCollect?.(selectedIds)}>汇总已选 {selectedIds.length} 份作业的归档题目</button></div></>}
    {loading?<div className="empty-recent" role="status"><LoaderCircle className="spin" size={20}/>正在加载分析记录…</div>:error?<div className="notice-card" role="alert">{error}<button onClick={()=>setAttempt(v=>v+1)}>重新加载</button></div>:data?.uploads.length?<>
      <div className="recent-list">{data.uploads.map(item=><div key={item.id} className="upload-history-selection">{!compact&&<input type="checkbox" aria-label={`选择作业 ${item.title}`} checked={selectedIds.includes(item.id)} onChange={e=>setSelectedIds(v=>e.target.checked?[...v,item.id]:v.filter(id=>id!==item.id))}/>}<button className="recent-item upload-history-item" onClick={()=>onOpen(item.id)}>
        <span className="subject-pill sand">{item.subject}</span><span><strong>{item.title||item.fileNames.join("、")}</strong><small>{item.status==="processing"?(item.canRetry?"处理中断，可重试":"处理中"):item.status==="failed"?"处理未完成，已保存资料保留":item.hasAnalysis?"分析已保存":"原始资料已保存"}{item.questionCount!==null?` · 共 ${item.questionCount} 题`:""} · 待核对 {item.pendingCount} 题 · 已归档 {item.mistakeCount} 道</small><small>作业日期 {item.homeworkDate||'未填写'} · {item.gradeLevel}</small></span>
        <small>{new Date(item.createdAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}</small><ArrowRight size={16}/>
      </button></div>)}</div>
      {!compact&&<div className="daily-actions"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>上一页</button><span>第 {page}/{data.totalPages} 页 · 共 {data.total} 次上传</span><button disabled={page>=data.totalPages} onClick={()=>setPage(p=>p+1)}>下一页</button></div>}
    </>:<div className="empty-recent">{data?.total?"本页没有记录，请返回上一页。":"还没有作业上传记录。上传并分析一份作业后会保存在这里。"}</div>}
  </section>;
}
