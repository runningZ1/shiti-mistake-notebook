"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { makeMistakesDocx, mistakesDocxFilename } from "@/lib/mistake-docx";
import { isTrialExpired, accessEndsAt } from "@/lib/trial";
import type { PracticeSummary } from "@/lib/practice-types";
import KnowledgeMap from "./knowledge-map";
import UnitPractice from "./unit-practice";
import EssayAnalysis from "./essay-analysis";
import MathText from "./math-text";
import { ArrowRight, BookOpen, CalendarDays, Camera, Check, CheckCircle2, ChevronDown, Clock3, CloudUpload, Crown, FileImage, Filter, Lightbulb, LoaderCircle, LogOut, Menu, Plus, FileDown, Search, Sparkles, Trash2, UploadCloud, X, Network, ClipboardList, PenLine } from "lucide-react";
import "./workspace.css";

type Similar = { question: string; answer: string; explanation: string };
type Mistake = {
  id: string; uploadId: string; subject: string; question: string; incorrectAnswer: string;
  correctAnswer: string; reasoning: string; knowledgePoint: string; pageNumber: number;
  sourceName: string; similarQuestions: Similar[]; createdAt: string;
  questionBounds?: number[];
};
type GradedQuestion = { pageNumber: number; questionLabel: string; verdict: "correct" | "incorrect" | "uncertain"; comment: string };
type Analysis = { subject: string; summary: string; uncertainNote: string; gradingMode: "marked" | "unmarked" | "mixed"; grading: GradedQuestion[]; mistakes: Mistake[] };
type SelectedFile = { file: File; preview: string };
type Tab = "home" | "notebook" | "results" | "knowledge" | "practice" | "essay";

const analysisTips = [
  "若有答题卷，请和试卷题目一起上传，方便核对每道题。",
  "一次最多上传 4 张 JPG、PNG 或 WEBP 图片。",
  "拍照时让题目与作答都清晰入镜，尽量避开反光。",
  "请先遮盖姓名、学号等个人信息，再上传图片。",
  "认真对待每一道错题，你正在一点点进步。",
];

const subjectColors: Record<string, string> = { 数学: "lavender", 语文: "coral", 英语: "mint", 物理: "blue", 化学: "amber", 生物: "green", 历史: "sand", 地理: "teal", 政治: "rose" };
const formatDate = (date: string) => new Date(date).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

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

function needsOriginalPicture(item: Mistake): boolean {
  return item.subject.includes("数学") || /(?:如|见|下|右|左).{0,4}[图表]|图(?:形|像|象|表|示)|统计图|坐标系|计算|求值|化简|解方程|作图/.test(item.question);
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
    const scale = Math.min(1, 1600 / Math.max(sw, sh));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理原题图片");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
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
    <button type="button" onClick={() => onExport(chosen)} disabled={busy || chosen.length < 2}><FileDown size={15} />合并生成 Word</button>
    {selectedIds.length > 0 && <button type="button" className="batch-clear" onClick={onClear} disabled={busy}>清空选择</button>}
    {(progress || notice) && <span className="batch-status" role="status">{progress || notice}</span>}
    {chosen.length > 10 && <small>批量举一反三每次最多选 10 道；合并 Word 不受此限制。</small>}
  </div>;
}

