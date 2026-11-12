"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, Lightbulb, LoaderCircle, Network, Sparkles } from "lucide-react";
import { buildKnowledgeMap, type KnowledgeEvidence, type KnowledgeNode } from "@/lib/knowledge-map";
import { knowledgeKey, normalizeKnowledgePoint, type KnowledgeGuide, type KnowledgeProfile } from "@/lib/knowledge-types";
import type { PracticeSummary } from "@/lib/practice-types";
import { roundKnowledgeEvidence, type LearningEvidenceResponse } from '@/lib/learning-evidence';
import MathText from "./math-text";
import "./study-tools.css";

type Mistake = {
  id: string; uploadId: string; subject: string; knowledgePoint: string; archiveKind?: 'mistake' | 'collection';
  question: string; incorrectAnswer: string; correctAnswer: string; reasoning: string; createdAt: string;
};

const priorityLabel: Record<KnowledgeNode["priority"], string> = {
  high: "优先弄懂", medium: "继续巩固", new: "等待更多证据",
};
const unassigned = "待归类";

function redirectIfUnauthorized(response: Response): boolean {
  if (response.status !== 401) return false;
  // Full navigation clears knowledge drafts held in memory after session expiry.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login";
  return true;
}

export default function KnowledgeMap({ mistakes, papers, initialSubject, initialPoint, trialExpired, aiReady, onTrialExpired, onPractice, onOpenMistake }: {
  mistakes: Mistake[];
  papers: PracticeSummary[];
  initialSubject: string;
  initialPoint: string;
  trialExpired: boolean;
  aiReady: boolean | null;
  onTrialExpired: () => void;
  onPractice: (subject: string, unitName: string, point: string) => void;
  onOpenMistake: (item: Mistake) => void;
}) {
  const [selectedSubject, setSelectedSubject] = useState(initialSubject || "全部科目");
  const [selectedUnit, setSelectedUnit] = useState("全部单元");
  const [selectedId, setSelectedId] = useState(initialPoint ? knowledgeKey(initialSubject, initialPoint) : "");
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  const [visibleByUnit, setVisibleByUnit] = useState<Record<string, number>>({});
  const detailRef = useRef<HTMLElement>(null);
  const [profiles, setProfiles] = useState<KnowledgeProfile[]>([]);
  const [unitDrafts, setUnitDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);
  const [roundEvidence,setRoundEvidence]=useState<LearningEvidenceResponse|null>(null);
  const [evidenceError,setEvidenceError]=useState('');
  const [loadingEvidence,setLoadingEvidence]=useState(true);
  const evidenceProfile=useRef<string|null>(null);
  const [savedMessage, setSavedMessage] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/knowledge").then(async response => {
      if (redirectIfUnauthorized(response)) return null;
      const data = await response.json() as { profiles?: KnowledgeProfile[]; error?: string };
      if (!response.ok) throw new Error(data.error || "知识点信息加载失败");
      return data;
    }).then(data => {
      if (!cancelled && data?.profiles) setProfiles(data.profiles);
    }).catch(cause => { if (!cancelled) setProfileError(cause instanceof Error ? cause.message : "知识点信息加载失败"); })
      .finally(() => { if (!cancelled) setLoadingProfiles(false); });
    return () => { cancelled = true; };
  }, [loadVersion]);

  useEffect(()=>{
    let cancelled=false;
    fetch('/api/learning?kind=evidence',{headers:evidenceProfile.current?{'X-Shiti-Profile':evidenceProfile.current}:{}}).then(async response=>{
      if(redirectIfUnauthorized(response))return null;
      const data=await response.json() as LearningEvidenceResponse;
      if(!response.ok)throw new Error(data.error||'作答轮次证据加载失败');return data;
    }).then(data=>{if(!cancelled&&data){evidenceProfile.current=data.profileId;setRoundEvidence(data);setEvidenceError('');}})
      .catch(e=>{if(!cancelled)setEvidenceError(e instanceof Error?e.message:'作答轮次证据加载失败');})
      .finally(()=>{if(!cancelled)setLoadingEvidence(false);});
    return()=>{cancelled=true;};
  },[loadVersion]);
  const rounds=useMemo(()=>roundEvidence?[...roundEvidence.attempts,...roundEvidence.legacyPapers]:[],[roundEvidence]);
  const evidence = useMemo<KnowledgeEvidence[]>(() => [
    ...mistakes.filter(item=>item.archiveKind!=='collection').map(item => ({
      id: item.id, subject: item.subject, knowledgePoint: item.knowledgePoint,
      sourceId: item.uploadId, source: "mistake" as const, createdAt: item.createdAt,
    })),
    ...roundKnowledgeEvidence(rounds),
  ], [mistakes, rounds]);
  const nodes = useMemo(() => buildKnowledgeMap(evidence), [evidence]);
  const profilesByKey = new Map(profiles.map(item => [knowledgeKey(item.subject, item.knowledgePoint), item]));
  const suggestedUnits = new Map<string, Set<string>>();
  for (const paper of papers) {
    for (const point of paper.wrongKnowledgePoints) {
      const key = knowledgeKey(paper.subject, point);
      const names = suggestedUnits.get(key) || new Set<string>();
      names.add(paper.unitName);
      suggestedUnits.set(key, names);
    }
  }
  const inferredUnit = (node: KnowledgeNode) => {
    const names = suggestedUnits.get(node.id);
    return names?.size === 1 ? [...names][0] : "";
  };
  const unitFor = (node: KnowledgeNode) => profilesByKey.get(node.id)?.unitName || inferredUnit(node) || unassigned;
  const subjects = [...new Set(nodes.map(node => node.subject))];
  const subjectNodes = nodes.filter(node => selectedSubject === "全部科目" || node.subject === selectedSubject);
  const units = [...new Set(subjectNodes.map(unitFor))].sort((a, b) => a === unassigned ? 1 : b === unassigned ? -1 : a.localeCompare(b, "zh-CN"));
  const visible = subjectNodes.filter(node => selectedUnit === "全部单元" || unitFor(node) === selectedUnit);
  const selected = visible.find(node => node.id === selectedId) || visible[0];
  const selectedProfile = selected ? profilesByKey.get(selected.id) : undefined;
  const unitDraft = selected ? (unitDrafts[selected.id] ?? selectedProfile?.unitName ?? inferredUnit(selected)) : "";
  const selectedUnitName = selected ? unitFor(selected) : "";
  const relatedMistakes = selected ? mistakes.filter(item =>
    item.archiveKind!=='collection' && item.subject === selected.subject && normalizeKnowledgePoint(item.knowledgePoint) === selected.name
  ).slice(0, 3) : [];
  const selectedRounds=selected?rounds.filter(r=>r.subject===selected.subject&&(r.questions.some(q=>normalizeKnowledgePoint(q.knowledgePoint||'')===selected.name)||r.grading.some(g=>normalizeKnowledgePoint(g.knowledgePoint||'')===selected.name))):[];
  const focus = subjectNodes.slice(0, 3);

  function selectPoint(node: KnowledgeNode, resetUnitFilter = false) {
    if (resetUnitFilter) setSelectedUnit("全部单元");
    setOpenUnit(unitFor(node));
    setSavedMessage(""); setError("");
    setSelectedId(node.id);
    // On phones the detail is below the catalog. The arrow must take the user there.
    window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      detailRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  async function saveUnit() {
    if (!selected) return;
    const target = selected;
    setSaving(true); setError(""); setSavedMessage("");
    try {
      const response = await fetch("/api/knowledge", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: target.subject, knowledgePoint: target.name, unitName: unitDraft }),
      });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as { profile?: KnowledgeProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || "单元归属保存失败");
      setProfiles(current => [...current.filter(item => knowledgeKey(item.subject, item.knowledgePoint) !== target.id), data.profile!]);
      setOpenUnit(data.profile.unitName || unassigned);
      if (selectedUnit !== "全部单元") setSelectedUnit(data.profile.unitName || unassigned);
      setSavedMessage(`“${target.name}”的单元归属已保存。`);
      setUnitDrafts(current => { const next = { ...current }; delete next[target.id]; return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "单元归属保存失败"); }
    finally { setSaving(false); }
  }

  async function generateGuide() {
    if (!selected) return;
    const target = selected;
    setGenerating(true); setError("");
    try {
      const response = await fetch("/api/knowledge/guide", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: target.subject, knowledgePoint: target.name }),
      });
      if (redirectIfUnauthorized(response)) return;
      const data = await response.json() as { guide?: KnowledgeGuide; error?: string; code?: string };
      if (data.code === "TRIAL_EXPIRED") onTrialExpired();
      if (!response.ok || !data.guide) throw new Error(data.error || "概念提示生成失败");
      setProfiles(current => {
        const old = current.find(item => knowledgeKey(item.subject, item.knowledgePoint) === target.id);
        return [...current.filter(item => knowledgeKey(item.subject, item.knowledgePoint) !== target.id),
          { subject: target.subject, knowledgePoint: target.name, unitName: old?.unitName || "", guide: data.guide! }];
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "概念提示生成失败"); }
    finally { setGenerating(false); }
  }

  return <div className="study-tools knowledge-tool">
    <section className="page-intro"><span className="section-kicker">KNOWLEDGE MAP</span><h1>知识图谱</h1><p>从错题证据找到学习重点，先理解概念，再用练习验证。</p></section>
    {error && <div className="practice-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
    {profileError && <div className="tool-notice tool-notice-error" role="alert"><span>{profileError}。单元归属与概念提示可能尚未加载。</span><button type="button" onClick={() => { setLoadingProfiles(true); setProfileError(""); setLoadVersion(value => value + 1); }}>重新加载</button></div>}
    {evidenceError&&<div className="tool-notice tool-notice-error" role="alert"><span>{evidenceError}。未将最新 grading 当作轮次历史回退。</span><button type="button" onClick={()=>{setLoadingEvidence(true);setLoadVersion(v=>v+1);}}>重新加载作答证据</button></div>}
    {loadingEvidence&&<p role="status">正在加载独立作答轮次…</p>}
    {roundEvidence?.truncated&&<p className="tool-notice">仅展示最近 {roundEvidence.limit} 个作答轮次及最多 {roundEvidence.limit} 份无轮次的历史卷；以下统计仅覆盖展示范围。</p>}
    {loadingProfiles && <p className="tool-status" role="status"><LoaderCircle size={16} className="spin" />正在加载单元归属与概念提示…</p>}
    <p className="tool-announcement" role="status">{savedMessage}</p>
    {!nodes.length ? <div className="empty-state tool-empty"><Network size={36} /><h2>从第一道错题开始</h2><p>上传并归档错题，或完成练习批改后，这里会整理真实的知识点记录。</p></div> : <>
      <div className="knowledge-intro"><Lightbulb size={17} /><span>优先级依据错误次数与作业来源；每个作答轮次单独计来源；正确记录只反映该轮作答，不推算掌握率。生成和打印不计入。</span></div>
      <div className="knowledge-subjects" role="group" aria-label="按科目查看知识点">
        {["全部科目", ...subjects].map(item => <button type="button" key={item} aria-pressed={selectedSubject === item} className={selectedSubject === item ? "active" : ""} onClick={() => { setSelectedSubject(item); setSelectedUnit("全部单元"); setSelectedId(""); setOpenUnit(null); setSavedMessage(""); }}>{item}</button>)}
      </div>
      {!subjectNodes.length && <div className="tool-empty"><h2>这个科目还没有知识点记录</h2><p>切换科目，或查看全部科目的错题与练习记录。</p><button type="button" onClick={() => { setSelectedSubject("全部科目"); setSelectedUnit("全部单元"); }}>查看全部科目</button></div>}
      {focus.length > 0 && <section className="knowledge-focus"><div className="section-heading"><div><span className="section-kicker">START HERE</span><h2>先看这些知识点</h2></div><span>按现有记录排序</span></div><div className="knowledge-focus-list">
        {focus.map((node, index) => <button type="button" key={node.id} onClick={() => selectPoint(node, true)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{node.name}</strong><small>{node.subject} · {node.total} 次错误 · {node.sessionCount} 次作业或练习</small><ArrowRight size={16} /></button>)}
      </div></section>}
      {subjectNodes.length > 0 && <div className="knowledge-workspace">
        <section className="knowledge-catalog" aria-label="按单元查看薄弱知识点"><div className="knowledge-catalog-head"><div><span className="section-kicker">UNIT VIEW</span><h2>按单元查找</h2></div><span>{subjectNodes.length} 个知识点</span></div>
          <label className="knowledge-unit-filter">筛选单元<select value={selectedUnit} onChange={event => { setSelectedUnit(event.target.value); setOpenUnit(event.target.value === "全部单元" ? null : event.target.value); setSelectedId(""); }}><option>全部单元</option>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label>
          {units.filter(unit => selectedUnit === "全部单元" || selectedUnit === unit).map(unit => {
            const items = visible.filter(node => unitFor(node) === unit);
            const expanded = openUnit === null ? unit === selectedUnitName : openUnit === unit;
            const shown = Math.min(items.length, visibleByUnit[unit] || 8);
            return <div className="knowledge-unit-group" key={unit}><button type="button" className="knowledge-unit-toggle" aria-expanded={expanded} onClick={() => setOpenUnit(expanded ? "" : unit)}><strong>{unit}</strong><span>{items.length} 个知识点</span><ChevronDown size={17} /></button>
              {expanded && <div className="knowledge-unit-items">{items.slice(0, shown).map(node => <button type="button" key={node.id} className={["knowledge-row", selected?.id === node.id ? "active" : ""].join(" ")} onClick={() => selectPoint(node)}><span className={["knowledge-status-dot", node.priority].join(" ")} /><span className="knowledge-row-main"><strong>{node.name}</strong><small>{node.subject} · {node.sessionCount} 次作业或练习</small></span><span className="knowledge-row-count">{node.total} 次错</span><ArrowRight size={15} /></button>)}
                {shown < items.length && <button type="button" className="knowledge-show-more" onClick={() => setVisibleByUnit(current => ({ ...current, [unit]: shown + 8 }))}>再显示 {Math.min(8, items.length - shown)} 个（共 {items.length} 个）</button>}</div>}
            </div>;
          })}
        </section>
        <aside className="knowledge-detail knowledge-action-detail" ref={detailRef} id="knowledge-point-detail" tabIndex={-1}>
          {selected && <><span className={["knowledge-priority", selected.priority].join(" ")}>{priorityLabel[selected.priority]}</span><h2>{selected.name}</h2><p className="knowledge-detail-subject">{selected.subject} · {selectedUnitName}{!selectedProfile?.unitName && selectedUnitName !== unassigned ? "（根据练习卷推测）" : ""}</p>
            <div className="knowledge-counts"><div><strong>{selected.total}</strong><span>错误记录</span></div><div><strong>{selected.sessionCount}</strong><span>不同作业或练习</span></div><div><strong>{selected.correctCount}</strong><span>练习做对记录</span></div></div>
            <div className="knowledge-unit-editor"><label htmlFor="knowledge-unit-name">确认所属单元</label><div><input id="knowledge-unit-name" list="known-knowledge-units" value={unitDraft} onChange={event => { setSavedMessage(""); setUnitDrafts(current => ({ ...current, [selected.id]: event.target.value })); }} disabled={saving || loadingProfiles || Boolean(profileError)} maxLength={80} placeholder="手动填写单元名称" /><datalist id="known-knowledge-units">{units.filter(name => name !== unassigned).map(name => <option value={name} key={name} />)}</datalist><button type="button" onClick={saveUnit} disabled={saving || loadingProfiles || Boolean(profileError) || unitDraft.trim() === (selectedProfile?.unitName || "")}>{saving ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />}{saving ? "保存中" : "保存归属"}</button></div><small>归属由你确认；留空可归入“待归类”。</small></div>
            <div className="knowledge-guide" aria-busy={generating}><h3><Lightbulb size={17} />先理解概念</h3>{selectedProfile?.guide ? <><strong>核心概念</strong><p><MathText value={selectedProfile.guide.coreIdea} /></p><strong>可能的误区</strong><p><MathText value={selectedProfile.guide.commonMistake} /></p><strong>先做哪一步</strong><p><MathText value={selectedProfile.guide.firstStep} /></p><small>AI 提示仅供学习参考，请结合课本和老师讲解核对。</small></> : <><p>先回想定义与关键步骤，再核对下方错题。需要帮助时可生成概念提示。</p><button type="button" onClick={generateGuide} disabled={generating || loadingProfiles || Boolean(profileError) || trialExpired || aiReady !== true}>{generating ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{generating ? "正在生成概念提示…" : trialExpired ? "体验已到期" : "生成概念提示"}</button>{(trialExpired || aiReady !== true) && <small>{trialExpired ? "可继续阅读已保存内容；请联系管理员开通新生成。" : aiReady === null ? "正在确认 AI 服务状态…" : "AI 服务暂不可用，请稍后重试或联系管理员。"}</small>}</>}</div>
            {relatedMistakes.length > 0 && <div className="knowledge-examples"><h3>相关错题证据</h3>{relatedMistakes.map(item => <button type="button" key={item.id} onClick={() => onOpenMistake(item)}><BookOpen size={16} /><span><MathText value={item.question} /><small>查看原题、答案与解析</small></span><ArrowRight size={14} /></button>)}</div>}
            <section className="knowledge-examples" aria-label="独立作答轮次来源"><h3>作答轮次与来源证据</h3>{selectedRounds.length?selectedRounds.map(r=><details key={r.id}><summary>{r.unitName} · {r.legacy?'历史 grading（无独立轮次）':r.source} · {r.status} · {r.gradingSource||'未评分'} · {new Date(r.completedAt||r.startedAt).toLocaleString('zh-CN')}</summary><p>轮次来源：{r.id}{r.sourceId?` · 原始来源 ${r.sourceId}`:''}</p>{r.questions.map((q,index)=>{
              const grade=r.grading.find(g=>g.index===index);
              if(normalizeKnowledgePoint(grade?.knowledgePoint||q.knowledgePoint||'')!==selected.name)return null;
              return <div key={index}><p><MathText value={q.question}/></p><p>实际作答：<MathText value={r.answers[index]||'未作答'}/></p><p>判定：{grade?.verdict||'未评分'} · {grade?.comment||'无评分结论'}</p></div>;
            })}{r.error&&<p role="alert">{r.error}</p>}<a href={`/?view=practice&paper=${encodeURIComponent(r.paperId)}${r.legacy?'':`&attempt=${encodeURIComponent(r.id)}#attempt-${encodeURIComponent(r.id)}`}`}>打开该卷{r.legacy?'历史报告':'作答轮次'}</a></details>):<p>当前知识点还没有可追溯的作答轮次。</p>}</section>
            <button type="button" className="knowledge-practice-cta" onClick={() => onPractice(selected.subject, selectedUnitName === unassigned ? selected.name : selectedUnitName, selected.name)}><Sparkles size={16} />做 3 题概念小测<ArrowRight size={15} /></button>
          </>}
        </aside>
      </div>}
    </>}
  </div>;
}
