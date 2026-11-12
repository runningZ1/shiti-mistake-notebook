"use client";

import MathText from "./math-text";
import "./study-tools.css";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Download, FileText, Lightbulb, LoaderCircle, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import type { PracticeDetail, PracticeSummary } from "@/lib/practice-types";
import { practiceFormatBlueprint, practiceFormatLabels, practiceKindLabels, kindForQuestion, validPracticeCount } from "@/lib/practice-blueprint";
import { normalizeKnowledgePoint } from "@/lib/knowledge-types";

function redirectIfUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  // Full navigation clears practice answers held in memory after session expiry.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
  return true;
}

function paperSummary(paper: PracticeDetail): PracticeSummary {
  return {
    id: paper.id, subject: paper.subject, unitName: paper.unitName, gradeLevel: paper.gradeLevel,
    questionCount: paper.questionCount, createdAt: paper.createdAt, gradedAt: paper.gradedAt,
    correctCount: paper.correctCount, incorrectCount: paper.incorrectCount,
    uncertainCount: paper.uncertainCount, wrongKnowledgePoints: paper.wrongKnowledgePoints,
    correctKnowledgePoints: paper.correctKnowledgePoints,
  };
}

const draftKey = (id: string) => `shiti-practice-draft:${id}`;

export default function UnitPractice({ subjects, papers, weakPoints, initialSubject, initialUnit, initialPoint, trialExpired, aiReady, onSaved, onTrialExpired, onReviewPoint }: {
  subjects: string[];
  papers: PracticeSummary[];
  weakPoints: Array<{ subject: string; knowledgePoint: string }>;
  initialSubject: string;
  initialUnit: string;
  initialPoint: string;
  trialExpired: boolean;
  aiReady: boolean | null;
  onSaved: (paper: PracticeSummary) => void;
  onTrialExpired: () => void;
  onReviewPoint: (subject: string, point: string) => void;
}) {
  const [subject, setSubject] = useState(initialSubject || subjects[0] || "数学");
  const [unitName, setUnitName] = useState(initialUnit);
  const [gradeLevel, setGradeLevel] = useState("");
  const [countInput, setCountInput] = useState(initialPoint ? "3" : "10");
  const count = Number(countInput);
  const validCount = countInput.trim() !== "" && validPracticeCount(count);
  const [selectedPoints, setSelectedPoints] = useState<string[]>(initialPoint ? [normalizeKnowledgePoint(initialPoint)] : []);
  const [customPoint, setCustomPoint] = useState("");
  const [paper, setPaper] = useState<PracticeDetail | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [retaking, setRetaking] = useState(false);
  const learningProfile=useRef<string|null>(null);
  const [source,setSource]=useState<{source:string;source_id:string;upload_id:string|null;page_number:number|null;question_bounds:unknown}|null>(null);
  const [reviewEvents,setReviewEvents]=useState<Array<{id:string;review_id:string;state:string;review_on:string|null;evidence:string;created_at:string}>>([]);
  const [savedReviews,setSavedReviews]=useState<Array<{id:string;attempt_id:string;evidence:string;state:string;review_on:string|null}>>([]);
  async function loadReviews() {
    try{const r=await fetch('/api/learning',{headers:learningProfile.current?{'X-Shiti-Profile':learningProfile.current}:{}});const d=await r.json() as {profileId:string;error?:string;reviews:typeof savedReviews;events:typeof reviewEvents};if(!r.ok)throw new Error(d.error||'复习记录加载失败');learningProfile.current=d.profileId;setSavedReviews(d.reviews);setReviewEvents(d.events);}
    catch(e){setError(e instanceof Error?e.message:'复习记录加载失败');}
  }
  async function updateReview(r:typeof savedReviews[number]) {
    try{await learningRequest({action:'review',attemptId:r.attempt_id,evidence:r.evidence,state:r.state,reviewOn:r.review_on?.slice(0,10)||null});await loadReviews();setDraftStatus('复习当前状态已更新，事件历史已保留');}
    catch(e){setError(e instanceof Error?e.message:'更新失败');}
  }
  const [viewAttemptId,setViewAttemptId]=useState('');
  const [attemptId,setAttemptId]=useState('');
  const [draftRevision,setDraftRevision]=useState(0);
  const [draftStatus,setDraftStatus]=useState('');
  const [attempts,setAttempts]=useState<Array<{id:string;answers:string[];grading:PracticeDetail['grading'];status:string;source:string;completed_at:string|null;error:string|null;grading_source:string|null}>>([]);
  const [evidence,setEvidence]=useState('');
  const [reviewOn,setReviewOn]=useState('');
  const [reviewState,setReviewState]=useState('needs_review');
  async function learningRequest(body:unknown) {
    const r=await fetch('/api/learning',{method:'POST',headers:{'Content-Type':'application/json',...(learningProfile.current?{'X-Shiti-Profile':learningProfile.current}:{})},body:JSON.stringify(body)});
    const d=await r.json() as {error?:string;draft:{revision:number}};if(!r.ok)throw new Error(d.error||'保存失败');return d;
  }
  async function saveServerDraft() {
    if(!paper)return;
    try {const d=await learningRequest({action:'draft',kind:'practice',sourceId:paper.id,revision:draftRevision,payload:{answers,attemptId}});setDraftRevision(d.draft.revision);setDraftStatus('草稿已保存到服务器');}
    catch(e){setError(e instanceof Error?e.message:'草稿保存失败，输入仍保留');}
  }
  async function saveReview() {
    const completed=attempts.find(a=>a.status==='completed');if(!completed)return;
    try{await learningRequest({action:'review',attemptId:completed.id,evidence,state:reviewState,reviewOn:reviewOn||null});setDraftStatus('订正/复习证据已保存');await loadReviews();}
    catch(e){setError(e instanceof Error?e.message:'保存失败');}
  }

  const [busy, setBusy] = useState<"generate" | "grade" | string | null>(null);
  const [error, setError] = useState("");
  const paperRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function rememberPaper(id:string) { const url=new URL(window.location.href);url.searchParams.set("paper",id);window.history.replaceState(null,"",url); }
  async function readJson(response: Response) {
    if (redirectIfUnauthorized(response)) return null;
    const data = await response.json() as { paper?: PracticeDetail; error?: string; code?: string };
    if (data.code === "TRIAL_EXPIRED") onTrialExpired();
    if (!response.ok) throw new Error(data.error || "操作失败，请重试");
    return data;
  }
  const scrollToPaper = () => window.setTimeout(() => {
    paperRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    paperRef.current?.focus({ preventScroll: true });
  }, 0);
  async function openPaper(id: string) {
    setBusy(id); setError("");
    try {
      const data = await readJson(await fetch(`/api/practice-papers/${encodeURIComponent(id)}`));
      if (!data) return;
      if (!data.paper) throw new Error("练习卷内容未返回，请重试。");
      const savedAnswers = data.paper.answers.length ? data.paper.answers : data.paper.questions.map(() => "");
      let draft: string[] | null = null;
      try {
        const raw = window.sessionStorage.getItem(draftKey(id));
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed) && parsed.length === data.paper.questions.length && parsed.every(item => typeof item === "string")) draft = parsed;
        }
      } catch { /* Browser storage may be disabled. */ }
      const hr=await fetch(`/api/learning?kind=practice&sourceId=${encodeURIComponent(id)}`);const hd=await hr.json() as {profileId:string;error?:string;source:typeof source;attempts:typeof attempts;draft:{revision:number;payload:{answers:string[];attemptId:string}}|null};if(!hr.ok)throw new Error(hd.error||'学习历史加载失败');
      learningProfile.current=hd.profileId;setSource(hd.source);setAttempts(hd.attempts);setDraftRevision(hd.draft?.revision||0);setDraftStatus('');
      const server=hd.draft?.payload;
      const pending=server && !hd.attempts.some((a:{id:string;status:string})=>a.id===server.attemptId&&a.status==='completed');
      setAttemptId(pending?server.attemptId:crypto.randomUUID());
      rememberPaper(data.paper.id); setPaper(data.paper); setAnswers(pending?server.answers:(draft || savedAnswers));
      setRetaking(Boolean(pending||draft));
      const targetAttempt=new URLSearchParams(window.location.search).get('attempt')||'';
      setViewAttemptId(targetAttempt);
      if(targetAttempt&&hd.attempts.some(a=>a.id===targetAttempt))window.setTimeout(()=>document.getElementById(`attempt-${targetAttempt}`)?.scrollIntoView({behavior:'smooth',block:'start'}),0);
      else scrollToPaper();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "练习卷加载失败"); }
    finally { setBusy(null); }
  }
  const restoreSavedDetail = useEffectEvent((id:string) => { void openPaper(id); });
  useEffect(() => {
    const restore=()=>{const id=new URLSearchParams(window.location.search).get("paper");if(id)restoreSavedDetail(id);};
    restore(); window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);
  }, []);


  const suggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of weakPoints) if (item.subject === subject) {
      const point = normalizeKnowledgePoint(item.knowledgePoint);
      if (point) counts.set(point, (counts.get(point) || 0) + 1);
    }
    for (const paperItem of papers) if (paperItem.subject === subject) {
      for (const name of paperItem.wrongKnowledgePoints) {
        const point = normalizeKnowledgePoint(name);
        if (point) counts.set(point, (counts.get(point) || 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, hits]) => ({ name, hits }));
  }, [weakPoints, papers, subject]);
  const formatPlan = validCount ? practiceFormatBlueprint(count) : [];
  const formatCounts = [...new Set(formatPlan)].map(format => `${practiceFormatLabels[format]} ${formatPlan.filter(item => item === format).length} 道`);

  function togglePoint(point: string) {
    setError("");
    if (selectedPoints.includes(point)) {
      setSelectedPoints(current => current.filter(item => item !== point));
    } else if (selectedPoints.length >= Math.min(validCount ? count : 0, 4)) {
      setError(validCount ? `这份卷最多选择 ${Math.min(count, 4)} 个知识点。` : "请先设置 1 到 30 道题。");
    } else {
      setSelectedPoints(current => [...current, point]);
    }
  }

  function addCustomPoint() {
    const point = normalizeKnowledgePoint(customPoint);
    if (!point || point.length > 100) { setError("知识点名称应为 1 到 100 个字。"); return; }
    if (!selectedPoints.includes(point)) {
      if (selectedPoints.length >= Math.min(validCount ? count : 0, 4)) { setError(validCount ? `这份卷最多选择 ${Math.min(count, 4)} 个知识点。` : "请先设置 1 到 30 道题。"); return; }
      togglePoint(point);
    }
    setCustomPoint("");
  }







  async function generate() {
    if (trialExpired) { setError("免费体验已结束，请联系管理员开通后再生成练习卷。"); return; }
    if (!subject.trim() || !unitName.trim()) { setError("请填写科目和单元名称。"); return; }
    if (!validCount) { setError("题目数量应为 1 到 30 道。"); return; }
    setBusy("generate"); setError("");
    try {
      const response = await fetch("/api/practice-papers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: subject.trim(), unitName: unitName.trim(), gradeLevel: gradeLevel.trim(), count, focusPoints: selectedPoints }) });
      const data = await readJson(response);
      if (!data) return;
      if (!data.paper) throw new Error("练习卷内容未返回，请重试。");
      rememberPaper(data.paper.id); setPaper(data.paper); setAnswers(data.paper.questions.map(() => "")); setRetaking(false);
      setAttemptId(crypto.randomUUID());setDraftRevision(0);setAttempts([]);setSource(null);setDraftStatus('');
      onSaved(paperSummary(data.paper));
      await openPaper(data.paper.id);
      scrollToPaper();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成练习卷失败"); }
    finally { setBusy(null); }
  }

  async function grade() {
    if (!paper) return;
    if (trialExpired && source?.source!=='original') { setError("免费体验已结束，请联系管理员开通后再批改练习卷。"); return; }
    if (!answers.some(answer => answer.trim())) { setError("请至少完成一题再提交批改。"); return; }
    setBusy("grade"); setError("");
    try {
      const response = await fetch(`/api/practice-papers/${encodeURIComponent(paper.id)}/grade`, { method: "POST", headers: { "Content-Type": "application/json", ...(learningProfile.current?{"X-Shiti-Profile":learningProfile.current}:{}) }, body: JSON.stringify({ answers, attemptId }) });
      const data = await readJson(response);
      if (!data) return;
      if (!data.paper) throw new Error("批改结果未返回，请重试。");
      setPaper(data.paper); setAnswers(data.paper.answers); setRetaking(false);
      try { window.sessionStorage.removeItem(draftKey(paper.id)); } catch { /* Browser storage may be disabled. */ }
      onSaved(paperSummary(data.paper));
      await openPaper(paper.id);
      scrollToPaper();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "批改失败，请重试"); }
    finally { setBusy(null); }
  }

  const showGrading = Boolean(paper?.gradedAt && !retaking);
  function updateAnswer(index: number, value: string) {
    const next = answers.map((answer, i) => i === index ? value : answer);
    setAnswers(next);
    if (paper) {
      try { window.sessionStorage.setItem(draftKey(paper.id), JSON.stringify(next)); } catch { /* Browser storage may be disabled. */ }
    }
  }
  const answeredCount = answers.filter(answer => answer.trim()).length;
  const aiUnavailable = aiReady !== true;
  return <div className="study-tools practice-tool">
    <section className="page-intro"><span className="section-kicker">UNIT PRACTICE</span><h1>单元练习卷</h1><p>确定范围、完成作答、查看批改。也可下载 Word，保留纸笔练习的习惯。</p></section>
    {error && <div className="practice-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
    <nav className="tool-shortcuts" aria-label="练习卷页面导航"><a href="#practice-create">生成新练习</a><a href="#practice-history">历史练习 · {papers.length}</a>{paper && <a href="#practice-paper">当前练习</a>}</nav>
    <div className="practice-workspace">
      <section className="practice-create panel" id="practice-create" aria-labelledby="practice-create-title">
        <div className="panel-heading"><div><span className="section-kicker">01 / SET THE SCOPE</span><h2 id="practice-create-title">生成一份单元练习</h2><p>先确认单元和知识点，让练习对应当前学习内容。</p></div><span className="heading-icon"><FileText size={22} /></span></div>
        {trialExpired && <p className="tool-notice">免费体验已到期，可继续查看、作答和下载历史练习。生成与批改需联系管理员开通。</p>}
        {aiUnavailable && <p className="tool-notice" role="status">{aiReady === null ? "正在确认 AI 服务状态…" : "AI 服务暂不可用，生成与批改暂时无法使用。"}</p>}
        <form onSubmit={event => { event.preventDefault(); void generate(); }}>
          <fieldset className="tool-fieldset" disabled={busy !== null}>
            <legend className="tool-fieldset-title">练习范围</legend>
            <div className="practice-form">
              <label>科目 <span className="tool-required">必填</span><input required value={subject} onChange={event => { setSubject(event.target.value); setSelectedPoints([]); setCustomPoint(""); }} list="practice-subjects" maxLength={30} placeholder="如：数学" /><datalist id="practice-subjects">{subjects.map(item => <option key={item} value={item} />)}</datalist></label>
              <label>单元名称 <span className="tool-required">必填</span><input required value={unitName} onChange={event => setUnitName(event.target.value)} maxLength={80} placeholder="如：一元一次方程" /></label>
              <label>年级（选填）<input value={gradeLevel} onChange={event => setGradeLevel(event.target.value)} maxLength={30} placeholder="如：七年级上册" /></label>
              <label>题目数量（1–30 道）<input type="number" required min={1} max={30} step={1} inputMode="numeric" value={countInput} aria-invalid={!validCount} onChange={event => { const next = event.target.value; if (next === "" || /^\d{1,2}$/.test(next)) { setCountInput(next); const parsed = Number(next); if (validPracticeCount(parsed)) setSelectedPoints(current => current.slice(0, Math.min(parsed, 4))); } }} /></label>
            </div>
            <section className="practice-focus" aria-labelledby="practice-focus-title"><div className="practice-focus-head"><strong id="practice-focus-title">本次重点（选填）</strong><span>已选 {selectedPoints.length}/{Math.min(validCount ? count : 0, 4)} 个</span></div><p className="tool-help">建议来自本科目的错误记录，请确认属于当前单元。不选则覆盖本单元主要知识点。</p>
              {suggestions.length > 0 && <div className="practice-suggestions">{suggestions.map(item => <button key={item.name} type="button" className={selectedPoints.includes(item.name) ? "selected" : ""} onClick={() => togglePoint(item.name)} aria-pressed={selectedPoints.includes(item.name)}>{item.name}<small>{item.hits} 次错误</small></button>)}</div>}
              <div className="practice-custom-point"><input value={customPoint} onChange={event => setCustomPoint(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCustomPoint(); } }} maxLength={100} placeholder="输入一个知识点" aria-label="自定义知识点" /><button type="button" onClick={addCustomPoint} disabled={!customPoint.trim()}><Plus size={15} />添加</button></div>
              {selectedPoints.length > 0 && <div className="practice-selected" aria-label="已确认知识点">{selectedPoints.map(point => <button type="button" key={point} onClick={() => togglePoint(point)} aria-label={`移除知识点：${point}`}>{point}<X size={14} /></button>)}</div>}
            </section>
            <div className="practice-blueprint" aria-label="本次出题结构"><strong>出题结构</strong>{validCount ? <div>{formatCounts.map(label => <span key={label}>{label}</span>)}</div> : <p className="tool-help">请填写 1 到 30 道题，查看出题结构。</p>}<small>题型随题量安排，覆盖基础、方法、易错辨析与应用；生成练习不会计为掌握记录。</small></div>
            <div className="tool-form-footer"><button type="submit" className="practice-primary" disabled={busy !== null || trialExpired || aiUnavailable || !validCount}>{busy === "generate" ? <><LoaderCircle size={17} className="spin" />正在生成练习…</> : <><Sparkles size={17} />生成练习卷</>}</button><span>生成后可在线作答或下载</span></div>
          </fieldset>
        </form>
        {busy === "generate" && <p className="tool-status" role="status"><LoaderCircle size={16} className="spin" />正在准备题目，请保留当前页面，完成后会自动显示练习卷。</p>}
        {validCount && count > 10 && <p className="tool-help">题量较大时会分批生成和批改，请等待结果返回。</p>}
      </section>
      <aside className="practice-history" id="practice-history" aria-labelledby="practice-history-title"><div className="section-heading"><div><span className="section-kicker">SAVED PAPERS</span><h2 id="practice-history-title">历史练习</h2></div><span>{papers.length} 份</span></div><p className="tool-help">继续作答、查看批改或下载试卷。</p>{papers.length ? <div className="practice-history-list">{[...papers].sort((a,b)=>Number(Boolean(a.gradedAt))-Number(Boolean(b.gradedAt))).map(item => <button type="button" key={item.id} className={paper?.id === item.id ? "active" : ""} aria-current={paper?.id === item.id ? "true" : undefined} onClick={() => openPaper(item.id)} disabled={busy !== null}><FileText size={19} /><span><strong>{item.subject} · {item.unitName}</strong><small>{new Date(item.createdAt).toLocaleDateString("zh-CN")} · {item.questionCount} 道题</small><small className="tool-history-state">{busy === item.id ? "正在打开…" : item.gradedAt ? `已批改 · 正确 ${item.correctCount} 道` : "待作答 / 待批改"}</small></span>{busy === item.id ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}</button>)}</div> : <div className="tool-empty"><FileText size={28} /><strong>还没有练习记录</strong><p>生成后的试卷会保存在这里，方便下次继续。</p></div>}</aside>
    </div>
    <section className="panel"><button type="button" onClick={()=>void loadReviews()}>查看订正与复习安排</button>{savedReviews.map(r=><article key={r.id}><small>作答轮次：{r.attempt_id}</small><label>当前状态<select value={r.state} onChange={e=>setSavedReviews(all=>all.map(item=>item.id===r.id?{...item,state:e.target.value}:item))}><option value="needs_correction">待订正</option><option value="needs_review">待复习</option><option value="reviewed">已复习</option></select></label><label>复习日期<input type="date" value={r.review_on?.slice(0,10)||''} onChange={e=>setSavedReviews(all=>all.map(item=>item.id===r.id?{...item,review_on:e.target.value||null}:item))}/></label><label>实际订正/复习证据<textarea maxLength={4000} value={r.evidence} onChange={e=>setSavedReviews(all=>all.map(item=>item.id===r.id?{...item,evidence:e.target.value}:item))}/></label><button type="button" disabled={!r.evidence.trim()} onClick={()=>void updateReview(r)}>保存状态与日期</button><details><summary>状态事件历史</summary>{reviewEvents.filter(e=>e.review_id===r.id).map(e=><p key={e.id}>{new Date(e.created_at).toLocaleString('zh-CN')} · {e.state} · {e.review_on?.slice(0,10)||'未设日期'} · {e.evidence}</p>)}</details></article>)}</section>
    {paper && source?.source==='original'&&<section className="panel"><h3>原题来源与原图核对</h3><p>来源错题：{source.source_id}。此轮只保存作答并列为待人工核对，不以文本 AI 猜测图形或缺失答案。</p>{source.upload_id&&source.page_number&&<><a href={`/api/uploads/${encodeURIComponent(source.upload_id)}/pages/${source.page_number}`} target="_blank" rel="noreferrer">打开清晰原图（可放大核对）</a>{/* Authenticated same-origin image; preserve the original page for figure questions. */}<img src={`/api/uploads/${encodeURIComponent(source.upload_id)}/pages/${source.page_number}`} alt="原题所在作业页，请对照题号核对" style={{maxWidth:'100%',height:'auto'}} /></>}<details><summary>原题区域坐标</summary><pre>{JSON.stringify(source.question_bounds)}</pre></details></section>}
    {paper && <section className="panel"><button type="button" disabled={busy!==null||!attemptId} onClick={()=>void saveServerDraft()}>保存服务器草稿</button><p role="status">{draftStatus}</p>
      <h3>作答轮次与真实证据</h3><p>每轮单独标记 AI、历史或未评分来源。生成、下载和一次正确不代表掌握。</p>
      {attempts.map(a=><details key={a.id} id={`attempt-${a.id}`} open={viewAttemptId===a.id?true:undefined}><summary>{a.completed_at?new Date(a.completed_at).toLocaleString('zh-CN'):'未完成'} · {a.status} · {a.source} · {a.grading_source||'未评分'}</summary>{a.answers.map((answer,i)=><p key={i}>第 {i+1} 题：{answer||'未作答'} · {a.grading[i]?.verdict||'未评分'} · {a.grading[i]?.comment}</p>)}{a.status==='failed'&&<p role="alert">{a.error}</p>}</details>)}
      {attempts.some(a=>a.status==='completed')&&<div><label>订正/复习证据<textarea value={evidence} maxLength={4000} onChange={e=>setEvidence(e.target.value)} /></label><label>状态<select value={reviewState} onChange={e=>setReviewState(e.target.value)}><option value="needs_correction">待订正</option><option value="needs_review">待复习</option><option value="reviewed">已复习（本次证据）</option></select></label><label>复习日期<input type="date" value={reviewOn} onChange={e=>setReviewOn(e.target.value)}/></label><button type="button" disabled={!evidence.trim()} onClick={()=>void saveReview()}>保存本轮证据与安排</button><button type="button" onClick={()=>void loadReviews()}>查看已保存复习证据</button></div>}
    </section>}
    {paper && <section className="practice-paper" id="practice-paper" tabIndex={-1} ref={paperRef} aria-label="在线练习卷" aria-busy={busy === "grade"}><div className="practice-paper-head"><div><span className="section-kicker">02 / {showGrading ? "REVIEW YOUR ANSWERS" : "YOUR TURN"}</span><h2>{paper.subject} · {paper.unitName}</h2><p>{paper.gradeLevel || "单元练习"} · {paper.questionCount} 道题 · {showGrading ? "已批改" : `已作答 ${answeredCount}/${paper.questions.length} 道`}</p></div><a className="practice-word" href={busy === null ? `/api/practice-papers/${encodeURIComponent(paper.id)}/word` : undefined} aria-disabled={busy !== null} tabIndex={busy !== null ? -1 : undefined}><Download size={16} />下载 Word 试卷</a></div>
      {!showGrading && <p className="tool-help">可先完成部分题目再批改。请用“保存服务器草稿”跨设备恢复；提交后每轮答案与评分分别保存。</p>}
      {showGrading && <div className="practice-score" role="status"><CheckCircle2 size={20} /><span>本次批改：正确 {paper.correctCount} 道，错误 {paper.incorrectCount} 道{paper.uncertainCount ? `，待核对 ${paper.uncertainCount} 道` : ""}。结果仅反映本次练习。</span><button type="button" onClick={() => { const blank = paper.questions.map(() => ""); setAnswers(blank); setRetaking(true); setAttemptId(crypto.randomUUID()); try { window.sessionStorage.setItem(draftKey(paper.id), JSON.stringify(blank)); } catch { /* Browser storage may be disabled. */ } }} disabled={busy !== null}><RotateCcw size={15} />重新作答</button></div>}
      {showGrading && paper.wrongKnowledgePoints.length > 0 && <div className="practice-next"><strong>回到知识点，找出原因</strong><div>{[...new Set(paper.wrongKnowledgePoints)].map(point => <button type="button" key={point} onClick={() => onReviewPoint(paper.subject, point)}>{point}<ArrowRight size={14} /></button>)}</div><p>查看概念与相关错题后，再用小测验证理解。</p></div>}
      <div className="practice-questions">{paper.questions.map((item, index) => {
        const gradeItem = showGrading ? paper.grading[index] : null;
        return <article className="practice-question" key={`${paper.id}-${index}`}>
          <div className="practice-question-title"><span>{String(index + 1).padStart(2, "0")}</span><div><small>{item.format ? `${practiceFormatLabels[item.format]} · ` : ""}{practiceKindLabels[kindForQuestion(item.kind)]} · {item.knowledgePoint}</small><h3><MathText value={item.question} /></h3></div></div>
          {item.format === "chart" && item.table && <div className="practice-table-wrap" role="region" aria-label={`第 ${index + 1} 题数据表，可横向滚动`} tabIndex={0}><table><thead><tr>{item.table.headers.map((cell, i) => <th scope="col" key={i}><MathText value={cell} /></th>)}</tr></thead><tbody>{item.table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><MathText value={cell} /></td>)}</tr>)}</tbody></table></div>}
          {item.format === "choice" && item.options?.length === 4 ? <fieldset className="practice-options" disabled={showGrading || busy !== null}><legend>第 {index + 1} 题：选择一个答案</legend>{item.options.map((option, optionIndex) => { const letter = "ABCD"[optionIndex]; return <label key={letter}><input type="radio" name={`practice-answer-${paper.id}-${index}`} checked={(answers[index] || "").toUpperCase() === letter} onChange={() => updateAnswer(index, letter)} /><strong>{letter}.</strong><MathText value={option} /></label>; })}</fieldset> : <><label htmlFor={`practice-answer-${paper.id}-${index}`}>第 {index + 1} 题：我的作答</label><textarea id={`practice-answer-${paper.id}-${index}`} value={answers[index] || ""} onChange={event => updateAnswer(index, event.target.value)} maxLength={2000} disabled={showGrading || busy !== null} placeholder={item.format === "fill" ? "填写空格中的答案" : "在这里写下答案或解题过程"} rows={item.format === "fill" ? 2 : 3} /></>}
          {gradeItem && <div className={`practice-feedback ${gradeItem.verdict}`}><strong>{gradeItem.verdict === "correct" ? "回答正确" : gradeItem.verdict === "incorrect" ? "需要订正" : "建议人工核对"}</strong><p><MathText value={gradeItem.comment} /></p><p><b>参考答案：</b><MathText value={gradeItem.answer} /></p><p><b>解析：</b><MathText value={gradeItem.explanation} /></p></div>}
        </article>;
      })}</div>
      {!showGrading && <div className="practice-submit"><div><strong>已作答 {answeredCount}/{paper.questions.length} 道</strong><p><Lightbulb size={16} />AI 逐题批改，答案与解析请结合课本和老师讲解核对。</p>{source?.source!=='original' && (trialExpired || aiUnavailable) && <p>{trialExpired ? "体验已到期，开通后可提交批改。" : aiReady === null ? "正在确认 AI 服务状态…" : "AI 服务暂不可用，暂时无法批改。"}</p>}</div><button type="button" className="practice-primary" onClick={grade} disabled={busy !== null || (source?.source!=='original' && (trialExpired || aiUnavailable)) || !answeredCount}>{busy === "grade" ? <><LoaderCircle size={17} className="spin" />正在批改…</> : <>{source?.source==='original'?'保存本轮作答（待人工核对）':'提交批改'} <ArrowRight size={16} /></>}</button></div>}
      {busy === "grade" && <p className="tool-status" role="status"><LoaderCircle size={16} className="spin" />正在逐题批改，请保留当前页面。</p>}
    </section>}
  </div>;
}
