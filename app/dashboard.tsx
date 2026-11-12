"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { makeMistakesDocx, mistakesDocxFilename } from "@/lib/mistake-docx";
import { isTrialExpired, accessEndsAt } from "@/lib/trial";
import type { PracticeSummary } from "@/lib/practice-types";
import { beijingDate, isCalendarDate } from "@/lib/mistake-dates";
import { pastePrintOptions, worksheetPrintOptions, printOptionsParams, type MistakePrintOptions } from "@/lib/mistake-print-options";
import { ReflectionEditor, PrintSettings, usePrintWorkspaceDraft, type ReflectionActions, type ReflectionDraft } from "./mistake-printing";
import KnowledgeMap from "./knowledge-map";
import UnitPractice from "./unit-practice";
import EssayAnalysis from "./essay-analysis";
import MathText from "./math-text";
import UploadHistory from "./upload-history";
import UploadRecord from "./upload-record";
import ProfileSwitcher from "./profile-switcher";
import TodayTasks from "./today-tasks";
import {subjectNames} from "@/lib/question-types";
import type { UploadDetail } from "@/lib/upload-types";
import { ArrowRight, BookOpen, CalendarDays, Camera, CheckCircle2, ChevronDown, Clock3, CloudUpload, Crown, FileImage, Filter, Lightbulb, LoaderCircle, LogOut, Menu, Plus, FileDown, Search, Sparkles, Trash2, UploadCloud, X, Network, ClipboardList, PenLine } from "lucide-react";
import "./workspace.css";

type Similar = { question: string; answer: string; explanation: string };
type Mistake = {
  id: string; uploadId: string; subject: string; question: string; incorrectAnswer: string;
  correctAnswer: string; reasoning: string; knowledgePoint: string; pageNumber: number;
  sourceName: string; similarQuestions: Similar[]; createdAt: string;
  questionBounds?: number[];
  reflection?: string;
  archiveKind?: "mistake" | "collection"; judgementSource?: string;
};
type GradedQuestion = { pageNumber: number; questionLabel: string; verdict: "correct" | "incorrect" | "uncertain"; comment: string };
type Analysis = { uploadId?: string; subject: string; summary: string; uncertainNote: string; gradingMode: "marked" | "unmarked" | "mixed"; grading: GradedQuestion[]; mistakes: Mistake[] };
type SelectedFile = { file: File; preview: string; rotation: number };
type Tab = "home" | "notebook" | "results" | "knowledge" | "practice" | "essay" | "history";

const analysisTips = [
  "若有答题卷，请和试卷题目一起上传，方便核对每道题。",
  "一次最多上传 4 张 JPG、PNG 图片。",
  "拍照时让题目与作答都清晰入镜，尽量避开反光。",
  "请先遮盖姓名、学号等个人信息，再上传图片。",
  "认真对待每一道错题，你正在一点点进步。",
];

const subjectColors: Record<string, string> = { 数学: "lavender", 语文: "coral", 英语: "mint", 物理: "blue", 化学: "amber", 生物: "green", 历史: "sand", 地理: "teal", 政治: "rose" };
const formatDate = (date: string) => new Date(date).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" });

/**
 * 会话过期时接口返回 401，把用户送回登录页，而不是让他停在空页面上发呆。
 *
 * 这里必须整页跳转而不是 router.push：会话变了，客户端攒下的错题、筛选条件
 * 全都得丢掉重新从服务端取。
 */
function redirectIfUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
  return true;
}

async function shrinkImage(file: File): Promise<File> {
  if (file.type !== "image/webp" && file.size < 2.5 * 1024 * 1024) return file;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = objectUrl;
    });
    const scale = Math.min(1, 2200 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob || (file.type !== "image/webp" && blob.size >= file.size)) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(objectUrl); }
}

async function prepareUploadPhoto(item:SelectedFile):Promise<File>{
 if(!item.rotation)return shrinkImage(item.file);
 const url=URL.createObjectURL(item.file);
 try{const img=await new Promise<HTMLImageElement>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});
 const c=document.createElement('canvas');const quarter=item.rotation===90||item.rotation===270;c.width=quarter?img.naturalHeight:img.naturalWidth;c.height=quarter?img.naturalWidth:img.naturalHeight;
 const ctx=c.getContext('2d');if(!ctx)throw new Error('图片旋转失败');ctx.translate(c.width/2,c.height/2);ctx.rotate(item.rotation*Math.PI/180);ctx.drawImage(img,-img.naturalWidth/2,-img.naturalHeight/2);
 const b=await new Promise<Blob|null>(r=>c.toBlob(r,'image/jpeg',0.95));if(!b)throw new Error('图片转换失败');return shrinkImage(new File([b],item.file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}));
 }finally{URL.revokeObjectURL(url);}
}

function needsOriginalPicture(item: Mistake): boolean {
  return item.archiveKind === "collection" || item.judgementSource === "manual" || item.subject.includes("数学") || /(?:如|见|下|右|左).{0,4}[图表]|图(?:形|像|象|表|示)|统计图|坐标系|计算|求值|化简|解方程|作图/.test(item.question);
}

async function sourcePicture(item: Mistake): Promise<{ bytes: Uint8Array; width: number; height: number; fullPage: boolean }> {
  if (!item.uploadId) throw new Error("这道题缺少原图记录，无法保证导出的题目完整");
  const response = await fetch(`/api/uploads/${encodeURIComponent(item.uploadId)}/pages/${item.pageNumber}`, { cache: "no-store" });
  if (redirectIfUnauthorized(response)) throw new Error("登录已过期");
  if (!response.ok) throw new Error(`第 ${item.pageNumber} 页原图读取失败，暂不导出不完整的 Word`);
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("原图无法解码，暂不导出不完整的 Word"));
      candidate.src = objectUrl;
    });
    const bounds = item.questionBounds;
    const valid = Array.isArray(bounds) && bounds.length === 4 && bounds.every(value => Number.isInteger(value) && value >= 0 && value <= 1000) && bounds[0] < bounds[2] && bounds[1] < bounds[3];
    const [left, top, right, bottom] = valid ? [Math.max(0, bounds[0] - 12), Math.max(0, bounds[1] - 12), Math.min(1000, bounds[2] + 12), Math.min(1000, bounds[3] + 12)] : [0, 0, 1000, 1000];
    const sx = Math.floor(image.naturalWidth * left / 1000);
    const sy = Math.floor(image.naturalHeight * top / 1000);
    const sw = Math.max(1, Math.ceil(image.naturalWidth * (right - left) / 1000));
    const sh = Math.max(1, Math.ceil(image.naturalHeight * (bottom - top) / 1000));
    const scale = Math.min(1, 8192 / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理原题图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.95));
    if (!blob) throw new Error("原题图片转换失败");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, fullPage: !valid };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function SubjectPill({ subject }: { subject: string }) {
  return <span className={`subject-pill ${subjectColors[subject] || "sand"}`}>{subject}</span>;
}

function SimilarExercise({ item, index }: { item: Similar; index: number }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  return <div className="similar-item"><span className="similar-index">{String(index + 1).padStart(2, "0")}</span><div><strong><MathText value={item.question} /></strong><div className="reveal-actions"><button type="button" onClick={() => { setShowReasoning(!showReasoning); if (showReasoning) setShowAnswer(false); }} aria-expanded={showReasoning}>{showReasoning ? "收起思路" : "查看思路"}</button><button type="button" onClick={() => setShowAnswer(!showAnswer)} disabled={!showReasoning} aria-expanded={showAnswer} title={!showReasoning ? "请先查看思路" : undefined}>{showAnswer ? "收起答案" : "查看答案"}</button></div>{showReasoning && <p className="reveal-content"><b>思路：</b><MathText value={item.explanation} /></p>}{showAnswer && <p className="reveal-content answer"><b>答案：</b><MathText value={item.answer} /></p>}</div></div>;
}

function BatchToolbar({ items, allItems, selectedIds, count, onCountChange, onToggleAll, onClear, onGenerate, onExport, busy, progress, notice, trialExpired }: {
  items: Mistake[]; allItems: Mistake[]; selectedIds: string[]; count: string; onCountChange: (value: string) => void;
  onToggleAll: (items: Mistake[]) => void; onClear: () => void; onGenerate: (items: Mistake[], count: number) => void;
  onExport: (items: Mistake[]) => void; busy: boolean; progress: string; notice: string; trialExpired: boolean;
}) {
  const chosen = allItems.filter(item => selectedIds.includes(item.id));
  const visibleChosen = items.filter(item => selectedIds.includes(item.id));
  const allChosen = items.length > 0 && visibleChosen.length === items.length;
  return <div className="mistake-batch-toolbar" aria-label="批量处理错题">
    <label className="batch-select-all"><input type="checkbox" checked={allChosen} onChange={() => onToggleAll(items)} disabled={busy || !items.length} />选择当前列表</label>
    <strong>已选 {chosen.length} 道{chosen.length > visibleChosen.length ? `（当前列表 ${visibleChosen.length} 道）` : ""}</strong>
    <label className="batch-similar-count">每道生成 <input type="number" min="1" max="5" step="1" inputMode="numeric" value={count} onChange={event => { if (/^[1-5]?$/.test(event.target.value)) onCountChange(event.target.value); }} aria-label="每道错题生成类似题数量，1 到 5 道" /> 题</label>
    <button type="button" onClick={() => onGenerate(chosen, Number(count))} disabled={busy || trialExpired || chosen.length < 2 || chosen.length > 10 || !/^[1-5]$/.test(count)} title={chosen.length > 10 ? "批量生成每次最多选择 10 道错题" : trialExpired ? "体验已到期" : undefined}><Sparkles size={15} />批量举一反三</button>
    <button type="button" onClick={() => onExport(chosen)} disabled={busy || !chosen.length}><FileDown size={15} />整理与打印</button>
    {selectedIds.length > 0 && <button type="button" className="batch-clear" onClick={onClear} disabled={busy}>清空选择</button>}
    {(progress || notice) && <span className="batch-status" role="status">{progress || notice}</span>}
    {chosen.length > 10 && <small>批量举一反三每次最多选 10 道；合并 Word 不受此限制。</small>}
  </div>;
}