function MistakeCard({ item, onSimilar, onExport, onDelete, onSelect, selectedForBatch, batchBusy, busy, exportingWord, trialExpired, showDelete = false, compact = false, onViewPhoto }: {
  item: Mistake; onSimilar: (id: string, count: number) => void; onExport: (item: Mistake) => void; onDelete: (id: string) => void;
  onSelect: (id: string) => void; selectedForBatch: boolean; batchBusy: boolean; busy: boolean; exportingWord: boolean; trialExpired: boolean; showDelete?: boolean; compact?: boolean;
  onViewPhoto?: (url: string, title: string) => void;
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [similarCount, setSimilarCount] = useState("3");
  const answersOpen = userExpanded !== null ? userExpanded : (item.similarQuestions.length > 0);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!compact || !detailsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = openButtonRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDetailsOpen(false); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') || [])];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [compact, detailsOpen]);
  return <article className={`question-card${compact ? " notebook-card" : ""}${detailsOpen ? " is-expanded" : ""}`}>
    <label className="mistake-select"><input type="checkbox" checked={selectedForBatch} onChange={() => onSelect(item.id)} disabled={batchBusy} />{selectedForBatch ? "已加入批量操作" : "选中这道错题"}</label>
    <div className="question-top">
      <div className="question-tags">
        <SubjectPill subject={item.subject} />
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
      <div className="question-footer">{!compact && <span className="source-line"><FileImage size={14} />{item.sourceName} · 第 {item.pageNumber} 页</span>}<div className="question-actions"><button className="export-button" onClick={() => onExport(item)} disabled={exportingWord}>{exportingWord ? <LoaderCircle size={15} className="spin" /> : <FileDown size={15} />}{exportingWord ? "正在生成…" : "生成 Word"}</button>{showDelete && <button className="icon-action" title="移除这道错题" onClick={() => onDelete(item.id)}><Trash2 size={16} /></button>}<div className="similar-request"><label htmlFor={`similar-count-${item.id}`}>再给我出 <input id={`similar-count-${item.id}`} className="similar-count" type="number" min="1" max="5" step="1" inputMode="numeric" value={similarCount} onChange={event => { if (/^[1-5]?$/.test(event.target.value)) setSimilarCount(event.target.value); }} aria-label="类似题数量，1 到 5 道" /> 道类似题目</label><button className="similar-button" onClick={() => onSimilar(item.id, Number(similarCount))} disabled={trialExpired || batchBusy || busy || !/^[1-5]$/.test(similarCount)} title={trialExpired ? "试用已到期，请联系管理员开通" : undefined}>{busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{trialExpired ? "体验已到期" : "生成"}</button></div>{item.similarQuestions.length > 0 && <button className="similar-toggle" onClick={() => setUserExpanded(!answersOpen)} aria-expanded={answersOpen}>{answersOpen ? "收起" : "查看"}已生成的 {item.similarQuestions.length} 道题<ChevronDown size={15} className={answersOpen ? "turn" : ""} /></button>}</div></div>
      {item.similarQuestions.length > 0 && answersOpen && <div className="similar-list"><div className="similar-title"><Sparkles size={17} />举一反三 · {item.similarQuestions.length} 道练习</div>{item.similarQuestions.map((similar, index) => <SimilarExercise item={similar} index={index} key={index} />)}</div>}
    </div>}
    {compact && detailsOpen && createPortal(<div className="notebook-detail-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetailsOpen(false); }}><div ref={dialogRef} className="notebook-detail-panel" role="dialog" aria-modal="true" aria-label="错题详情"><div className="notebook-detail-header"><strong>错题详情</strong><button ref={closeButtonRef} type="button" onClick={() => setDetailsOpen(false)} aria-label="关闭错题详情"><X size={20} /></button></div><MistakeCard item={item} onSimilar={onSimilar} onExport={onExport} onDelete={id => { setDetailsOpen(false); onDelete(id); }} onSelect={onSelect} selectedForBatch={selectedForBatch} batchBusy={batchBusy} busy={busy} exportingWord={exportingWord} trialExpired={trialExpired} showDelete={showDelete} onViewPhoto={onViewPhoto} /></div></div>, document.body)}
  </article>;
}

export default function Dashboard({ name, trialEndsAt: originalTrialEndsAt, paidEndsAt, role }: { name: string; trialEndsAt: string | null; paidEndsAt: string | null; role: "user" | "admin" }) {
  const [tab, setActiveTab] = useState<Tab>("home");
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [papers, setPapers] = useState<PracticeSummary[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [selected, setSelected] = useState<SelectedFile[]>([]);
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
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [busySimilar, setBusySimilar] = useState<string | null>(null);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportFile, setExportFile] = useState<{ url: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("全部科目");
  const [month, setMonth] = useState("");
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
    setActiveTab(next);
    setMobileMenu(false);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "home" || next === "results") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      if (url.href !== window.location.href) window.history.pushState(null, "", url);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      setActiveTab(view === "notebook" || view === "knowledge" || view === "practice" || view === "essay" ? view : "home");
      setQuery(params.get("q") || "");
      setSubject(params.get("subject") || "全部科目");
      setMonth(params.get("month") || "");
      setMobileMenu(false);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  useEffect(() => {
    if (!urlReady.current) { urlReady.current = true; return; }
    const url = new URL(window.location.href);
    for (const [key, value] of [["q", query], ["subject", subject === "全部科目" ? "" : subject], ["month", month]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url);
  }, [query, subject, month]);

  useEffect(() => {
    fetch("/api/status").then(r => r.json() as Promise<{ aiConfigured: boolean }>).then(data => setAiReady(Boolean(data.aiConfigured))).catch(() => setAiReady(false));
    fetch("/api/mistakes").then(r => { if (redirectIfUnauthorized(r)) return null; if (!r.ok) throw new Error("错题本加载失败"); return r.json() as Promise<{ mistakes?: Mistake[] }>; }).then(data => { if (data && Array.isArray(data.mistakes)) setMistakes(data.mistakes); }).catch(() => setError("错题本加载失败，请刷新页面重试")).finally(() => setLoadingList(false));
    fetch("/api/practice-papers").then(r => { if (redirectIfUnauthorized(r)) return null; if (!r.ok) throw new Error("练习卷列表加载失败"); return r.json() as Promise<{ papers?: PracticeSummary[] }>; }).then(data => { if (data && Array.isArray(data.papers)) setPapers(data.papers); }).catch(() => setError("练习卷列表加载失败，请刷新页面重试"));
  }, []);

  useEffect(() => {
    const current = new Set(selected.map(item => item.preview));
    for (const url of previewUrls.current) if (!current.has(url)) URL.revokeObjectURL(url);
    previewUrls.current = current;
  }, [selected]);
  useEffect(() => () => { for (const url of previewUrls.current) URL.revokeObjectURL(url); }, []);
  useEffect(() => () => { if (exportFile) URL.revokeObjectURL(exportFile.url); }, [exportFile]);
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
  const filtered = useMemo(() => mistakes.filter(item => (subject === "全部科目" || item.subject === subject) && (!month || item.createdAt.slice(0, 7) === month) && (!query || `${item.question} ${item.knowledgePoint} ${item.sourceName}`.toLowerCase().includes(query.toLowerCase()))), [mistakes, subject, month, query]);
  const groups = useMemo(() => {
    const result: Record<string, Mistake[]> = {};
    for (const item of filtered) (result[item.createdAt.slice(0, 10)] ||= []).push(item);
    return Object.entries(result);
  }, [filtered]);
  const resultMistakes = analysis?.mistakes.map(item => mistakes.find(saved => saved.id === item.id) || item) || [];

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
    const incoming = Array.from(list).filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (incoming.length !== list.length) setError("只支持 JPG、PNG、WEBP 图片"); else setError("");
    if (selected.length + incoming.length > 4) setError("一次最多上传 4 张图片");
    if (!incoming.length) return;
    setSelected(current => {
      const next = [...current, ...incoming.map(file => ({ file, preview: URL.createObjectURL(file) }))];
      if (next.length > 4) next.slice(4).forEach(item => URL.revokeObjectURL(item.preview));
      return next.slice(0, 4);
    });
    setTab("home");
    scrollToUpload();
  }

  async function analyze() {
    if (!selected.length) { fileRef.current?.click(); return; }
    if (trialExpired) { setError("7 天免费体验已结束，请前往会员方案（¥99/月）开通使用权限。"); return; }
    if (aiReady === false) { setError("AI 服务尚未配置，当前不能自动分析。请完成服务端密钥配置。"); return; }
    setTipIndex(0); setUploading(true); setError("");
    try {
      const form = new FormData();
      for (const item of selected) form.append("files", await shrinkImage(item.file));
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as Analysis & { error?: string; code?: string };
      if (data.code === "TRIAL_EXPIRED") setTrialExpired(true);
      if (!response.ok) throw new Error(data.error || "分析失败，请重试");
      setAnalysis(data); setMistakes(current => [...data.mistakes, ...current]); setSelected([]); setSelectedMistakeIds([]); setBatchNotice(""); setTab("results");
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
      setMistakes(current => current.filter(item => item.id !== id));
      setAnalysis(current => current ? { ...current, mistakes: current.mistakes.filter(item => item.id !== id) } : current);
      setSelectedMistakeIds(current => current.filter(item => item !== id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "移除失败"); }
  }

  async function exportMistakes(items: Mistake[]) {
    if (exportingWord || !items.length) return;
    setError("");
    setExportFile(null);
    // A direct server download keeps Huawei and other mobile browsers out of the Blob download path.
    if (items.length <= 30 && items.every(item => !/\.webp$/i.test(item.sourceName))) {
      const url = items.length === 1
        ? `/api/mistakes/${encodeURIComponent(items[0].id)}/word`
        : `/api/mistakes/word?${items.map(item => `id=${encodeURIComponent(item.id)}`).join("&")}`;
      window.location.assign(url);
      return;
    }
    setExportingWord(true);
    try {
      const prepared = [];
      for (const item of items) {
        const visualQuestion = /(?:如|见|下|右|左).{0,4}[图表]|图(?:形|像|象|表|示)|统计图|坐标系|作图/.test(item.question);
        prepared.push({ ...item, visualQuestion, ...(needsOriginalPicture(item) ? { sourceImage: await sourcePicture(item) } : {}) });
      }
      const bytes = makeMistakesDocx(prepared);
      const blob = new Blob([bytes.buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const name = mistakesDocxFilename(items);
      link.href = url; link.download = name;
      setExportFile({ url, name });
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Word 文档生成失败，请重试。");
    } finally { setExportingWord(false); }
  }

  function exportMistake(item: Mistake) { void exportMistakes([item]); }

  async function signOut() {
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

  const recent = mistakes.slice(0, 2);
  const grading = analysis?.grading || [];
  const correctCount = grading.filter(item => item.verdict === "correct").length;
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
        <button className={tab === "home" ? "active" : ""} onClick={() => { setTab("home"); setMobileMenu(false); }}>
          <span className="nav-item-left">
            <span className="nav-icon-box violet"><Sparkles size={16} /></span>
            <span className="nav-label">学习工作台</span>
          </span>
          <ArrowRight size={14} className="nav-arrow" />
        </button>
        <button className={tab === "notebook" ? "active" : ""} onClick={() => { setTab("notebook"); setMobileMenu(false); }}>
          <span className="nav-item-left">
            <span className="nav-icon-box emerald"><BookOpen size={16} /></span>
            <span className="nav-label">我的错题本</span>
          </span>
          <em className="nav-count-badge">{mistakes.length}</em>
        </button>
        <button className={tab === "essay" ? "active" : ""} onClick={() => { setTab("essay"); setMobileMenu(false); }}>
          <span className="nav-item-left">
            <span className="nav-icon-box rose"><PenLine size={16} /></span>
            <span className="nav-label">英语作文批改</span>
          </span>
          <span className="nav-new-pill">AI批改</span>
        </button>
        <button className={tab === "knowledge" ? "active" : ""} onClick={() => { setTab("knowledge"); setMobileMenu(false); }}>
          <span className="nav-item-left">
            <span className="nav-icon-box sky"><Network size={16} /></span>
            <span className="nav-label">知识图谱</span>
          </span>
          <ArrowRight size={14} className="nav-arrow" />
        </button>
        <button className={tab === "practice" ? "active" : ""} onClick={() => openPractice()}>
          <span className="nav-item-left">
            <span className="nav-icon-box amber"><ClipboardList size={16} /></span>
            <span className="nav-label">单元练习卷</span>
          </span>
          <em className="nav-count-badge">{papers.length}</em>
        </button>
        {analysis && <button className={tab === "results" ? "active" : ""} onClick={() => setTab("results")}><span className="nav-item-left"><span className="nav-icon-box"><CheckCircle2 size={16} /></span><span>本次分析结果</span></span><ArrowRight size={14} /></button>}
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
        <div className="breadcrumb">学习空间 <span>/</span> <strong>{tab === "home" ? "学习工作台" : tab === "results" ? "分析结果" : tab === "knowledge" ? "知识图谱" : tab === "practice" ? "单元练习卷" : tab === "essay" ? "英语作文分析" : "我的错题本"}</strong></div>
        <div className="top-right">
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
        {([{ key: "home", label: "工作台", Icon: Sparkles }, { key: "notebook", label: "错题本", Icon: BookOpen }, { key: "knowledge", label: "知识图谱", Icon: Network }, { key: "practice", label: "练习卷", Icon: ClipboardList }, { key: "essay", label: "作文批改", Icon: PenLine }] as const).map(({ key, label, Icon }) => <button key={key} type="button" className={`tabbar-item ${tab === key ? "active" : ""}`} aria-current={tab === key ? "page" : undefined} onClick={() => key === "practice" ? openPractice() : setTab(key)}><Icon size={20} /><span>{label}</span></button>)}
      </nav>
      <div className="content-wrap">
        {trialEndsAt && role !== "admin" && <div className={`trial-banner ${trialExpired ? "expired" : ""}`} role="status"><Sparkles size={18} /><span suppressHydrationWarning>{trialExpired ? "体验或会员已到期。已有错题仍可查看；继续分析或生成练习可开通 VIP（¥99／30天）。" : `${paidEndsAt && !isTrialExpired(paidEndsAt) ? "会员有效期至：" : "免费体验截止时间："}${new Date(trialEndsAt).toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}。`}</span><a href="/pricing" className="trial-upgrade-btn">{trialExpired ? "立即开通 VIP" : "会员方案"}</a></div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭提示"><X size={17} /></button></div>}
        {exportFile && <div className="notice-card" role="status"><span>Word 文档已生成，可在下载列表打开后编辑、打印。</span><a className="word-download-link" href={exportFile.url} download={exportFile.name}>再次下载 Word</a><button className="icon-action" onClick={() => setExportFile(null)} aria-label="关闭下载提示"><X size={17} /></button></div>}
        {tab === "home" && <>
          <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> YOUR LEARNING DESK</div><h1>你好，{name}<span className="wave">✳</span></h1><p>把今天不懂的题，变成明天会做的题。</p></div><span className="welcome-date"><Clock3 size={16} />今天也在认真进步</span></section>
          <section className="desk-overview" aria-label="开始学习"><div><span className="section-kicker">从一道错题，开始一次进步</span><h2>拍下来，理清楚，再练一次。</h2><p>先上传作业，查看逐题解析；再到错题本整理和练习。</p></div><div className="desk-overview-steps"><span><Camera size={17} />上传作业</span><ArrowRight size={14} /><span><BookOpen size={17} />整理错题</span><ArrowRight size={14} /><span><ClipboardList size={17} />针对练习</span></div></section>
          <div className="dashboard-grid"><section className="panel upload-panel" ref={uploadPanelRef}>
            <div className="panel-heading"><div><span className="section-kicker">01 / UPLOAD</span><h2>上传你的题目</h2><p>试卷、练习册、课作本，拍一张就能开始整理。</p></div><span className="heading-icon"><CloudUpload size={24} /></span></div>
            <button type="button" className="upload-zone" disabled={uploading} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }} onClick={() => fileRef.current?.click()}><span className="upload-illustration"><UploadCloud size={31} /></span><strong>点击上传，或将图片拖到这里</strong><span>支持 JPG、PNG、WEBP · 最多 4 张</span><span className="upload-select">选择图片 <Plus size={16} /></span></button>
            <div className="upload-actions"><button disabled={uploading} onClick={() => cameraRef.current?.click()}><Camera size={17} />拍照上传</button><span>图片将发送至 DeepSeek 分析，请遮盖姓名等个人信息</span></div>
            {selected.length > 0 && <div className="file-list" ref={uploadReviewRef}><div className="upload-ready" role="status"><CheckCircle2 size={17} />已添加 {selected.length} 张照片。可继续添加，或检查后点击下方“开始智能分析”。</div>
              {selected.map((item, index) => <div className="selected-file" key={item.preview}><img src={item.preview} alt={`待上传第 ${index + 1} 张`} /><div><strong>{item.file.name}</strong><small>{(item.file.size / 1024 / 1024).toFixed(1)} MB</small></div><button disabled={uploading} aria-label={`移除第 ${index + 1} 张图片`} onClick={() => setSelected(current => current.filter(file => file !== item))}><X size={17} /></button></div>)}
              <button className="analyze-button" onClick={analyze} disabled={uploading || trialExpired}>{uploading ? <><LoaderCircle className="spin" size={18} />正在批改并分析...</> : trialExpired ? <>体验已到期，暂不能分析</> : <><Sparkles size={18} />开始智能分析 <ArrowRight size={17} /></>}</button>
              {uploading && <div className="analysis-progress" role="status" aria-live="polite">
                <div className="analysis-progress-track" role="progressbar" aria-label="正在批改和分析作业"><span /></div>
                <p className="analysis-tip"><Lightbulb size={15} aria-hidden="true" /><span>{analysisTips[tipIndex]}</span></p>
              </div>}
            </div>}
            {aiReady === false && <p className="service-note">自动分析服务待配置。页面与错题本已就绪，配置后即可处理图片。</p>}
          </section>
          <section className="panel process-panel"><div className="panel-heading"><div><span className="section-kicker">HOW IT WORKS</span><h2>从拍照到掌握</h2><p>只需简单三步，理清每一次失误。</p></div></div><div className="steps"><div className="step"><span className="step-number">01</span><div><strong>上传图片</strong><p>拍摄已批改或未批改作业，清晰显示题目和作答。</p></div><span className="step-icon lavender"><Camera size={20} /></span></div><div className="step"><span className="step-number">02</span><div><strong>逐题批改</strong><p>结合已有批改或智能判题，展示对错与解题思路。</p></div><span className="step-icon coral"><Lightbulb size={20} /></span></div><div className="step"><span className="step-number">03</span><div><strong>归档巩固</strong><p>按科目、时间保存，按需练习 1–5 道类似题。</p></div><span className="step-icon mint"><BookOpen size={20} /></span></div></div><div className="process-footer"><CheckCircle2 size={17} />错题仅对登录的你可见</div></section></div>

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
              <p>{loadingList ? "正在读取你的学习记录…" : `已归档 ${mistakes.length} 道错题，其中 ${practicedMistakesCount} 道已生成类似题。生成练习不代表已经掌握。`}</p>
              <div className="tracker-stats-grid">
                <div className="tracker-stat-box">
                  <span>已归档错题</span>
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
          <section className="recent-section"><div className="section-heading"><div><span className="section-kicker">YOUR PROGRESS</span><h2>最近整理</h2></div><button onClick={() => setTab("notebook")}>查看全部 <ArrowRight size={16} /></button></div>{loadingList ? <div className="empty-recent"><LoaderCircle className="spin" size={20} />正在加载错题本...</div> : recent.length ? <div className="recent-list">{recent.map(item => <button key={item.id} className="recent-item" onClick={() => { setSubject(item.subject); setQuery(item.question.slice(0, 12)); setTab("notebook"); }}><SubjectPill subject={item.subject} /><span>{item.question}</span><small>{formatDate(item.createdAt)}</small><ArrowRight size={16} /></button>)}</div> : <div className="empty-recent"><div className="empty-icon"><BookOpen size={24} /></div><div><strong>你的错题本还很清爽</strong><p>上传第一张试卷，开始积累属于自己的学习地图。</p></div></div>}</section>
        </>}
        {tab === "results" && analysis && <>
          <section className="page-intro"><span className="section-kicker">GRADING COMPLETE</span><h1>批改与分析完成 <span className="success-check"><Check size={22} /></span></h1><p><MathText value={analysis.summary || "已完成图片分析。"} /></p></section>
          <div className="result-summary"><div><span>识别科目</span><SubjectPill subject={analysis.subject} /></div><div><span>批改方式</span><strong>{analysis.gradingMode === "marked" ? "参考已有批改" : analysis.gradingMode === "mixed" ? "已有批改 + 智能批改" : "智能批改"}</strong></div><div><span>判定正确</span><strong>{correctCount} 道</strong></div><div><span>发现错题</span><strong>{analysis.mistakes.length} 道</strong></div>{uncertainCount > 0 && <div><span>待核对</span><strong>{uncertainCount} 道</strong></div>}</div>
          <div className="notice-card"><Lightbulb size={17} /><span>智能批改仅供学习参考，请核对题目、作答和答案；不清楚的题不会自动归档为错题。<MathText value={analysis.uncertainNote} /></span></div>
          {grading.length > 0 && <section className="grading-panel"><h2>逐题批改</h2><div className="grading-list">{grading.map((item, index) => <div className="grading-row" key={`${item.pageNumber}-${item.questionLabel}-${index}`}><span className={`grading-verdict ${item.verdict}`}>{item.verdict === "correct" ? "正确" : item.verdict === "incorrect" ? "错误" : "待核对"}</span><div><strong>第 {item.pageNumber} 页 · <MathText value={item.questionLabel} /></strong><p><MathText value={item.comment} /></p></div></div>)}</div></section>}
          {resultMistakes.length ? <><BatchToolbar items={resultMistakes} allItems={mistakes} selectedIds={selectedMistakeIds} count={batchCount} onCountChange={setBatchCount} onToggleAll={toggleAllMistakes} onClear={() => { setSelectedMistakeIds([]); setBatchNotice(""); }} onGenerate={generateSimilarBatch} onExport={exportMistakes} busy={batchBusy || busySimilar !== null || exportingWord} progress={batchProgress} notice={batchNotice} trialExpired={trialExpired} /><div className="question-stack">{resultMistakes.map(item => <MistakeCard key={item.id} item={item} onSimilar={requestSimilar} onExport={exportMistake} onDelete={removeMistake} onSelect={toggleMistake} selectedForBatch={selectedMistakeIds.includes(item.id)} batchBusy={batchBusy} busy={busySimilar === item.id} exportingWord={exportingWord} trialExpired={trialExpired} onViewPhoto={(url, title) => setLightboxImage({ url, title })} />)}</div></> : <div className="empty-state"><CheckCircle2 size={42} /><h2>没有确认的错题</h2><p>如果题目或作答不清晰，请换一张更清晰的照片再试。</p></div>}
          <button className="bottom-primary" onClick={() => { setTab("home"); fileRef.current?.click(); }}><Plus size={18} />继续上传</button>
        </>}
        {tab === "knowledge" && <KnowledgeMap mistakes={mistakes} papers={papers} initialSubject={knowledgeSubject} initialPoint={knowledgePoint} trialExpired={trialExpired} aiReady={aiReady} onTrialExpired={() => setTrialExpired(true)} onPractice={openPractice} onOpenMistake={item => { setSubject(item.subject); setQuery(item.question.slice(0, 30)); setMonth(""); setTab("notebook"); }} />}
        {tab === "practice" && <UnitPractice subjects={subjects} papers={papers} weakPoints={mistakes} initialSubject={practiceSubject} initialUnit={practiceUnit} initialPoint={practicePoint} trialExpired={trialExpired} aiReady={aiReady} onSaved={savePaperSummary} onTrialExpired={() => setTrialExpired(true)} onReviewPoint={(subjectName, pointName) => { setKnowledgeSubject(subjectName); setKnowledgePoint(pointName); setTab("knowledge"); }} />}
        {tab === "essay" && <EssayAnalysis trialExpired={trialExpired} aiReady={aiReady} onTrialExpired={() => setTrialExpired(true)} />}
        {tab === "notebook" && <>
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
                <input type="month" value={month} onChange={event => setMonth(event.target.value)} aria-label="筛选月份" />
              </label>
            </div>
          </div>
          <div className="notebook-count">
            共 <strong>{filtered.length}</strong> 道错题 {(subject !== "全部科目" || query || month) && <button onClick={() => { setSubject("全部科目"); setQuery(""); setMonth(""); }}>清除筛选 <X size={13} /></button>}
          </div>
          {filtered.length > 0 && <BatchToolbar items={filtered} allItems={mistakes} selectedIds={selectedMistakeIds} count={batchCount} onCountChange={setBatchCount} onToggleAll={toggleAllMistakes} onClear={() => { setSelectedMistakeIds([]); setBatchNotice(""); }} onGenerate={generateSimilarBatch} onExport={exportMistakes} busy={batchBusy || busySimilar !== null || exportingWord} progress={batchProgress} notice={batchNotice} trialExpired={trialExpired} />}
          {loadingList ? <div className="empty-state" role="status"><LoaderCircle className="spin" size={30} /><h2>正在加载错题本</h2><p>正在读取你的题目与分类，请稍候。</p></div> : groups.length ? groups.map(([date, items]) => (
            <section className="date-group" key={date}>
              <div className="date-heading"><span className="date-dot" /><h2>{formatDate(date)}</h2><span>{items.length} 道错题</span></div>
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
              {mistakes.length ? <button onClick={() => { setSubject("全部科目"); setQuery(""); setMonth(""); }}>清除筛选 <X size={16} /></button> : <button onClick={() => { setTab("home"); scrollToUpload(); }}>去上传题目 <ArrowRight size={16} /></button>}
            </div>
          )}
        </>}
      </div>
    </main>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ""; }} />
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
  </div></>;
}
