"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, FileImage, Lightbulb, LoaderCircle, PenLine, Plus, Sparkles, X } from "lucide-react";
import type { EssayDetail, EssayExtraction, EssayFeedback, EssaySummary } from "@/lib/essay-types";
import "./study-tools.css";

type Photo = { file: File; preview: string };
type Props = { trialExpired: boolean; aiReady: boolean | null; ocrReady: boolean | null; onTrialExpired: () => void };

const tips = [
  "把作文题目和写作要求一起拍进去，点评才能核对是否切题。",
  "请先遮盖姓名、班级、学号和二维码等个人信息。",
  "最多上传 4 张图片；请让字迹清楚，尽量避开反光。",
  "识别后的原文可以修改；请先核对，再生成分析。",
  "润色建议是学习参考，先想想为什么这样改。",
];
const issueLabels = { spelling: "拼写", grammar: "语法", punctuation: "标点", expression: "表达" };

async function preparePhoto(file: File): Promise<File> {
  if (file.size < 2.5 * 1024 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url;
    });
    const scale = Math.min(1, 2200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function FeedbackCard({ number, title, item }: { number: string; title: string; item: EssayFeedback }) {
  return <article className="essay-feedback-card"><div className="essay-card-heading"><span>{number}</span><h3>{title}</h3></div><dl><dt>做得好的地方</dt><dd>{item.strength || "这部分需要结合原文继续观察。"}</dd><dt>原文依据</dt><dd>{item.evidence || "照片或原文没有足够清晰的依据。"}</dd><dt>下一步建议</dt><dd>{item.improvement || "继续练习并与老师核对。"}</dd></dl></article>;
}

function redirectIfUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  // Full navigation clears confirmed essay text held in memory after session expiry.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
  return true;
}