function MistakeCard({ item, onSimilar, onExport, onDelete, onSelect, selectedForBatch, batchBusy, busy, exportingWord, trialExpired, showDelete = false, compact = false, onViewPhoto, reflections }: {
  item: Mistake; onSimilar: (id: string, count: number) => void; onExport: (item: Mistake) => void; onDelete: (id: string) => void;
  onSelect: (id: string) => void; selectedForBatch: boolean; batchBusy: boolean; busy: boolean; exportingWord: boolean; trialExpired: boolean; showDelete?: boolean; compact?: boolean;
  onViewPhoto?: (url: string, title: string) => void;
  reflections: ReflectionActions;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [similarCount, setSimilarCount] = useState("3");
  const answersOpen = userExpanded !== null ? userExpanded : (item.similarQuestions.length > 0);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reflectionsRef = useRef(reflections);
  useEffect(() => { reflectionsRef.current = reflections; }, [reflections]);
  useEffect(() => {
    if (!compact || !detailsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = openButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (reflectionsRef.current.canClose(item.id)) setDetailsOpen(false); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') || [])];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [compact, detailsOpen, item.id]);
  return <article className={`question-card${compact ? " notebook-card" : ""}${detailsOpen ? " is-expanded" : ""}`}>
    <label className="mistake-select"><input type="checkbox" checked={selectedForBatch} onChange={() => onSelect(item.id)} disabled={batchBusy} />{selectedForBatch ? "已加入批量操作" : "选中这道错题"}</label>
    <div className="question-top">
      <div className="question-tags">
        <SubjectPill subject={item.subject} />{item.archiveKind&&<span className="subject-pill sand">{item.archiveKind==="collection"?"复习收藏":item.judgementSource==="manual"?"人工确认错题":"分析归档"}</span>}
        <span className="knowledge-tag">{item.knowledgePoint || "知识点待确认"}</span>
        {item.similarQuestions.length > 0 ? (
          <span className="mistake-status-pill mastered"><CheckCircle2 size={12} />练习已生成</span>
        ) : (
          <span className="mistake-status-pill pending"><Sparkles size={12} />待巩固</span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {item.uploadId && onViewPhoto && (
          <button
            type="button"
            className="mistake-photo-btn"
            onClick={(e) => {
              e.stopPropagation();
              onViewPhoto(`/api/uploads/${encodeURIComponent(item.uploadId)}/pages/${item.pageNumber}`, `${item.sourceName} · 第 ${item.pageNumber} 页原卷`);
            }}
            title="查看拍摄的原卷照片"
          >
            <FileImage size={13} />
            <span>原卷</span>
          </button>
        )}
        <span className="question-date"><CalendarDays size={14} />{formatDate(item.createdAt)}</span>
      </div>
    </div>
    <h3><MathText value={item.question} /></h3>
    {compact && <div className="notebook-card-preview"><span>正确答案</span><p><MathText value={item.correctAnswer} /></p></div>}
    {compact && <div className="notebook-card-bottom"><span className="notebook-card-source" title={`${item.sourceName} · 第 ${item.pageNumber} 页`}><FileImage size={14} />{item.sourceName} · 第 {item.pageNumber} 页</span><button ref={openButtonRef} type="button" className="notebook-card-expand" aria-haspopup="dialog" onClick={() => setDetailsOpen(true)}>查看详情<ChevronDown size={15} /></button></div>}
    {!compact && <div className="notebook-card-details">
      <div className="answer-grid"><div className="answer-box wrong"><span className="answer-label">我的答案</span><p><MathText value={item.incorrectAnswer || "图片中未能读清"} /></p></div><div className="answer-box correct"><span className="answer-label">正确答案</span><p><MathText value={item.correctAnswer} /></p></div></div>
      <div className="reasoning"><div className="reasoning-heading"><Lightbulb size={18} /><strong>解题思路</strong></div><p><MathText value={item.reasoning} /></p></div>
      <ReflectionEditor id={item.id} saved={item.reflection || ""} actions={reflections} />
      <div className="question-footer">{!compact && <span className="source-line"><FileImage size={14} />{item.sourceName} · 第 {item.pageNumber} 页</span>}<div className="question-actions"><button className="export-button" onClick={() => onExport(item)} disabled={exportingWord}>{exportingWord ? <LoaderCircle size={15} className="spin" /> : <FileDown size={15} />}{exportingWord ? "正在生成…" : "生成 Word"}</button>{showDelete && <button className="icon-action" title="移除这道错题" onClick={() => onDelete(item.id)}><Trash2 size={16} /></button>}<div className="similar-request"><label htmlFor={`similar-count-${item.id}`}>再给我出 <input id={`similar-count-${item.id}`} className="similar-count" type="number" min="1" max="5" step="1" inputMode="numeric" value={similarCount} onChange={event => { if (/^[1-5]?$/.test(event.target.value)) setSimilarCount(event.target.value); }} aria-label="类似题数量，1 到 5 道" /> 道类似题目</label><button className="similar-button" onClick={() => onSimilar(item.id, Number(similarCount))} disabled={trialExpired || batchBusy || busy || !/^[1-5]$/.test(similarCount)} title={trialExpired ? "试用已到期，请联系管理员开通" : undefined}>{busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{trialExpired ? "体验已到期" : "生成"}</button></div>{item.similarQuestions.length > 0 && <button className="similar-toggle" onClick={() => setUserExpanded(!answersOpen)} aria-expanded={answersOpen}>{answersOpen ? "收起" : "查看"}已生成的 {item.similarQuestions.length} 道题<ChevronDown size={15} className={answersOpen ? "turn" : ""} /></button>}</div></div>
      {item.similarQuestions.length > 0 && answersOpen && <div className="similar-list"><div className="similar-title"><Sparkles size={17} />举一反三 · {item.similarQuestions.length} 道练习</div>{item.similarQuestions.map((similar, index) => <SimilarExercise item={similar} index={index} key={index} />)}</div>}
    </div>}
    {compact && detailsOpen && createPortal(<div className="notebook-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && reflections.canClose(item.id)) setDetailsOpen(false); }}><div ref={dialogRef} className="notebook-detail-panel" role="dialog" aria-modal="true" aria-label="错题详情"><div className="notebook-detail-header"><strong>错题详情</strong><button ref={closeButtonRef} type="button" onClick={() => { if (reflections.canClose(item.id)) setDetailsOpen(false); }} aria-label="关闭错题详情"><X size={20} /></button></div><MistakeCard item={item} onSimilar={onSimilar} onExport={onExport} onDelete={id => { if (reflections.canClose(item.id)) { setDetailsOpen(false); onDelete(id); } }} onSelect={onSelect} selectedForBatch={selectedForBatch} batchBusy={batchBusy} busy={busy} exportingWord={exportingWord} trialExpired={trialExpired} showDelete={showDelete} onViewPhoto={onViewPhoto} reflections={reflections} /></div></div>, document.body)}
  </article>;
}

export default function Dashboard({ name, trialEndsAt: originalTrialEndsAt, paidEndsAt, role }: { name: string; trialEndsAt: string | null; paidEndsAt: string | null; role: "user" | "admin" }) {
  const [tab, setActiveTab] = useState<Tab>("home");
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [papers, setPapers] = useState<PracticeSummary[]>([]);
  const [profileId,setProfileId]=useState("");
  useEffect(()=>{const changed=(e:StorageEvent)=>{if(e.key==='shiti-profile-changed')window.location.reload();};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
  const [activeUploadId, setActiveUploadId] = useState("");
  const [record, setRecord] = useState<UploadDetail | null>(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState("");
  const [recordAttempt, setRecordAttempt] = useState(0);
  const loadedRecordId=useRef("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [uploadIntent,setUploadIntent]=useState('marked');
  const [uploadTitle,setUploadTitle]=useState('');
  const [uploadSubject,setUploadSubject]=useState('数学');
  const [uploadGrade,setUploadGrade]=useState('');
  const [uploadDate,setUploadDate]=useState(()=>beijingDate(new Date().toISOString()));
  const uploadRequestKey=useRef('');
  const [removedId,setRemovedId]=useState('');
  const [selectedMistakeIds, setSelectedMistakeIds] = useState<string[]>([]);
  const [batchCount, setBatchCount] = useState("2");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [batchNotice, setBatchNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);
  const trialEndsAt = accessEndsAt(originalTrialEndsAt, paidEndsAt);
  const [trialExpired, setTrialExpired] = useState(() => role !== "admin" && isTrialExpired(trialEndsAt));
  // 初值就是 true：挂载后必定拉一次错题本，等请求落地再置回 false
  const [loadingList, setLoadingList] = useState(true);
  const [ocrReady, setOcrReady] = useState<boolean | null>(null);
  const [storageReady, setStorageReady] = useState<boolean | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [busySimilar, setBusySimilar] = useState<string | null>(null);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportFile, setExportFile] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("全部科目");
  const [month, setMonth] = useState("");
  const [dates, setDates] = useState({ date: "", dateFrom: "", dateTo: "" });
  const [dateMode, setDateMode] = useState<"day" | "range">("day");
  const [dateInput, setDateInput] = useState("");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [dateError, setDateError] = useState("");
  const [listError, setListError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ReflectionDraft>>({});
  const [printIds, setPrintIds] = useState<string[] | null>(null);
  const [printOpen,setPrintOpen]=useState(false);
  const [printOptions, setPrintOptions] = useState<MistakePrintOptions>({ ...pastePrintOptions });
  const [printError, setPrintError] = useState("");
  const [printProgress, setPrintProgress] = useState("");
  const [savingPrintDrafts, setSavingPrintDrafts] = useState(false);
  const printOptionsChosen = useRef(false);
  const filterKey = useRef("");
  const serverDownload = useRef<HTMLIFrameElement | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [practiceSubject, setPracticeSubject] = useState("");
  const [practiceUnit, setPracticeUnit] = useState("");
  const [practicePoint, setPracticePoint] = useState("");
  const [knowledgeSubject, setKnowledgeSubject] = useState("");
  const [knowledgePoint, setKnowledgePoint] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadPanelRef = useRef<HTMLElement>(null);
  const uploadReviewRef = useRef<HTMLDivElement>(null);
  const urlReady = useRef(false);
  const previewUrls = useRef(new Set<string>());
  const lightboxRef = useRef<HTMLDivElement>(null);
  const lightboxCloseRef = useRef<HTMLButtonElement>(null);

  function setTab(next: Tab) {
    if (next !== tab && !discardBeforeLeaving()) return;
    setActiveTab(next);
    setMobileMenu(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "home") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      if (next !== "practice") url.searchParams.delete("paper");
      if (next !== "essay") url.searchParams.delete("essay");
      if (next === "results" && activeUploadId) url.searchParams.set("upload", activeUploadId);
      else url.searchParams.delete("upload");
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      setActiveTab(view === "notebook" || view === "knowledge" || view === "practice" || view === "essay" || view === "history" || view === "results" ? view : "home");
      setActiveUploadId(view === "results" ? params.get("upload") || "" : "");
      setQuery(params.get("q") || "");
      setSubject(params.get("subject") || "全部科目");
      const date = params.get("date") || "";
      const dateFrom = params.get("dateFrom") || "";
      const dateTo = params.get("dateTo") || "";
      const valid = date ? isCalendarDate(date) && !dateFrom && !dateTo : (!dateFrom && !dateTo) || (isCalendarDate(dateFrom) && isCalendarDate(dateTo) && dateFrom <= dateTo);
      const restored = valid ? { date, dateFrom, dateTo } : { date: "", dateFrom: "", dateTo: "" };
      setDates(restored); setDateInput(restored.date); setDateFromInput(restored.dateFrom); setDateToInput(restored.dateTo);
      setDateMode(restored.dateFrom ? "range" : "day");
      setDateError(valid ? "" : "链接中的日期无效，请重新选择日期范围。");
      setMonth(valid && (date || dateFrom) ? "" : params.get("month") || "");
      setMobileMenu(false);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!urlReady.current) { urlReady.current = true; return; }
    const url = new URL(window.location.href);
    for (const [key, value] of [["q", query], ["subject", subject === "全部科目" ? "" : subject], ["month", month], ["date", dates.date], ["dateFrom", dates.dateFrom], ["dateTo", dates.dateTo]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url);
  }, [query, subject, month, dates]);

  useEffect(() => {
    fetch("/api/status").then(r => r.json() as Promise<{ aiConfigured: boolean; ocrConfigured: boolean; storageConfigured: boolean }>).then(data => { setAiReady(Boolean(data.aiConfigured)); setOcrReady(Boolean(data.ocrConfigured)); setStorageReady(Boolean(data.storageConfigured)); }).catch(() => { setAiReady(false); setOcrReady(false); setStorageReady(false); });
    void loadMistakes();
    fetch("/api/profiles",{cache:"no-store"}).then(r=>r.json() as Promise<{currentProfileId:string}>).then(d=>setProfileId(d.currentProfileId)).catch(()=>{});
    fetch("/api/practice-papers").then(r => { if (redirectIfUnauthorized(r)) return null; if (!r.ok) throw new Error("练习卷列表加载失败"); return r.json() as Promise<{ papers?: PracticeSummary[] }>; }).then(data => { if (data && Array.isArray(data.papers)) setPapers(data.papers); }).catch(() => setError("练习卷列表加载失败，请刷新页面重试"));
  }, []);

  useEffect(() => {
    if (!activeUploadId) { loadedRecordId.current="";setRecord(null); setAnalysis(null); return; }
    const controller = new AbortController();
    if(loadedRecordId.current!==activeUploadId){setRecordLoading(true);setRecord(null);setAnalysis(null);loadedRecordId.current=activeUploadId;}setRecordError("");
    let timer: ReturnType<typeof setTimeout>;
    fetch(`/api/uploads/${encodeURIComponent(activeUploadId)}`, {cache:"no-store",signal:controller.signal}).then(async response => {
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as {upload?:UploadDetail;error?:string};
      if (!response.ok || !data.upload) throw new Error(data.error || "分析记录读取失败");
      const detail = data.upload;
      setRecord(detail);
      setAnalysis({uploadId:detail.id,subject:detail.subject,summary:detail.analysis?.summary || (detail.status==="processing"?"作业正在分析，可稍后从历史记录继续查看。":detail.status==="failed"?"处理尚未完成，原始资料已保留。":detail.questions.length?"识别内容已保存，请逐题核对确认。":"历史上传已找回，完整判题结果未保存。"),uncertainNote:detail.analysis?.uncertainNote || "",gradingMode:detail.analysis?.gradingMode || "unmarked",grading:detail.analysis?.grading || [],mistakes:detail.mistakes});
      if(detail.status==="processing"&&!detail.canRetry) timer=setTimeout(()=>setRecordAttempt(v=>v+1),5000);
    }).catch(cause=>{if(!controller.signal.aborted)setRecordError(cause instanceof Error?cause.message:"分析记录读取失败");}).finally(()=>{if(!controller.signal.aborted)setRecordLoading(false);});
    return ()=>{controller.abort();clearTimeout(timer);};
  },[activeUploadId,recordAttempt]);

  function openUpload(id:string) {
    if(!discardBeforeLeaving())return;
    setActiveUploadId(id);setActiveTab("results");setMobileMenu(false);
    const url=new URL(window.location.href);url.searchParams.set("view","results");url.searchParams.set("upload",id);window.history.pushState(null,"",url);window.scrollTo({top:0});
    setRecordAttempt(v=>v+1);
  }

  async function refreshCurrentUpload(){
    const r=await fetch(`/api/uploads/${encodeURIComponent(activeUploadId)}`,{cache:'no-store'});if(!r.ok)return;const d=await r.json() as {upload:UploadDetail};setRecord(d.upload);setAnalysis(a=>a?{...a,subject:d.upload.subject,mistakes:d.upload.mistakes}:a);void loadMistakes();setHistoryVersion(v=>v+1);
  }
  function movePhoto(index:number,offset:number){uploadRequestKey.current='';setSelected(v=>{const n=[...v];[n[index],n[index+offset]]=[n[index+offset],n[index]];return n;});}
  async function undoRemove(){const r=await fetch(`/api/mistakes/${encodeURIComponent(removedId)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:"restore"})});if(!r.ok){setError('撤销失败，请重试');return;}setRemovedId('');void loadMistakes();}
  async function retrySelectedOriginal(){
   if(selectedMistakeIds.length!==1){setError('请勾选一道题，再开始原题重做。');return;}
   const r=await fetch('/api/learning/retries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mistakeId:selectedMistakeIds[0],mode:'original'})});const d=await r.json() as {paper?:PracticeSummary;paperId?:string;error?:string};if(!r.ok||!d.paperId){setError(d.error||'创建练习失败');return;}if(d.paper)savePaperSummary(d.paper);setActiveTab('practice');const url=new URL(window.location.href);url.searchParams.set('view','practice');url.searchParams.set('paper',d.paperId);window.history.pushState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'));
  }
  function collectUploads(ids:string[]){const set=new Set(ids);const items=mistakes.filter(m=>set.has(m.uploadId));if(!items.length){setError('这些作业还没有已确认归档的题目，请先逐题归档。');return;}openPrintSettings(items);}

  async function retryUpload(kind: "recognize" | "analyze" = "analyze") {
    if(!activeUploadId||uploading)return;
    setUploading(true);setError("");
    try {
      const response=await fetch(`/api/uploads/${encodeURIComponent(activeUploadId)}/analyze`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind})});
      if(redirectIfUnauthorized(response))return;
      const data=await response.json() as {error?:string;code?:string};
      if(data.code==="TRIAL_EXPIRED")setTrialExpired(true);
      if(!response.ok)throw new Error(data.error||"分析未完成，请重试");
      void fetch(`/api/uploads/${encodeURIComponent(activeUploadId)}/run`,{method:"POST"}).finally(()=>setRecordAttempt(v=>v+1));
      await loadMistakes();
    }catch(cause){setError(cause instanceof Error?cause.message:"分析未完成");}
    finally{setUploading(false);setRecordAttempt(v=>v+1);setHistoryVersion(v=>v+1);}
  }

  useEffect(() => {
    const current = new Set(selected.map(item => item.preview));
    for (const url of previewUrls.current) if (!current.has(url)) URL.revokeObjectURL(url);
    previewUrls.current = current;
  }, [selected]);
  useEffect(() => () => { for (const url of previewUrls.current) URL.revokeObjectURL(url); }, []);
  useEffect(() => () => { if (exportFile) URL.revokeObjectURL(exportFile.url); }, [exportFile]);
  useEffect(() => () => { serverDownload.current?.remove(); }, []);
  useEffect(() => {
    if (!uploading) return;
    const timer = window.setInterval(() => setTipIndex(current => (current + 1) % analysisTips.length), 5000);
    return () => window.clearInterval(timer);
  }, [uploading]);
  useEffect(() => {
    const check = () => setTrialExpired(role !== "admin" && isTrialExpired(trialEndsAt));
    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [role, trialEndsAt]);
  useEffect(() => {
    if (!mobileMenu) return;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const sidebar = document.getElementById("learning-navigation");
    const controls = [...(sidebar?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') || [])];
    controls[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenu(false);
      if (event.key !== "Tab") return;
      const items = [...(sidebar?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') || [])];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [mobileMenu]);

  const subjects = useMemo(() => [...new Set(mistakes.map(item => item.subject))], [mistakes]);
  const filtered = useMemo(() => mistakes.filter(item => {
    const day = beijingDate(item.createdAt);
    return (subject === "全部科目" || item.subject === subject) && (!month || day.slice(0, 7) === month) && (!dates.date || day === dates.date) && (!dates.dateFrom || (day >= dates.dateFrom && day <= dates.dateTo)) && (!query || `${item.question} ${item.knowledgePoint} ${item.sourceName}`.toLowerCase().includes(query.toLowerCase()));
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.uploadId.localeCompare(b.uploadId) || a.pageNumber - b.pageNumber || a.id.localeCompare(b.id)), [mistakes, subject, month, dates, query]);
  const groups = useMemo(() => {
    const result: Record<string, Mistake[]> = {};
    for (const item of filtered) (result[beijingDate(item.createdAt)] ||= []).push(item);
    return Object.entries(result);
  }, [filtered]);
  const resultMistakes = analysis?.mistakes.map(item => mistakes.find(saved => saved.id === item.id) || item) || [];
  const printItems: Mistake[] = (printIds || []).map(id => mistakes.find(item => item.id === id)||{id,uploadId:'',subject:'不可访问',question:'该题已移出或不可访问，请从清单移除后继续',incorrectAnswer:'',correctAnswer:'',reasoning:'',knowledgePoint:'',pageNumber:1,sourceName:'',createdAt:'',similarQuestions:[]});
  const unsavedPrintItems = printItems.filter(item => drafts[item.id] && drafts[item.id].value !== (item.reflection || ""));
  const printDraft=usePrintWorkspaceDraft({profileId:profileId||undefined,items:printItems,options:printOptions,onItems:ids=>{setPrintIds(ids);setPrintOpen(true);},onOptions:setPrintOptions,reflections:Object.fromEntries(Object.entries(drafts).map(([id,d])=>[id,d.value])),onReflections:values=>setDrafts(current=>({...current,...Object.fromEntries(Object.entries(values).map(([id,value])=>[id,{value,saving:false,error:''}]))}))});


  useEffect(() => {
    const key = JSON.stringify([query, subject, month, dates]);
    if (filterKey.current && filterKey.current !== key) {
      if (selectedMistakeIds.length) setBatchNotice("筛选条件已更改，已清空原来的选题。");
      setSelectedMistakeIds([]);
    }
    filterKey.current = key;
  }, [query, subject, month, dates, selectedMistakeIds.length]);

  useEffect(() => {
    const dirty = Object.entries(drafts).some(([id, draft]) => draft.value !== (mistakes.find(item => item.id === id)?.reflection || ""));
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts, mistakes]);

  async function loadMistakes() {
    setLoadingList(true); setListError("");
    try {
      const response = await fetch("/api/mistakes", { cache: "no-store" });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as { mistakes?: Mistake[]; error?: string };
      if (!response.ok || !Array.isArray(data.mistakes)) throw new Error(data.error || "错题本加载失败");
      setMistakes(data.mistakes);
    } catch (cause) { setListError(cause instanceof Error ? cause.message : "错题本加载失败，请重试"); }
    finally { setLoadingList(false); }
  }

  function discardDraft(id: string) {
    setDrafts(current => { const next = { ...current }; delete next[id]; return next; });
  }

  function canCloseReflection(id: string) {
    const draft = drafts[id];
    if (draft?.saving) return false;
    const saved = mistakes.find(item => item.id === id)?.reflection || "";
    if (draft && draft.value !== saved) {
      if (!window.confirm("这道题的错因还没有保存。确定放弃更改并关闭吗？")) return false;
      discardDraft(id);
    }
    return true;
  }

  function discardBeforeLeaving() {
    if(document.querySelector('[data-unsaved-question="true"]')&&!window.confirm("题目草稿尚未保存到服务器，离开可能丢失这部分输入。是否离开？"))return false;
    const event = new Event("shiti-before-view-change", {cancelable:true});
    if (!window.dispatchEvent(event)) return false;
    if (Object.values(drafts).some(draft => draft.saving)) return false;
    if (!Object.entries(drafts).some(([id, draft]) => draft.value !== (mistakes.find(item => item.id === id)?.reflection || ""))) return true;
    if (!window.confirm("还有未保存的错因。确定放弃更改并离开吗？")) return false;
    setDrafts({}); return true;
  }

  async function saveReflection(id: string): Promise<boolean> {
    const draft = drafts[id];
    if (!draft || draft.saving) return !draft;
    const value = draft.value.trim();
    if (Array.from(value).length > 1000) { setDrafts(current => ({ ...current, [id]: { ...draft, error: "最多填写 1000 个字符" } })); return false; }
    setDrafts(current => ({ ...current, [id]: { ...draft, saving: true, error: "" } }));
    try {
      const response = await fetch(`/api/mistakes/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reflection: value }) });
      if (redirectIfUnauthorized(response)) return false;
      const data = await response.json() as { mistake?: Mistake; error?: string };
      if (!response.ok || !data.mistake) throw new Error(data.error || "错因保存失败，请重试");
      const saved = data.mistake;
      setMistakes(current => current.map(item => item.id === id ? saved : item));
      setAnalysis(current => current ? { ...current, mistakes: current.mistakes.map(item => item.id === id ? saved : item) } : current);
      discardDraft(id); return true;
    } catch (cause) { setDrafts(current => ({ ...current, [id]: { ...draft, saving: false, error: cause instanceof Error ? cause.message : "错因保存失败，请重试" } })); return false; }
  }

  const reflections: ReflectionActions = {
    drafts, change: (id, value) => setDrafts(current => ({ ...current, [id]: { value, saving: false, error: "" } })),
    save: saveReflection, discard: discardDraft, canClose: canCloseReflection,
  };

  function applyDates(today = false) {
    const date = today ? beijingDate(new Date()) : dateMode === "day" ? dateInput : "";
    const dateFrom = today || dateMode === "day" ? "" : dateFromInput;
    const dateTo = today || dateMode === "day" ? "" : dateToInput;
    if (date ? !isCalendarDate(date) : !isCalendarDate(dateFrom) || !isCalendarDate(dateTo) || dateFrom > dateTo) { setDateError("请检查日期范围"); return; }
    setDates({ date, dateFrom, dateTo }); setMonth(""); setDateError("");
    if (today) { setDateMode("day"); setDateInput(date); setTab("notebook"); }
  }

  function clearDates() { setDates({ date: "", dateFrom: "", dateTo: "" }); setDateInput(""); setDateFromInput(""); setDateToInput(""); setDateError(""); }

  function openPrintSettings(items: Mistake[], template: "worksheet" | "paste" = "paste") {
    if (!items.length || exportingWord) return;
    if (!printOptionsChosen.current) setPrintOptions({ ...(template === "paste" ? pastePrintOptions : worksheetPrintOptions) });
    setPrintOpen(true);setPrintIds(items.map(item => item.id)); setPrintError(""); setPrintProgress(""); setExportFile(null);
  }

  async function savePrintDrafts() {
    setSavingPrintDrafts(true);
    try { for (const item of unsavedPrintItems) if (!await saveReflection(item.id)) { setPrintError("部分错因未能保存，请返回题目检查后重试。"); return; } setPrintError(""); }
    finally { setSavingPrintDrafts(false); }
  }

  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null);
  useEffect(() => {
    if (!lightboxImage) return;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    lightboxCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopImmediatePropagation(); setLightboxImage(null); }
      if (event.key === "Tab") { event.preventDefault(); lightboxCloseRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [lightboxImage]);
  const practicedMistakesCount = useMemo(() => mistakes.filter(item => item.similarQuestions.length > 0).length, [mistakes]);
  const generatedRate = mistakes.length ? Math.round((practicedMistakesCount / mistakes.length) * 100) : 0;
  const pendingCount = useMemo(() => mistakes.filter(item => item.similarQuestions.length === 0).length, [mistakes]);
  const topSubjects = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of mistakes) {
      counts[m.subject] = (counts[m.subject] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [mistakes]);

  function scrollToUpload() {
    window.setTimeout(() => (uploadReviewRef.current || uploadPanelRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  }

  function addFiles(list: FileList | null) {
    if (!list || uploading) return;
    const incoming = Array.from(list).filter(file => ["image/jpeg", "image/png"].includes(file.type));
    if (incoming.length !== list.length) setError("只支持 JPG、PNG 图片"); else setError("");
    if (selected.length + incoming.length > 4) setError("一次最多上传 4 张图片");
    if (!incoming.length) return;
    uploadRequestKey.current='';
    setSelected(current => {
      const next = [...current, ...incoming.map(file => ({ file, preview: URL.createObjectURL(file), rotation: 0 }))];
      if (next.length > 4) next.slice(4).forEach(item => URL.revokeObjectURL(item.preview));
      return next.slice(0, 4);
    });
    setTab("home");
    scrollToUpload();
  }

  async function analyze() {
    if (!selected.length) { fileRef.current?.click(); return; }
    if (trialExpired) { setError("7 天免费体验已结束，请前往会员方案（¥99/月）开通使用权限。"); return; }
    if (ocrReady !== true || storageReady !== true) { setError("照片识别或云存储服务尚未配置，请稍后重试。"); return; }
    setTipIndex(0); setUploading(true); setError("");
    const requestProfile=profileId;if(!requestProfile){setUploading(false);setError("正在读取学习档案，请稍后上传");return;}
    try {
      const form = new FormData();
      for (const item of selected) { form.append("files", await prepareUploadPhoto(item));form.append("originalFiles",item.file); }
      form.set("rotations",JSON.stringify(selected.map(i=>i.rotation)));form.set("intent",uploadIntent);form.set("title",uploadTitle||selected.map(i=>i.file.name).join('、'));form.set("subject",uploadSubject);form.set("gradeLevel",uploadGrade);form.set("homeworkDate",uploadDate);
      uploadRequestKey.current ||= crypto.randomUUID();
      const response = await fetch("/api/analyze", { method: "POST", headers:{"Idempotency-Key":uploadRequestKey.current,"X-Shiti-Profile":requestProfile},body: form });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as {uploadId?:string;duplicateOf?:string;error?:string;code?:string};
      if (data.code === "TRIAL_EXPIRED") setTrialExpired(true);
      if (!response.ok) { setHistoryVersion(v=>v+1);throw new Error(data.error || "上传未完成，请用当前照片重试"); }
      setSelected([]);uploadRequestKey.current='';setSelectedMistakeIds([]);setHistoryVersion(v=>v+1);
      if(data.duplicateOf)setError('检测到此前上传过相同照片。本次独立保存，请核对是否需要重复整理。');
      if(data.uploadId){openUpload(data.uploadId);void fetch(`/api/uploads/${encodeURIComponent(data.uploadId)}/run`,{method:'POST'}).finally(()=>setRecordAttempt(v=>v+1));}
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "分析失败，请稍后重试"); }
    finally { setUploading(false); }
  }

  async function requestSimilar(id: string, count: number) {
    if (trialExpired) { setError("7 天免费体验已结束，请前往会员方案（¥99/月）开通使用权限。"); return; }
    setBusySimilar(id); setError("");
    try {
      await generateSimilarFor(id, count);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "生成失败，请重试"); }
    finally { setBusySimilar(null); }
  }

  async function generateSimilarFor(id: string, count: number): Promise<"ok" | "stopped"> {
    const response = await fetch(`/api/mistakes/${id}/similar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count }) });
    if (redirectIfUnauthorized(response)) return "stopped";
    const data = await response.json() as { questions?: Similar[]; error?: string; code?: string };
    if (data.code === "TRIAL_EXPIRED") { setTrialExpired(true); throw new Error(data.error || "免费体验已结束"); }
    if (!response.ok || !Array.isArray(data.questions)) throw new Error(data.error || "生成失败");
    const questions = data.questions;
    setMistakes(current => current.map(item => item.id === id ? { ...item, similarQuestions: questions } : item));
    setAnalysis(current => current ? { ...current, mistakes: current.mistakes.map(item => item.id === id ? { ...item, similarQuestions: questions } : item) } : current);
    return "ok";
  }

  async function generateSimilarBatch(items: Mistake[], count: number) {
    if (trialExpired || batchBusy || busySimilar || items.length < 2 || items.length > 10 || !Number.isInteger(count) || count < 1 || count > 5) return;
    setBatchBusy(true); setBatchNotice(""); setError("");
    let done = 0; let failed = 0; let firstFailure = "";
    for (const item of items) {
      setBusySimilar(item.id);
      setBatchProgress(`正在生成 ${done + failed + 1}/${items.length} 道错题的练习…`);
      try {
        const result = await generateSimilarFor(item.id, count);
        if (result === "stopped") break;
        done++;
      } catch (cause) {
        failed++;
        firstFailure ||= cause instanceof Error ? cause.message : "生成失败";
        if (trialExpired || firstFailure.includes("免费体验已结束")) break;
      }
    }
    setBusySimilar(null); setBatchBusy(false); setBatchProgress("");
    setBatchNotice(`已完成 ${done}/${items.length} 道错题的举一反三。`);
    if (failed) setError(`${failed} 道错题生成失败：${firstFailure}。已成功的练习会保留。`);
  }

  function toggleMistake(id: string) {
    setBatchNotice("");
    setSelectedMistakeIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }

  function toggleAllMistakes(items: Mistake[]) {
    setBatchNotice("");
    const ids = items.map(item => item.id);
    setSelectedMistakeIds(current => ids.every(id => current.includes(id)) ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  }

  async function removeMistake(id: string) {
    if (!window.confirm("确定移除这道错题吗？")) return;
    try {
      const response = await fetch(`/api/mistakes/${id}`, { method: "DELETE" });
      if (redirectIfUnauthorized(response)) return;
      if (!response.ok) throw new Error("移除失败，请重试");
      setRemovedId(id);setMistakes(current => current.filter(item => item.id !== id));
      setAnalysis(current => current ? { ...current, mistakes: current.mistakes.filter(item => item.id !== id) } : current);
      setSelectedMistakeIds(current => current.filter(item => item !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "移除失败"); }
  }

  async function exportMistakes(items: Mistake[], options?: MistakePrintOptions) {
    if (exportingWord || !items.length) return;
    if (items.some(item => drafts[item.id] && drafts[item.id].value !== (item.reflection || ""))) { setPrintError("请先保存或放弃未保存的错因。"); return; }
    setError(""); setPrintError(""); setPrintProgress(""); setExportFile(null);
    setExportingWord(true);
    try {
      const response = await fetch("/api/mistakes", { cache: "no-store" });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as { mistakes?: Mistake[]; error?: string };
      if (!response.ok || !Array.isArray(data.mistakes)) throw new Error(data.error || "读取最新错题失败，请重试");
      const current = new Map(data.mistakes.map(item => [item.id, item]));
      const latest = items.map(item => current.get(item.id));
      if (latest.some(item => !item)) { setMistakes(data.mistakes); throw new Error("部分题目已移出或无权访问，原清单已保留，请移除标记不可访问的条目后重试。"); }
      const fresh = latest as Mistake[];
      setMistakes(data.mistakes);
      const needsCrop = options?.template === "paste" && fresh.some(item => needsOriginalPicture(item) && item.questionBounds?.length === 4);
      if (!needsCrop && fresh.length <= 30 && fresh.every(item => !/\.webp$/i.test(item.sourceName))) {
        const params = options ? printOptionsParams(options) : new URLSearchParams();
        if (fresh.length > 1) fresh.forEach(item => params.append("id", item.id));
        const path = fresh.length === 1 ? `/api/mistakes/${encodeURIComponent(fresh[0].id)}/word` : "/api/mistakes/word";
        const url = `${path}${params.size ? `?${params}` : ""}`;
        const name = mistakesDocxFilename(fresh, options);
        setExportFile({ url, name });
        serverDownload.current?.remove();
        const frame = document.createElement("iframe");
        frame.hidden = true; frame.name = "mistake-word-download"; frame.title = "Word 文件下载";
        frame.onload = () => {
          try {
            if (frame.contentWindow?.location.href === "about:blank") return;
            const body = frame.contentDocument?.body.textContent || "";
            const failure = JSON.parse(body) as { error?: string };
            if (failure.error) { setPrintError(failure.error); setPrintProgress(""); }
          } catch { /* Attachment responses do not replace the download frame document. */ }
        };
        frame.onerror = () => { setPrintError("Word 下载失败，请重试下载链接。"); setPrintProgress(""); };
        frame.src = url; serverDownload.current = frame; document.body.appendChild(frame);
        setPrintProgress("已请求下载。若下载未开始，请点击下方链接重试；用 Word / WPS 打开后打印。");
        return;
      }
      const prepared = [];
      for (const [index, item] of fresh.entries()) {
        setPrintProgress(`正在准备第 ${index + 1}/${fresh.length} 道题…`);
        const visualQuestion = /(?:如|见|下|右|左).{0,4}[图表]|图(?:形|像|象|表|示)|统计图|坐标系|作图/.test(item.question);
        try { prepared.push({ ...item, visualQuestion, ...(needsOriginalPicture(item) ? { sourceImage: await sourcePicture(item) } : {}) }); }
        catch (cause) { throw new Error(`第 ${index + 1} 题：${cause instanceof Error ? cause.message : "原图读取失败"}`); }
      }
      const bytes = makeMistakesDocx(prepared, options);
      const blob = new Blob([bytes.buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const name = mistakesDocxFilename(fresh, options);
      link.href = url; link.download = name;
      setExportFile({ url, name });
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      setPrintProgress(`已生成 ${fresh.length} 道错题的 Word，可下载后打印。`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Word 文档生成失败，请重试。";
      setPrintError(message); setError(message); setPrintProgress("");
    } finally { setExportingWord(false); }
  }

  function exportMistake(item: Mistake) { openPrintSettings([item], "worksheet"); }

  async function signOut() {
    if (!discardBeforeLeaving()) return;
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // 请求失败也照常跳转：本地会话是无状态的，cookie 会随 30 天有效期自然过期
    }
    // 整页跳转，把内存里的错题和筛选条件一起清掉
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  function savePaperSummary(item: PracticeSummary) {
    setPapers(current => [item, ...current.filter(saved => saved.id !== item.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  function openPractice(subjectName = "", unitName = "", pointName = "") {
    setPracticeSubject(subjectName);
    setPracticeUnit(unitName);
    setPracticePoint(pointName);
    setTab("practice");
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const grading = analysis?.grading || [];
  const correctCount = grading.filter(item => item.verdict === "correct").length;
  const incorrectCount = grading.filter(item => item.verdict === "incorrect").length;
  const uncertainCount = grading.filter(item => item.verdict === "uncertain").length;
  return <><div className="app-shell">
    <aside id="learning-navigation" className={`sidebar ${mobileMenu ? "open" : ""}`} aria-label="学习导航">
      <div className="sidebar-brand-box">
        <button className="brand" onClick={() => { setTab("home"); setMobileMenu(false); }}>
          <span className="brand-mark">
            <BookOpen size={22} strokeWidth={2.4} />
          </span>
          <div className="brand-texts">
            <div className="brand-title-row">
              <strong>拾题</strong>
              <span className="brand-ai-badge">AI错题本</span>
            </div>
            <small>把每一次错误，变成进步</small>
          </div>
        </button>
      </div>

      <div className="sidebar-section-header">
        <span className="sidebar-section-label">我的学习</span>
      </div>
      <nav className="side-nav" aria-label="学习功能">
        {([{key:'home',label:'今日',Icon:Sparkles},{key:'history',label:'作业',Icon:Clock3},{key:'notebook',label:'错题本',Icon:BookOpen},{key:'practice',label:'练习与复习',Icon:ClipboardList},{key:'essay',label:'作文',Icon:PenLine}] as const).map(({key,label,Icon})=><button key={key} className={tab===key||key==='history'&&tab==='results'||key==='practice'&&tab==='knowledge'?'active':''} onClick={()=>key==='practice'?openPractice():setTab(key)}><span className="nav-item-left"><span className="nav-icon-box violet"><Icon size={16}/></span><span className="nav-label">{label}</span></span><ArrowRight size={14}/></button>)}
      </nav>

      <div className="sidebar-section-header">
        <span className="sidebar-section-label">学科分类</span>
        {subject !== "全部科目" && (
          <button className="sidebar-reset-subject" onClick={() => { setSubject("全部科目"); setQuery(""); setMonth(""); setTab("notebook"); }}>
            全部
          </button>
        )}
      </div>
      <div className="subject-chip-grid">
        {(subjects.length ? subjects : ["数学", "语文", "英语", "物理", "化学", "生物"]).slice(0, 6).map((item) => {
          const count = mistakes.filter(m => m.subject === item).length;
          const isSelected = subject === item && tab === "notebook";
          return (
            <button
              key={item}
              type="button"
              className={`subject-chip ${isSelected ? "selected" : ""}`}
              onClick={() => { setSubject(item); setQuery(""); setMonth(""); setTab("notebook"); }}
            >
              <span className={`subject-chip-dot ${subjectColors[item] || "sand"}`} />
              <span className="subject-chip-name">{item}</span>
              {count > 0 && <span className="subject-chip-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <a href="/pricing" className="sidebar-vip-card" onClick={() => setMobileMenu(false)}>
        <div className="vip-card-header">
          <span className="vip-crown-icon"><Crown size={14} /></span>
          <span className="vip-badge-tag">VIP 会员畅学</span>
        </div>
        <strong>¥99/月 · 畅学全学科</strong>
        <p>AI 智能批改 · 举一反三变式练习</p>
        <div className="vip-card-cta">
          <span>立即开通</span>
          <ArrowRight size={13} />
        </div>
      </a>

      <div className="sidebar-profile-card">
        <div className="profile-avatar-wrap">
          <span className="avatar">{name.slice(0, 1)}</span>
          <span className="profile-online-dot" />
        </div>
        <div className="profile-info">
          <strong>{name}</strong>
          <small>中学生智能学习空间</small>
        </div>
        <button className="logout-button" onClick={signOut} title="退出登录" aria-label="退出登录">
          <LogOut size={16} />
        </button>
      </div>
    </aside>

    {mobileMenu && <button type="button" className="mobile-menu-backdrop" onClick={() => setMobileMenu(false)} aria-label="关闭菜单并返回原页面" />}

    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileMenu(!mobileMenu)} aria-label={mobileMenu ? "关闭菜单" : "打开菜单"} aria-expanded={mobileMenu} aria-controls="learning-navigation"><Menu size={22} /></button>
        <div className="breadcrumb">学习空间 <span>/</span> <strong>{tab === "home" ? "今日" : tab === "results" ? "作业详情" : tab === "knowledge" ? "知识点回顾" : tab === "practice" ? "练习与复习" : tab === "essay" ? "作文" : tab === "history" ? "作业" : "错题本"}</strong></div>
        <div className="top-right"><ProfileSwitcher beforeSwitch={()=>discardBeforeLeaving()}/>
          <button
            type="button"
            className="topbar-quick-snap"
            onClick={() => { setTab("home"); cameraRef.current?.click(); }}
            title="拍摄作业或试卷"
          >
            <Camera size={14} />
            <span>拍错题</span>
          </button>
          <span className="today"><CalendarDays size={16} />{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}</span>
          <span className="small-avatar" title={`当前登录：${name}`}>{name.slice(0, 1)}</span>
        </div>
      </header>

      {/* 移动端/H5 专用自适应悬浮底部 TabBar */}
      <nav className="mobile-tabbar" aria-label="移动端主导航">
        {([{ key: "home", label: "今日", Icon: Sparkles }, { key: "history", label: "作业", Icon: Clock3 }, { key: "notebook", label: "错题本", Icon: BookOpen }, { key: "practice", label: "练习与复习", Icon: ClipboardList }, { key: "essay", label: "作文", Icon: PenLine }] as const).map(({ key, label, Icon }) => <button key={key} type="button" className={`tabbar-item ${tab === key || key==='history'&&tab==='results'||key==='practice'&&tab==='knowledge' ? "active" : ""}`} aria-current={tab === key ? "page" : undefined} onClick={() => key === "practice" ? openPractice() : setTab(key)}><Icon size={20} /><span>{label}</span></button>)}
      </nav>
      <div className="content-wrap">
        {trialEndsAt && role !== "admin" && <div className={`trial-banner ${trialExpired ? "expired" : ""}`} role="status"><Sparkles size={18} /><span suppressHydrationWarning>{trialExpired ? "体验或会员已到期。已有错题仍可查看；继续分析或生成练习可开通 VIP（¥99／30天）。" : `${paidEndsAt && !isTrialExpired(paidEndsAt) ? "会员有效期至：" : "免费体验截止时间："}${new Date(trialEndsAt).toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}。`}</span><a href="/pricing" className="trial-upgrade-btn">{trialExpired ? "立即开通 VIP" : "会员方案"}</a></div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭提示"><X size={17} /></button></div>}
        {printDraft.pending&&<div className="notice-card" role="status">发现可恢复的打印清单。<button onClick={printDraft.restore}>恢复上次整理</button><button onClick={printDraft.keepCurrent}>保留当前选择</button></div>}
        {removedId&&<div className="notice-card" role="status">已移出错题本，原始作业与错因仍保留。<button onClick={()=>void undoRemove()}>撤销移出</button></div>}
        {exportFile && <div className="notice-card" role="status"><span>Word 文档已生成，可在下载列表打开后编辑、打印。</span><a className="word-download-link" href={exportFile.url} download={exportFile.name}>再次下载 Word</a><button className="icon-action" onClick={() => setExportFile(null)} aria-label="关闭下载提示"><X size={17} /></button></div>}
        {tab === "home" && <>
          <TodayTasks refreshKey={historyVersion} onOpen={openUpload} onPractice={()=>openPractice()}/>
          <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR LEARNING DESK</div><h1>你好，{name}<span className="wave">✳</span></h1><p>把今天不懂的题，变成明天会做的题。</p></div><span className="welcome-date"><Clock3 size={16} />今天也在认真进步</span></section>
          <section className="desk-overview" aria-label="开始学习"><div><span className="section-kicker">从一道错题，开始一次进步</span><h2>拍下来，理清楚，再练一次。</h2><p>先上传作业，查看逐题解析；再到错题本整理和练习。</p></div><div className="desk-overview-steps"><span><Camera size={17} />上传作业</span><ArrowRight size={14} /><span><BookOpen size={17} />整理错题</span><ArrowRight size={14} /><span><ClipboardList size={17} />针对练习</span></div></section>
          <div className="dashboard-grid"><section className="panel upload-panel" ref={uploadPanelRef}>
            <div className="panel-heading"><div><span className="section-kicker">01 / UPLOAD</span><h2>上传你的题目</h2><p>试卷、练习册、课作本，拍一张就能开始整理。</p></div><span className="heading-icon"><CloudUpload size={24} /></span></div>
            <fieldset className="upload-metadata"><legend>这次要做什么？</legend><label>目的<select value={uploadIntent} onChange={e=>setUploadIntent(e.target.value)}><option value="marked">整理已批改作业</option><option value="check">检查未批改作业</option><option value="collect">收集不会做 / 复习题</option></select></label><label>作业名称<input value={uploadTitle} maxLength={200} onChange={e=>setUploadTitle(e.target.value)} placeholder="可选，默认使用照片名称"/></label><label>学科<select value={uploadSubject} onChange={e=>setUploadSubject(e.target.value)}>{subjectNames.map(s=><option key={s}>{s}</option>)}</select></label><label>年级<input value={uploadGrade} maxLength={60} onChange={e=>setUploadGrade(e.target.value)}/></label><label>作业日期<input type="date" value={uploadDate} onChange={e=>setUploadDate(e.target.value)}/></label></fieldset>
            <button type="button" className="upload-zone" disabled={uploading} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }} onClick={() => fileRef.current?.click()}><span className="upload-illustration"><UploadCloud size={31} /></span><strong>点击上传，或将图片拖到这里</strong><span>支持 JPG、PNG · 最多 4 张</span><span className="upload-select">选择图片 <Plus size={16} /></span></button>
            <div className="upload-actions"><button disabled={uploading} onClick={() => cameraRef.current?.click()}><Camera size={17} />拍照上传</button><span>照片由百度 OCR 识别并存入私有云存储，请先遮盖姓名等个人信息</span></div>
            {selected.length > 0 && <div className="file-list" ref={uploadReviewRef}><div className="upload-ready" role="status"><CheckCircle2 size={17} />已添加 {selected.length} 张照片。可继续添加，或检查后点击下方“保存并识别，进入核对”。</div>
              {selected.map((item, index) => <div className="selected-file" key={item.preview}><img src={item.preview} style={{transform:`rotate(${item.rotation}deg)`}} alt={`待上传第 ${index + 1} 张`} /><div><strong>第 {index+1} 页 · {item.file.name}</strong><small>{(item.file.size / 1024 / 1024).toFixed(1)} MB</small><button disabled={uploading||index===0} onClick={()=>movePhoto(index,-1)}>上移</button><button disabled={uploading||index===selected.length-1} onClick={()=>movePhoto(index,1)}>下移</button><button disabled={uploading} onClick={()=>{uploadRequestKey.current='';setSelected(v=>v.map((p,i)=>i===index?{...p,rotation:(p.rotation+90)%360}:p));}}>旋转90°</button></div><button disabled={uploading} aria-label={`移除第 ${index + 1} 张图片`} onClick={() => {uploadRequestKey.current='';setSelected(current => current.filter(file => file !== item));}}><X size={17} /></button></div>)}
              <button className="analyze-button" onClick={analyze} disabled={uploading || trialExpired}>{uploading ? <><LoaderCircle className="spin" size={18} />正在保存照片...</> : trialExpired ? <>体验已到期，暂不能分析</> : <><Sparkles size={18} />保存并识别，进入核对 <ArrowRight size={17} /></>}</button>
              {uploading && <div className="analysis-progress" role="status" aria-live="polite">
                <div className="analysis-progress-track" role="progressbar" aria-label="正在批改和分析作业"><span /></div>
                <p className="analysis-tip"><Lightbulb size={15} aria-hidden="true" /><span>{analysisTips[tipIndex]}</span></p>
              </div>}
            </div>}
            {(aiReady === false || ocrReady === false || storageReady === false) && <p className="service-note">照片识别、云存储或分析服务待配置，暂时无法处理新照片。</p>}
          </section>
          <section className="panel process-panel"><div className="panel-heading"><div><span className="section-kicker">HOW IT WORKS</span><h2>从拍照到掌握</h2><p>只需简单三步，理清每一次失误。</p></div></div><div className="steps"><div className="step"><span className="step-number">01</span><div><strong>上传图片</strong><p>拍摄已批改或未批改作业，清晰显示题目和作答。</p></div><span className="step-icon lavender"><Camera size={20} /></span></div><div className="step"><span className="step-number">02</span><div><strong>逐题批改</strong><p>依据识别文字分析；信息不足的题目保留待核对。</p></div><span className="step-icon coral"><Lightbulb size={20} /></span></div><div className="step"><span className="step-number">03</span><div><strong>归档巩固</strong><p>按科目、时间保存，按需练习 1–5 道类似题。</p></div><span className="step-icon mint"><BookOpen size={20} /></span></div></div><div className="process-footer"><CheckCircle2 size={17} />错题仅对登录的你可见</div></section></div>

          {/* 学习成长追踪与薄弱学科分布看板 */}
          <section className="study-tracker-card" aria-label="错题与练习概况" aria-busy={loadingList}>
            <div className="tracker-left">
              <div className="tracker-badge-row">
                <span className="tracker-indicator-badge">
                  <Sparkles size={13} /> 我的学习记录
                </span>
                <span className="tracker-efficiency-tag">练习覆盖 {generatedRate}%</span>
              </div>
              <h3>错题与练习概况</h3>
              <p>{loadingList ? "正在读取你的学习记录…" : `已归档 ${mistakes.length} 道题目，其中 ${practicedMistakesCount} 道已生成类似题。生成练习不代表已经掌握。`}</p>
              <div className="tracker-stats-grid">
                <div className="tracker-stat-box">
                  <span>已归档题目</span>
                  <strong>{mistakes.length}</strong>
                </div>
                <div className="tracker-stat-box">
                  <span>已生成类似题</span>
                  <strong>{practicedMistakesCount}</strong>
                </div>
                <div className="tracker-stat-box">
                  <span>生成练习卷</span>
                  <strong>{papers.length}</strong>
                </div>
              </div>
            </div>
            <div className="tracker-right">
              <div className="tracker-right-head">
                <span>学科错题分布（按高频度排序）</span>
                <button
                  type="button"
                  style={{ background: "none", border: 0, color: "#4f46e5", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                  onClick={() => setTab("notebook")}
                >
                  去错题本攻克 →
                </button>
              </div>
              <div className="tracker-bars-list">
                {topSubjects.length ? topSubjects.map(([subName, count]) => {
                  const pct = mistakes.length ? Math.round((count / mistakes.length) * 100) : 0;
                  return (
                    <button
                      type="button"
                      key={subName}
                      className="tracker-bar-item"
                      onClick={() => { setSubject(subName); setQuery(""); setMonth(""); setTab("notebook"); }}
                      aria-label={`查看${subName}的 ${count} 道错题`}
                    >
                      <span className="tracker-bar-name">{subName}</span>
                      <span className="tracker-bar-track">
                        <span className="tracker-bar-fill" style={{ display: "block", width: `${pct}%` }} />
                      </span>
                      <span className="tracker-bar-count">{count}道</span>
                    </button>
                  );
                }) : (
                  <div style={{ color: "#94a3b8", fontSize: 12, padding: "12px 0" }}>暂无错题分布数据，上传试卷后自动生成</div>
                )}
              </div>
            </div>
          </section>

          {/* 根据真实生成记录提供下一步入口 */}
          {pendingCount > 0 && (
            <div className="study-recommend-banner">
              <div className="recommend-left">
                <div className="recommend-icon-box">
                  <Lightbulb size={20} />
                </div>
                <div className="recommend-texts">
                  <h4>下一步：给错题配上练习</h4>
                  <p>还有 <strong>{pendingCount}</strong> 道错题未生成类似题。先看懂解析，再尝试同一知识点的题目。</p>
                </div>
              </div>
              <button
                type="button"
                className="recommend-cta"
                onClick={() => {
                  const unpracticed = mistakes.find(m => m.similarQuestions.length === 0);
                  if (unpracticed) {
                    setSubject(unpracticed.subject);
                    setQuery(unpracticed.question.slice(0, 12));
                    setMonth("");
                  }
                  setTab("notebook");
                }}
              >
                <span>查看待练习错题</span>
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          <section className="feature-links" aria-label="学习工具"><button type="button" onClick={() => setTab("knowledge")}><span className="feature-link-icon"><Network size={20} /></span><span><strong>查看知识图谱</strong><small>找出重复出错的知识点</small></span><ArrowRight size={17} /></button><button type="button" onClick={() => openPractice()}><span className="feature-link-icon peach"><ClipboardList size={20} /></span><span><strong>生成单元练习卷</strong><small>在线作答、批改并下载 Word</small></span><ArrowRight size={17} /></button><button type="button" onClick={() => setTab("essay")}><span className="feature-link-icon mint"><PenLine size={20} /></span><span><strong>分析英语作文</strong><small>照片识别、逐句批改与润色</small></span><ArrowRight size={17} /></button></section>
          <div className="daily-actions"><button type="button" onClick={() => applyDates(true)}><CalendarDays size={16} />整理今日错题</button></div>
          <UploadHistory compact refreshKey={historyVersion} onOpen={openUpload} onAll={()=>setTab("history")}/>

        </>}
        {tab === "history" && <UploadHistory refreshKey={historyVersion} onOpen={openUpload} onAll={()=>setTab("history")} onCollect={collectUploads}/>}
        {tab === "results" && <div className="daily-actions"><button onClick={()=>setTab("history")}>返回分析记录</button><button onClick={()=>{setTab("home");scrollToUpload();}}>上传新作业</button></div>}
        {tab === "results" && (recordLoading || !record && recordError || !activeUploadId) && <div className="empty-state" role={recordError?"alert":"status"}>{recordLoading?<><LoaderCircle className="spin"/>正在加载已保存的分析…</>:recordError?<><p>{recordError}</p><button onClick={()=>setRecordAttempt(v=>v+1)}>重新加载</button></>:<><p>请选择一条分析记录。</p><button onClick={()=>setTab("history")}>查看分析记录</button></>}</div>}
        {tab === "results" && recordError && record && <div className="notice-card" role="alert">刷新失败：{recordError}。当前编辑仍保留。<button onClick={()=>setRecordAttempt(v=>v+1)}>重试刷新</button></div>}
        {tab === "results" && !recordLoading && analysis && record && <>
          <section className="page-intro"><span className="section-kicker">SAVED HOMEWORK</span><h1>{record.hasAnalysis ? uncertainCount>0?"分析已保存 · 有题目待核对":"分析已保存" :record.status==="processing"?"正在分析":record.status==="failed"?"处理未完成":record.questions.length?"识别已保存 · 请核对确认":"历史作业记录"}</h1><p><MathText value={analysis.summary || "已完成图片分析。"} /></p></section>
          {record.hasAnalysis && <div className="result-summary"><div><span>识别科目</span><SubjectPill subject={analysis.subject} /></div><div><span>批改方式</span><strong>{analysis.gradingMode === "marked" ? "参考已有批改" : analysis.gradingMode === "mixed" ? "已有批改 + 智能批改" : "智能批改"}</strong></div><div><span>判定正确</span><strong>{correctCount} 道</strong></div><div><span>分析判错</span><strong>{incorrectCount} 道</strong></div><div><span>当前归档</span><strong>{analysis.mistakes.length} 道</strong></div>{uncertainCount > 0 && <div><span>待核对</span><strong>{uncertainCount} 道</strong></div>}</div>}
          <div className="notice-card"><Lightbulb size={17} /><span>智能批改仅供学习参考，请核对题目、作答和答案；不清楚的题不会自动归档为错题。<MathText value={analysis.uncertainNote} /></span></div>
          <UploadRecord key={record.id} onSaved={()=>void refreshCurrentUpload()} record={record} busy={uploading} trialExpired={trialExpired} onRetry={retryUpload} onViewPhoto={(url,title)=>setLightboxImage({url,title})}/>
          {grading.length > 0 && record.ocrPages.length === 0 && <section className="grading-panel"><h2>逐题批改</h2><div className="grading-list">{grading.map((item, index) => <div className="grading-row" key={`${item.pageNumber}-${item.questionLabel}-${index}`}><span className={`grading-verdict ${item.verdict}`}>{item.verdict === "correct" ? "正确" : item.verdict === "incorrect" ? "错误" : "待核对"}</span><div><strong>第 {item.pageNumber} 页 · <MathText value={item.questionLabel} /></strong><p><MathText value={item.comment} /></p></div></div>)}</div></section>}
          {resultMistakes.length > 0 && <div className="daily-actions"><button type="button" onClick={() => openPrintSettings(resultMistakes)}>整理这批错题</button><button type="button" onClick={() => { const day = beijingDate(resultMistakes[0].createdAt); setDates({ date: day, dateFrom: "", dateTo: "" }); setDateInput(day); setDateMode("day"); setMonth(""); setDateError(""); setTab("notebook"); }}>查看归档当日错题</button></div>}
          {resultMistakes.length ? <><BatchToolbar items={resultMistakes} allItems={mistakes} selectedIds={selectedMistakeIds} count={batchCount} onCountChange={setBatchCount} onToggleAll={toggleAllMistakes} onClear={() => { setSelectedMistakeIds([]); setBatchNotice(""); }} onGenerate={generateSimilarBatch} onExport={openPrintSettings} busy={batchBusy || busySimilar !== null || exportingWord} progress={batchProgress} notice={batchNotice} trialExpired={trialExpired} /><div className="question-stack">{resultMistakes.map(item => <MistakeCard key={item.id} item={item} onSimilar={requestSimilar} onExport={exportMistake} onDelete={removeMistake} onSelect={toggleMistake} selectedForBatch={selectedMistakeIds.includes(item.id)} batchBusy={batchBusy} busy={busySimilar === item.id} exportingWord={exportingWord} trialExpired={trialExpired} reflections={reflections} onViewPhoto={(url, title) => setLightboxImage({ url, title })} />)}</div></> : <div className="empty-state"><BookOpen size={42} /><h2>{!record.hasAnalysis?"当前仅展示已保存资料":uncertainCount?"待核对题目尚未归档为错题":"没有确认的错题"}</h2><p>{uncertainCount?"请对照上方原图和识别文字核对；这不表示所有题目都正确。":"这次上传保留在分析记录中，可以随时重新打开。"}</p></div>}
          <button className="bottom-primary" onClick={() => { setTab("home"); fileRef.current?.click(); }}><Plus size={18} />继续上传</button>
        </>}
        {tab === "knowledge" && <KnowledgeMap mistakes={mistakes} papers={papers} initialSubject={knowledgeSubject} initialPoint={knowledgePoint} trialExpired={trialExpired} aiReady={aiReady} onTrialExpired={() => setTrialExpired(true)} onPractice={openPractice} onOpenMistake={item => { setSubject(item.subject); setQuery(item.question.slice(0, 30)); setMonth(""); setTab("notebook"); }} />}
        {tab === "practice" && <div className="daily-actions"><button onClick={()=>setTab("knowledge")}>知识点回顾</button><button onClick={()=>setTab("notebook")}>从错题本选择原题重做</button></div>}
        {tab === "practice" && <UnitPractice subjects={subjects} papers={papers} weakPoints={mistakes} initialSubject={practiceSubject} initialUnit={practiceUnit} initialPoint={practicePoint} trialExpired={trialExpired} aiReady={aiReady} onSaved={savePaperSummary} onTrialExpired={() => setTrialExpired(true)} onReviewPoint={(subjectName, pointName) => { setKnowledgeSubject(subjectName); setKnowledgePoint(pointName); setTab("knowledge"); }} />}
        {tab === "essay" && <EssayAnalysis trialExpired={trialExpired} aiReady={aiReady} ocrReady={ocrReady} onTrialExpired={() => setTrialExpired(true)} />}
        {tab === "notebook" && <>
          <div className="daily-actions"><button onClick={()=>void retrySelectedOriginal()}>原题重做（选一道题）</button><button onClick={()=>{setPrintOpen(true);setPrintIds([]);printDraft.reload();}}>恢复 / 查看服务端打印草稿</button></div>
          <section className="page-intro notebook-intro">
            <span className="section-kicker">MY MISTAKE BOOK</span>
            <h1>我的错题本</h1>
            <p>按题目快速浏览，点开卡片可查看完整答案与解析。勾选多道题可批量练习或合并导出。</p>
          </section>

          {/* 横向滑动学科微胶囊条 */}
          <div className="subject-pills-bar" role="group" aria-label="按学科快速筛选">
            <button
              type="button"
              className={`subject-pill-btn ${subject === "全部科目" ? "active" : ""}`}
              onClick={() => setSubject("全部科目")}
            >
              <span>全部科目</span>
              <span className="subject-pill-count">{mistakes.length}</span>
            </button>
            {subjects.map((subItem) => {
              const count = mistakes.filter(m => m.subject === subItem).length;
              return (
                <button
                  key={subItem}
                  type="button"
                  className={`subject-pill-btn ${subject === subItem ? "active" : ""}`}
                  onClick={() => setSubject(subItem)}
                >
                  <span className={`subject-chip-dot ${subjectColors[subItem] || "sand"}`} />
                  <span>{subItem}</span>
                  <span className="subject-pill-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="notebook-toolbar">
            <div className="search-field">
              <Search size={18} />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索题目或知识点" aria-label="搜索题目或知识点" />
            </div>
            <div className="filters">
              <label>
                <Filter size={16} />
                <select value={subject} onChange={event => setSubject(event.target.value)} aria-label="筛选科目">
                  <option>全部科目</option>
                  {subject !== "全部科目" && !subjects.includes(subject) && <option>{subject}</option>}
                  {subjects.map(item => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label>
                <CalendarDays size={16} />
                <input type="month" value={month} onChange={event => { setMonth(event.target.value); clearDates(); }} aria-label="筛选月份" />
              </label>
            </div>
          </div>
          <div className="daily-filter" role="group" aria-label="按归档日期整理">
            <button type="button" onClick={() => applyDates(true)}><CalendarDays size={15} />今天</button>
            <label>日期方式<select value={dateMode} onChange={event => setDateMode(event.target.value as "day" | "range")}><option value="day">指定日期</option><option value="range">日期区间</option></select></label>
            {dateMode === "day" ? <label>归档日期<input type="date" value={dateInput} onChange={event => setDateInput(event.target.value)} /></label> : <><label>开始日期<input type="date" value={dateFromInput} onChange={event => setDateFromInput(event.target.value)} /></label><label>结束日期<input type="date" value={dateToInput} onChange={event => setDateToInput(event.target.value)} /></label></>}
            <button type="button" onClick={() => applyDates()}>应用日期</button>
            {(dates.date || dates.dateFrom) && <button type="button" onClick={clearDates}>清除日期</button>}
            <p className="daily-timezone">归档日期按北京时间计算{dates.date ? ` · 当前：${dates.date}` : dates.dateFrom ? ` · 当前：${dates.dateFrom} 至 ${dates.dateTo}` : ""}</p>
            {dateError && <p className="printing-error" role="alert">{dateError}</p>}
          </div>
          <div className="notebook-count">
            共 <strong>{filtered.length}</strong> 道错题 {(subject !== "全部科目" || query || month || dates.date || dates.dateFrom) && <button onClick={() => { setSubject("全部科目"); setQuery(""); setMonth(""); clearDates(); }}>清除筛选 <X size={13} /></button>}
          </div>
          {!filtered.length && batchNotice && <p className="batch-status" role="status">{batchNotice}</p>}
          {filtered.length > 0 && !listError && <BatchToolbar items={filtered} allItems={mistakes} selectedIds={selectedMistakeIds} count={batchCount} onCountChange={setBatchCount} onToggleAll={toggleAllMistakes} onClear={() => { setSelectedMistakeIds([]); setBatchNotice(""); }} onGenerate={generateSimilarBatch} onExport={openPrintSettings} busy={batchBusy || busySimilar !== null || exportingWord} progress={batchProgress || printProgress} notice={batchNotice} trialExpired={trialExpired} />}
          {loadingList ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={30} /><h2>正在加载错题本</h2><p>正在读取你的题目与分类，请稍候。</p></div> : listError ? <div className="empty-state" role="alert"><h2>错题本暂时无法读取</h2><p>{listError}</p><button type="button" onClick={() => void loadMistakes()}>重新加载</button></div> : groups.length ? groups.map(([date, items]) => (
            <section className="date-group" key={date}>
              <div className="date-heading"><span className="date-dot" /><h2>{formatDate(date)}</h2><span>{items.length} 道错题</span><button type="button" onClick={() => toggleAllMistakes(items)} disabled={batchBusy || exportingWord}>{items.every(item => selectedMistakeIds.includes(item.id)) ? "取消本日选择" : "选择本日全部"}</button><button type="button" onClick={() => openPrintSettings(items)} disabled={exportingWord}>整理本日错题</button></div>
              <div className="question-stack notebook-grid">
                {items.map(item => (
                  <MistakeCard
                    key={item.id}
                    item={item}
                    onSimilar={requestSimilar}
                    onExport={exportMistake}
                    onDelete={removeMistake}
                    onSelect={toggleMistake}
                    selectedForBatch={selectedMistakeIds.includes(item.id)}
                    batchBusy={batchBusy}
                    busy={busySimilar === item.id}
                    exportingWord={exportingWord}
                    trialExpired={trialExpired}
                    showDelete
                    compact
                    reflections={reflections}
                    onViewPhoto={(url, title) => setLightboxImage({ url, title })}
                  />
                ))}
              </div>
            </section>
          )) : (
            <div className="empty-state">
              <BookOpen size={42} />
              <h2>{mistakes.length ? "没有找到符合条件的题目" : "错题本还是空的"}</h2>
              <p>{mistakes.length ? "试试更换科目、时间或搜索词。" : "上传试卷或作业，错题会自动按科目和时间存入这里。"}</p>
              {mistakes.length ? <button onClick={() => { setSubject("全部科目"); setQuery(""); setMonth(""); clearDates(); }}>清除筛选 <X size={16} /></button> : <button onClick={() => { setTab("home"); scrollToUpload(); }}>去上传题目 <ArrowRight size={16} /></button>}
            </div>
          )}
        </>}
      </div>
    </main>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />
    <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />

    {/* 原卷大图灯箱预览 */}
    {lightboxImage && createPortal(
      <div className="lightbox-backdrop" onClick={() => setLightboxImage(null)}>
        <div ref={lightboxRef} className="lightbox-content" role="dialog" aria-modal="true" aria-label={lightboxImage.title} onClick={event => event.stopPropagation()}>
          <button ref={lightboxCloseRef} type="button" className="lightbox-close-btn" onClick={() => setLightboxImage(null)} aria-label="关闭原卷预览">
            <X size={20} />
          </button>
          <img src={lightboxImage.url} alt={lightboxImage.title} />
          <div style={{ color: "#ffffff", marginTop: 12, fontSize: 13, fontWeight: 600 }}>{lightboxImage.title}</div>
        </div>
      </div>,
      document.body
    )}
    {printOpen && printIds !== null && <PrintSettings draftController={printDraft} items={printItems} options={printOptions} onOptions={options => { setPrintOptions(options); printOptionsChosen.current = true; setExportFile(null); }} onItems={ids => { setPrintIds(ids); setExportFile(null); setPrintError(""); }} onClose={() => { if (!exportingWord && !savingPrintDrafts) {setPrintOpen(false);void printDraft.save();} }} onGenerate={() => void exportMistakes(printItems, printOptions)} busy={exportingWord || savingPrintDrafts} progress={printProgress} error={printError} download={exportFile} unsaved={unsavedPrintItems.length} onSaveDrafts={() => void savePrintDrafts()} onDiscardDrafts={() => { unsavedPrintItems.forEach(item => discardDraft(item.id)); setPrintError(""); }} />}
  </div></>;
}
