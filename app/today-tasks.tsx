"use client";
import {useEffect,useState} from 'react';
type Tasks={pending:number;corrections:number;reviews:number;continueUpload:string|null};
export default function TodayTasks({refreshKey,onOpen,onPractice}:{refreshKey:number;onOpen:(id:string)=>void;onPractice:()=>void}){
 const [data,setData]=useState<Tasks|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();fetch('/api/workspace',{cache:'no-store',signal:c.signal}).then(async r=>{const d=await r.json() as Tasks&{error?:string};if(!r.ok)throw new Error(d.error);setData(d);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});return()=>c.abort();},[refreshKey]);
 return <section className="notice-card today-tasks" aria-label="今天要处理"><h2>今天要处理</h2>{error?<p role="alert">{error}</p>:!data?<p>读取真实待办…</p>:<><button onClick={()=>data.continueUpload&&onOpen(data.continueUpload)} disabled={!data.continueUpload}>待核对 {data.pending} 题</button><button onClick={onPractice}>待订正 {data.corrections} 条</button><button onClick={onPractice}>到期复习 {data.reviews} 条</button>{data.continueUpload&&<button onClick={()=>onOpen(data.continueUpload!)}>继续上次作业</button>}</>}</section>;
}