export default function EssayAnalysis({ trialExpired, aiReady, ocrReady, onTrialExpired }: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const allUrls = useRef<string[]>([]);
  const chooseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [promptText, setPromptText] = useState("");
  const [essayText, setEssayText] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const learningProfile=useRef<string|null>(null);
  const [draftRevision,setDraftRevision]=useState(0);
  const [savedStatus,setSavedStatus]=useState('');
  const [parentId,setParentId]=useState<string|undefined>();
  const [versionId,setVersionId]=useState('');
  const [versions,setVersions]=useState<Array<{id:string;parent_id:string|null;kind:string;prompt_text:string;original_text:string;grade_level:string;created_at:string;analysis_error:string|null;report_id:string|null}>>([]);
  async function learning(body?:unknown) {
    if(body&&!learningProfile.current)throw new Error('正在加载档案，请稍后再保存');
    const r=await fetch('/api/learning'+(body?'':'?kind=essay'),body?{method:'POST',headers:{'Content-Type':'application/json',...(learningProfile.current?{'X-Shiti-Profile':learningProfile.current}:{})},body:JSON.stringify(body)}:{headers:learningProfile.current?{'X-Shiti-Profile':learningProfile.current}:{}});
    const d=await r.json() as {profileId:string;error?:string;draft:{revision:number;payload:{promptText:string;essayText:string;gradeLevel:string;parentId?:string}}|null;versions:typeof versions};if(!r.ok)throw new Error(d.error||'学习记录加载失败');if(d.profileId)learningProfile.current=d.profileId;return d;
  }
  async function saveTextDraft() {
    try{const d=await learning({action:'draft',kind:'essay',sourceId:'current',revision:draftRevision,payload:{promptText,essayText,gradeLevel,parentId}});setDraftRevision(d.draft!.revision);setSavedStatus('文字草稿已保存；照片仅用于当次处理');}
    catch(e){setError(e instanceof Error?e.message:'草稿保存失败');}
  }
  async function loadTextHistory() {
    try{const d=await learning();setVersions(d.versions);setDraftRevision(d.draft?.revision||0);return d;}
    catch(e){setError(e instanceof Error?e.message:'版本加载失败');return null;}
  }
  async function restoreTextDraft() {
    const d=await loadTextHistory();if(!d?.draft)return;const v=d.draft.payload;
    setPromptText(v.promptText);setEssayText(v.essayText);setGradeLevel(v.gradeLevel);setParentId(v.parentId);setVersionId('');setDetail(null);
    setExtraction({promptText:v.promptText,essayText:v.essayText,uncertainNote:'已恢复文字草稿；照片未长期保存',teacherMarksNote:''});
  }
  async function saveStudentVersion() {
    try {const id=versionId||crypto.randomUUID();await learning({action:'version',id,parentId,promptText:promptText.trim(),originalText:essayText.trim(),gradeLevel:gradeLevel.trim()});setVersionId(id);setSavedStatus('学生文本版本已保存，后续编辑请另存版本');await loadTextHistory();}
    catch(e){setError(e instanceof Error?e.message:'版本保存失败');}
  }

  const [extraction, setExtraction] = useState<EssayExtraction | null>(null);
  const [detail, setDetail] = useState<EssayDetail | null>(null);
  const [history, setHistory] = useState<EssaySummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [busy, setBusy] = useState<"recognizing" | "analyzing" | "loading" | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  function rememberEssay(id:string|null) { const url=new URL(window.location.href);if(id)url.searchParams.set("essay",id);else url.searchParams.delete("essay");window.history.replaceState(null,"",url); }
  async function handleResponse(response: Response): Promise<Record<string, unknown> | null> {
    if (redirectIfUnauthorized(response)) return null;
    const data = await response.json() as Record<string, unknown>;
    if (data.code === "TRIAL_EXPIRED") onTrialExpired();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "操作失败，请重试");
    return data;
  }
  async function openHistory(id: string) {
    setBusy("loading"); setError("");
    try {
      const response = await fetch(`/api/essays/${encodeURIComponent(id)}`);
      const data = await handleResponse(response);
      if (!data) return;
      if (!data.essay || typeof data.essay !== "object") throw new Error("历史报告未返回，请重试。");
      rememberEssay((data.essay as EssayDetail).id); setDetail(data.essay as EssayDetail);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "报告加载失败，请重试"); }
    finally { setBusy(null); }
  }
  const restoreSavedDetail = useEffectEvent((id:string) => { void openHistory(id); });
  useEffect(() => {
    const restore=()=>{const id=new URLSearchParams(window.location.search).get("essay");if(id)restoreSavedDetail(id);};
    restore();window.addEventListener("popstate",restore);return()=>window.removeEventListener("popstate",restore);
  }, []);

  useEffect(()=>{
    const dirty=!detail&&(photos.length>0||Boolean(essayText.trim()));
    const leave=(event:Event)=>{if(busy || (dirty&&!window.confirm("离开前请保存服务器文字草稿；照片仅当次使用。确定离开吗？")))event.preventDefault();};
    const unload=(event:BeforeUnloadEvent)=>{if(dirty||busy){event.preventDefault();event.returnValue="";}};
    window.addEventListener("shiti-before-view-change",leave);window.addEventListener("beforeunload",unload);
    return()=>{window.removeEventListener("shiti-before-view-change",leave);window.removeEventListener("beforeunload",unload);};
  },[detail,photos.length,essayText,busy]);

  useEffect(() => {
    const target = detail ? reportRef.current : extraction ? confirmRef.current : null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }, [detail, extraction]);


  useEffect(() => {
    let mounted = true;
    fetch('/api/learning?kind=essay').then(async response=>{
      const d=await response.json() as {profileId:string;versions:typeof versions;draft:{revision:number}|null;error?:string};
      if(!response.ok)throw new Error(d.error||'作文版本加载失败');
      if(mounted){learningProfile.current=d.profileId;setVersions(d.versions);setDraftRevision(d.draft?.revision||0);}
    }).catch(e=>{if(mounted)setError(e instanceof Error?e.message:'版本加载失败');});
    fetch("/api/essays").then(async response => {
      if (redirectIfUnauthorized(response)) return null;
      if (!response.ok) throw new Error("作文记录加载失败，请刷新页面重试");
      return response.json() as Promise<{ essays: EssaySummary[] }>;
    }).then(data => { if (mounted && data) setHistory(data.essays); })
      .catch(cause => { if (mounted) setHistoryError(cause instanceof Error ? cause.message : "作文记录加载失败"); })
      .finally(() => { if (mounted) setLoadingHistory(false); });
    return () => { mounted = false; };
  }, [historyAttempt]);

  useEffect(() => () => { allUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setTipIndex(index => (index + 1) % tips.length), 5000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function addPhotos(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (incoming.some(file => !["image/jpeg", "image/png"].includes(file.type) || !file.size || file.size > 8 * 1024 * 1024)) {
      setError("仅支持 JPG、PNG，单张不超过 8 MB"); return;
    }
    if (photos.length + incoming.length > 4) { setError("一次最多上传 4 张图片"); return; }
    setError(""); setExtraction(null); setDetail(null);
    const next = incoming.map(file => ({ file, preview: URL.createObjectURL(file) }));
    allUrls.current.push(...next.map(item => item.preview));
    setPhotos(current => [...current, ...next]);
  }

  function removePhoto(preview: string) {
    setPhotos(current => current.filter(item => item.preview !== preview));
    setExtraction(null);
    setDetail(null);
    URL.revokeObjectURL(preview);
    allUrls.current = allUrls.current.filter(url => url !== preview);
  }

  function startNew() {
    rememberEssay(null); setParentId(undefined);setVersionId('');
    allUrls.current.forEach(url => URL.revokeObjectURL(url));
    allUrls.current = [];
    setPhotos([]); setPromptText(""); setEssayText(""); setGradeLevel("");
    setExtraction(null); setDetail(null); setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }



  async function photoForm(): Promise<FormData> {
    const form = new FormData();
    for (const photo of photos) form.append("files", await preparePhoto(photo.file));
    return form;
  }

  async function recognize() {
    if (!photos.length) { setError("请先上传作文照片"); return; }
    if (trialExpired || ocrReady !== true) return;
    setBusy("recognizing"); setTipIndex(0); setError("");
    try {
      const form = await photoForm();
      form.append("promptHint", promptText);
      const response = await fetch("/api/essays/extract", { method: "POST", body: form });
      const data = await handleResponse(response);
      if (!data) return;
      if (!data.extraction || typeof data.extraction !== "object") throw new Error("识别结果未返回，请重试。");
      const value = data.extraction as EssayExtraction;
      setExtraction(value);
      setEssayText(value.essayText);
      setPromptText(value.promptText || promptText);
      setDetail(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "作文识别失败，请重试"); }
    finally { setBusy(null); }
  }

  async function analyze() {
    if (!extraction) { setError("请先识别并核对原文"); return; }
    if (!promptText.trim() || essayText.trim().length < 10) { setError("请补全题目要求和至少 10 字的英语原文"); return; }
    if (trialExpired || aiReady === false) return;
    setBusy("analyzing"); setTipIndex(0); setError("");
    try {
      const form = await photoForm();
      const id=versionId||crypto.randomUUID();setVersionId(id);form.append('versionId',id);if(parentId)form.append('parentId',parentId);
      form.append("promptText", promptText.trim());
      form.append("confirmedText", essayText.trim());
      form.append("gradeLevel", gradeLevel.trim());
      const response = await fetch("/api/essays", { method: "POST", headers:learningProfile.current?{"X-Shiti-Profile":learningProfile.current}:{}, body: form });
      const data = await handleResponse(response);
      if (!data) return;
      if (!data.essay || typeof data.essay !== "object") throw new Error("分析报告未返回，请重试。");
      const essay = data.essay as EssayDetail;
      rememberEssay(essay.id); setDetail(essay); await loadTextHistory();
      setHistory(current => [{ id: essay.id, promptText: essay.promptText, excerpt: essay.excerpt, createdAt: essay.createdAt }, ...current]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "作文分析失败，请重试"); }
    finally { setBusy(null); }
  }



  return <div className="study-tools essay-page">
    <section className="page-intro essay-intro"><span className="section-kicker">ENGLISH WRITING</span><h1>英语作文分析</h1><p>上传照片、核对原文，再阅读有原文依据的写作建议。</p></section>
    <ol className="tool-steps" aria-label="作文分析步骤"><li aria-current={!extraction && !detail ? "step" : undefined}><span>01</span>上传照片</li><li aria-current={extraction && !detail ? "step" : undefined}><span>02</span>核对原文</li><li aria-current={detail ? "step" : undefined}><span>03</span>阅读报告</li></ol>
    {error && <div className="error-banner" role="alert" tabIndex={-1} ref={errorRef}><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="关闭错误提示"><X size={17} /></button></div>}
    {busy === "loading" && <p className="tool-status" role="status"><LoaderCircle className="spin" size={17} />正在打开历史报告…</p>}
    <section className="panel" aria-label="作文草稿与学生版本"><h2>文字草稿与学生版本</h2><button type="button" disabled={Boolean(busy)} onClick={()=>void restoreTextDraft()}>恢复服务器草稿</button><button type="button" disabled={Boolean(busy)||Boolean(detail)} onClick={()=>void saveTextDraft()}>保存文字草稿</button><button type="button" disabled={Boolean(busy)} onClick={()=>void loadTextHistory()}>查看学生版本</button><p role="status">{savedStatus}</p>
      {!detail&&extraction&&<><p>当前保存为：{parentId?'学生修改稿':'学生原稿'}。AI 润色仅供参考，不会写入学生原文。</p><button type="button" disabled={!essayText.trim()||!promptText.trim()||Boolean(busy)} onClick={()=>void saveStudentVersion()}>保存学生文本版本</button></>}
      {versions.map(v=><article key={v.id}><strong>{v.kind==='original'?'学生原稿':'学生修改稿'} · {new Date(v.created_at).toLocaleString('zh-CN')}</strong><p>{v.prompt_text}</p>{v.analysis_error&&<p role="alert">上次分析失败：{v.analysis_error}。文字版本已保留。</p>}<details><summary>查看此版原文</summary><p style={{whiteSpace:'pre-wrap'}}>{v.original_text}</p><small>版本 {v.id}{v.parent_id?` · 来源版本 ${v.parent_id}`:''}</small></details>{v.report_id&&<button type="button" onClick={()=>void openHistory(v.report_id!)}>查看此版本报告</button>}<button type="button" disabled={Boolean(busy)} onClick={()=>{setDetail(null);rememberEssay(null);setParentId(v.id);setVersionId('');setPromptText(v.prompt_text);setEssayText(v.original_text);setGradeLevel(v.grade_level);setPhotos([]);setExtraction({promptText:v.prompt_text,essayText:v.original_text,uncertainNote:'请用自己的话修改，另存为学生修改稿',teacherMarksNote:''});}}>基于此版本写学生修改稿</button></article>)}
    </section>
    {detail ? <div className="essay-report" ref={reportRef} tabIndex={-1} aria-label="作文学习报告">
      <div className="essay-report-top"><div className="essay-report-actions"><button type="button" className="essay-back" onClick={() => {rememberEssay(null);setDetail(null);}}><ArrowLeft size={16} />{extraction ? "返回当前草稿与历史" : "返回上传与历史"}</button><button type="button" className="essay-back" onClick={startNew}><Plus size={16} />分析新作文</button></div><span>{new Date(detail.createdAt).toLocaleDateString("zh-CN")}</span></div>
      <section className="essay-report-hero"><span className="section-kicker">WRITING REVIEW</span><h2>这篇作文的学习报告 <CheckCircle2 size={24} /></h2><p className="essay-report-prompt">{detail.promptText}</p><p>{detail.report.summary}</p><small>AI 建议仅供学习参考，字迹、语法和题意请结合原稿及老师意见核对。</small></section>
      <div className="essay-report-columns"><article className="essay-original"><h3>题目要求</h3><p>{detail.promptText}</p><h3>核对后的作文原文</h3><p lang="en">{detail.originalText}</p></article><section className="essay-feedback"><div className="essay-section-head"><span className="section-kicker">01 / OVERVIEW</span><h2>写作点评</h2></div><div className="essay-feedback-grid"><FeedbackCard number="01" title="内容" item={detail.report.content} /><FeedbackCard number="02" title="语言" item={detail.report.language} /><FeedbackCard number="03" title="结构" item={detail.report.structure} /><FeedbackCard number="04" title="书写" item={detail.report.handwriting} /></div>{!detail.report.handwriting.assessable && <p className="essay-caution">本次分析基于核对后的文字，未评估原稿书写。</p>}</section></div>
      <section className="essay-report-section"><div className="essay-section-head"><span className="section-kicker">02 / CORRECTIONS</span><h2>逐句批改</h2><p>仅列可以确认的问题；表达上的可选优化放在下一部分。</p></div>{detail.report.sentenceEdits.length ? <div className="essay-edit-list">{detail.report.sentenceEdits.map((item, index) => <article className="essay-edit" key={`${index}-${item.original}`}><div className="essay-edit-index">{String(index + 1).padStart(2, "0")}</div><div><span className="essay-issue">{issueLabels[item.issueType]}</span><p className="essay-before" lang="en">{item.original}</p><p className="essay-after" lang="en">{item.suggested}</p><p className="essay-reason">{item.explanation}</p></div></article>)}</div> : <p className="essay-empty">没有能够确认的逐句错误；可继续查看润色建议。</p>}</section>
      <section className="essay-report-section"><div className="essay-section-head"><span className="section-kicker">03 / POLISH</span><h2>个性化润色</h2><p>从你的原句出发，补充细节、衔接或更自然的表达。</p></div>{detail.report.polish.length ? <div className="essay-polish-grid">{detail.report.polish.map((item, index) => <article className="essay-polish" key={`${index}-${item.original}`}><span>建议 {String(index + 1).padStart(2, "0")}</span><div><small>原句</small><p lang="en">{item.original}</p></div><div><small>润色示例</small><p lang="en">{item.polished}</p></div><p className="essay-reason">{item.reason}</p></article>)}</div> : <p className="essay-empty">本次没有可靠的润色示例。</p>}</section>
      <section className="essay-report-section"><div className="essay-section-head"><span className="section-kicker">04 / EXPRESSIONS</span><h2>好词佳句参考</h2><p>用于学习开头、过渡和结尾，写作时请用自己的话表达。</p></div>{detail.report.references.length ? <div className="essay-reference-grid">{detail.report.references.map((item, index) => <article className="essay-reference" key={`${index}-${item.example}`}><span>{item.purpose}</span><p lang="en">{item.example}</p><small>{item.usage}</small></article>)}</div> : <p className="essay-empty">本次没有可靠的佳句参考，可结合课本积累适合题目的表达。</p>}</section>
      {detail.report.uncertaintyNote && <div className="essay-caution"><Lightbulb size={17} /><span>待核对：{detail.report.uncertaintyNote}</span></div>}
    </div> : <div className="essay-workspace">
      <section className="essay-form-panel" aria-busy={busy === "recognizing" || busy === "analyzing"}><div className="essay-section-head"><span className="section-kicker">01 / PHOTOS</span><h2>上传作文与题目</h2><p>先遮盖姓名、班级、学号和二维码。照片用于本次识别与分析，历史报告保存文字。</p></div>
        {trialExpired && <div className="essay-caution">免费体验已到期，可继续查看历史报告。需要新分析请联系管理员。</div>}
        {ocrReady !== true && <div className="essay-caution" role="status">照片识别服务暂不可用，请稍后重试。</div>}
        {aiReady !== true && <div className="essay-caution" role="status">{aiReady === null ? "正在确认 AI 服务状态…" : "作文分析服务暂不可用。"}</div>}
        <div className="essay-upload-actions"><button type="button" onClick={() => chooseRef.current?.click()} disabled={Boolean(busy) || trialExpired || photos.length >= 4}><Plus size={17} />选择图片</button><button type="button" onClick={() => cameraRef.current?.click()} disabled={Boolean(busy) || trialExpired || photos.length >= 4}><Camera size={17} />拍照上传</button><span aria-live="polite">已选 {photos.length}/4 张</span></div>
        {photos.length ? <div className="essay-photo-list">{photos.map((photo, index) => <div className="essay-photo" key={photo.preview}>{/* Local object URL preview; no remote image optimization is needed. */}<img src={photo.preview} alt={`作文照片 ${index + 1}`} /><span><FileImage size={14} />{photo.file.name}</span><button type="button" aria-label={`移除第 ${index + 1} 张照片`} onClick={() => removePhoto(photo.preview)} disabled={Boolean(busy)}><X size={16} /></button></div>)}</div> : <div className="essay-upload-empty"><PenLine size={29} /><strong>还没有作文照片</strong><span>支持 JPG、PNG · 最多 4 张 · 单张不超过 8 MB</span></div>}
        {!extraction && <label className="essay-field">题目要求（选填，可帮助识别）<textarea value={promptText} onChange={event => {setPromptText(event.target.value);setVersionId('');}} maxLength={2000} placeholder="例如：My Family，介绍家庭成员的外貌、性格和爱好。" rows={3} disabled={Boolean(busy)} /></label>}
        <div className="tool-recognize-action"><button type="button" className={extraction ? "essay-back" : "essay-primary"} onClick={recognize} disabled={Boolean(busy) || !photos.length || trialExpired || ocrReady !== true}>{busy === "recognizing" ? <><LoaderCircle className="spin" size={17} />正在识别原文…</> : <><Sparkles size={17} />{extraction ? "重新识别原文" : "识别作文原文"}<ArrowRight size={16} /></>}</button>{extraction && <small>重新识别会覆盖下面已编辑的原文，请谨慎操作。</small>}</div>
        {extraction && <div className="essay-confirm" ref={confirmRef} tabIndex={-1} aria-label="核对识别结果"><div className="essay-section-head"><span className="section-kicker">02 / CONFIRM</span><h2>核对识别结果</h2><p>对照原稿编辑下方文字，特别检查拼写、标点和 [看不清] 标记。核对后再生成分析。</p></div>
          {extraction.uncertainNote && <div className="essay-caution"><Lightbulb size={17} />{extraction.uncertainNote}</div>}
          {extraction.teacherMarksNote && <div className="essay-teacher-note">批注核对提示：{extraction.teacherMarksNote}</div>}
          <label className="essay-field">题目要求（必填）<textarea value={promptText} onChange={event => {setPromptText(event.target.value);setVersionId('');}} maxLength={2000} rows={3} required disabled={Boolean(busy)} placeholder="请补全题目与写作要求，分析会据此核对是否切题。" /></label>
          <label className="essay-field">我的作文原文（至少 10 字符）<textarea value={essayText} onChange={event => {setEssayText(event.target.value);setVersionId('');}} maxLength={10000} minLength={10} rows={12} lang="en" spellCheck={false} required disabled={Boolean(busy)} /></label><p className="tool-help">当前原文 {essayText.trim().length} 字符。请保留自己的表达，不必在分析前先改正错误。</p>
          <label className="essay-field">年级（选填）<input value={gradeLevel} onChange={event => {setGradeLevel(event.target.value);setVersionId('');}} maxLength={30} placeholder="例如：七年级" disabled={Boolean(busy)} /></label>
          <button type="button" className="essay-primary" onClick={analyze} disabled={Boolean(busy) || trialExpired || aiReady !== true || !promptText.trim() || essayText.trim().length < 10}>{busy === "analyzing" ? <><LoaderCircle className="spin" size={17} />正在生成报告…</> : <>原文已核对，生成分析 <ArrowRight size={16} /></>}</button>
        </div>}
        {(busy === "recognizing" || busy === "analyzing") && <div className="tool-notice essay-processing" role="status"><LoaderCircle className="spin" size={18} /><div><strong>{busy === "recognizing" ? "正在识别照片中的文字" : "正在分析已核对的作文"}</strong><p>请保留当前页面，完成后会自动显示结果。</p><p className="analysis-tip"><Lightbulb size={15} />{tips[tipIndex]}</p></div></div>}
      </section>
      <aside className="essay-history" aria-labelledby="essay-history-title"><div className="essay-section-head"><span className="section-kicker">YOUR WRITING</span><h2 id="essay-history-title">历史作文</h2><p>重读已保存的报告，回顾上次的修改建议。</p></div>{loadingHistory ? <p className="essay-empty" role="status"><LoaderCircle className="spin" size={17} />正在加载作文记录…</p> : historyError ? <div className="tool-notice tool-notice-error" role="alert"><span>{historyError}</span><button type="button" onClick={() => { setLoadingHistory(true); setHistoryError(""); setHistoryAttempt(value => value + 1); }} disabled={Boolean(busy)}>重新加载</button></div> : history.length ? <div className="essay-history-list">{history.map(item => <button type="button" key={item.id} onClick={() => openHistory(item.id)} disabled={Boolean(busy)}><strong>{item.promptText}</strong><span lang="en">{item.excerpt}</span><small>{new Date(item.createdAt).toLocaleDateString("zh-CN")}<span>查看报告 <ArrowRight size={14} /></span></small></button>)}</div> : <div className="tool-empty"><PenLine size={28} /><strong>还没有作文报告</strong><p>完成第一篇分析后，报告会保存在这里。</p></div>}</aside>
    </div>}
    <input ref={chooseRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={event => { addPhotos(event.target.files); event.target.value = ""; }} />
    <input ref={cameraRef} type="file" accept="image/jpeg,image/png" capture="environment" hidden onChange={event => { addPhotos(event.target.files); event.target.value = ""; }} />
  </div>;
}
