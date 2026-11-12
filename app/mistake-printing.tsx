"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, FileDown, LoaderCircle, Trash2, X } from "lucide-react";
import { printImageRegion, printImageSegments, requiresPrintImage, type MistakePrintOptions } from "@/lib/mistake-print-options";
import { workspaceDraftPayloadSchema, type WorkspaceDraft, type WorkspaceDraftPayload } from "@/lib/workspace-drafts";
import "./mistake-printing.css";

export type ReflectionDraft = { value: string; saving: boolean; error: string };
export type ReflectionActions = {
  drafts: Record<string, ReflectionDraft>;
  change: (id: string, value: string) => void;
  save: (id: string) => Promise<boolean>;
  discard: (id: string) => void;
  canClose: (id: string) => boolean;
};

export function ReflectionEditor({ id, saved, actions }: { id: string; saved: string; actions: ReflectionActions }) {
  const draft = actions.drafts[id];
  const value = draft?.value ?? saved;
  const dirty = value !== saved;
  const count = Array.from(value.trim()).length;
  return <section className="reflection-editor" aria-label="我的错因">
    <label htmlFor={`reflection-${id}`}>我的错因 <span>请用自己的话反思，和 AI 解题思路分别保存</span></label>
    <textarea id={`reflection-${id}`} value={value} disabled={draft?.saving} rows={3} onChange={event => actions.change(id, event.target.value)} placeholder="例如：漏看了题目条件。请用自己的话说明。" aria-invalid={count > 1000} aria-describedby={`reflection-state-${id}`} />
    <div className="reflection-actions">
      <span id={`reflection-state-${id}`} role="status">{draft?.error || (count > 1000 ? "最多填写 1000 个字符" : draft?.saving ? "正在保存…" : dirty ? "有未保存的更改" : saved ? "已保存" : "未填写，打印时可留白手写")} · {count}/1000</span>
      <div>{dirty && <button type="button" onClick={() => actions.discard(id)} disabled={draft?.saving}>放弃更改</button>}<button type="button" onClick={() => void actions.save(id)} disabled={!dirty || draft?.saving || count > 1000}>{draft?.saving && <LoaderCircle size={14} className="spin" />}保存错因</button></div>
    </div>
  </section>;
}

export type PrintItem = { id: string; question: string; subject: string; reflection?: string;
  uploadId?: string; pageNumber?: number; questionBounds?: number[]; incorrectAnswer?: string; sourceName?: string; visualQuestion?: boolean;
  archiveKind?: "mistake" | "collection"; judgementSource?: string;
  /** Same prepared/cropped image as the exporter, when supplied by the parent. */
  printImage?: { url: string; width: number; height: number; fullPage: boolean };
};

/** Opt-in with a fixed profile ID. Parent owns selection/options and profile-switch remounting. */
export function usePrintWorkspaceDraft({ profileId, items, options, onItems, onOptions, reflections, onReflections }: {
  profileId?: string; items: PrintItem[]; options: MistakePrintOptions;
  onItems: (ids: string[]) => void; onOptions: (options: MistakePrintOptions) => void;
  reflections?: Record<string, string>; onReflections?: (values: Record<string, string>) => void;
}) {
  const [state, setState] = useState<{ ready: boolean; saving: boolean; message: string; pending: WorkspaceDraft | null }>({ ready: false, saving: false, message: "", pending: null });
  const session = useRef({ profileId, version: 0, loaded: false, blocked: false, inflight: false, extra: {} as WorkspaceDraftPayload, last: "", target: "" });
  const current = useRef({ items, options, onItems, onOptions, reflections, onReflections });
  useEffect(() => { current.current = { items, options, onItems, onOptions, reflections, onReflections }; });
  const payloadFor = useCallback((): WorkspaceDraftPayload => ({ ...session.current.extra, schemaVersion: 1,
    print: { itemIds: current.current.items.map(item => item.id), options: current.current.options },
    ...(current.current.reflections ? { reflections: current.current.reflections } : {}),
  }), []);
  const fingerprint = JSON.stringify({ ids: items.map(item => item.id), options, reflections });
  const printFingerprint = JSON.stringify({ ids: items.map(item => item.id), options });
  const loadSequence = useRef(0);
  const apply = useCallback((draft: WorkspaceDraft) => {
    const print = draft.payload.print;
    // Never apply an empty saved list to a nonempty working selection.
    if (!print?.itemIds.length) { setState(s => ({ ...s, message: "服务端清单为空，已保留当前选择", pending: null })); return; }
    session.current.extra = draft.payload;
    session.current.version = draft.version;
    session.current.blocked = false;
    session.current.target = JSON.stringify({ ids: print.itemIds, options: print.options });
    current.current.onItems(print.itemIds);
    current.current.onOptions(print.options);
    if (draft.payload.reflections && current.current.onReflections) current.current.onReflections(draft.payload.reflections);
    setState(s => ({ ...s, pending: null, message: "已恢复服务端草稿，请核对题目与顺序" }));
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!profileId) return;
    const active = session.current;
    if (active.inflight) return;
    const sequence = ++loadSequence.current;
    active.blocked = true;
    setState(s => ({ ...s, ready: false, message: "正在读取服务端草稿…" }));
    const before = JSON.stringify({ ids: current.current.items.map(i => i.id), options: current.current.options });
    try {
      const response = await fetch(`/api/drafts/printing?profileId=${encodeURIComponent(profileId)}`, { cache: "no-store", signal });
      const data = await response.json() as { draft: WorkspaceDraft | null; profileId: string; error?: string };
      if (!response.ok) throw new Error(data.error || "草稿加载失败");
      if (signal?.aborted || session.current !== active || sequence !== loadSequence.current) return;
      if (data.profileId !== profileId) throw new Error("草稿档案不一致，已停止恢复");
      const draft = data.draft;
      if (draft && (!workspaceDraftPayloadSchema.safeParse(draft.payload).success || !Number.isInteger(draft.version) || draft.version < 1 || draft.profileId !== profileId)) throw new Error("草稿格式无效，已保留当前编辑");
      active.version = draft?.version ?? 0; active.loaded = true; active.blocked = false;
      active.extra = draft?.payload ?? { schemaVersion: 1 };
      setState({ ready: true, saving: false, pending: null, message: draft ? "已读取服务端草稿" : "尚无服务端草稿" });
      const unchanged = before === JSON.stringify({ ids: current.current.items.map(i => i.id), options: current.current.options });
      if (draft?.payload.print?.itemIds.length) {
        active.blocked = true;
        if (!current.current.items.length && unchanged) apply(draft);
        else setState(s => ({ ...s, pending: draft, message: "发现服务端草稿，请选择恢复或保留当前清单" }));
      }
    } catch (error) {
      if (signal?.aborted || session.current !== active || sequence !== loadSequence.current) return;
      active.blocked = true;
      setState(s => ({ ...s, ready: false, saving: false, message: error instanceof Error ? error.message : "草稿加载失败，当前编辑仍保留" }));
    }
  }, [profileId, apply]);
  useEffect(() => {
    session.current = { profileId, version: 0, loaded: false, blocked: false, inflight: false, extra: { schemaVersion: 1 }, last: "", target: "" };
    const abort = new AbortController();
    void load(abort.signal);
    return () => { abort.abort(); session.current = { ...session.current, loaded: false, blocked: true, inflight: false }; };
  }, [profileId, load]);
  const save = useCallback(async () => {
    const active = session.current;
    if (!profileId || !active.loaded || active.blocked || active.target || active.inflight) return;
    const payload = payloadFor();
    const serialized = JSON.stringify(payload);
    if (serialized === active.last) return;
    active.inflight = true; setState(s => ({ ...s, saving: true, message: "正在保存打印草稿…" }));
    try {
      const response = await fetch(`/api/drafts/printing?profileId=${encodeURIComponent(profileId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: active.version, payload }) });
      const data = await response.json() as { draft?: WorkspaceDraft; error?: string; profileId?: string };
      if (session.current !== active) return;
      if (!response.ok || !data.draft || data.profileId !== profileId) {
        if (response.status === 409) active.blocked = true;
        throw new Error(data.error || "草稿保存失败");
      }
      active.version = data.draft.version; active.last = serialized; active.extra = payload;
      setState(s => ({ ...s, saving: false, message: `服务端草稿已保存 · 版本 ${active.version}` }));
    } catch (error) {
      active.blocked = true;
      if (session.current === active) setState(s => ({ ...s, saving: false, message: error instanceof Error ? error.message : "草稿保存失败，当前编辑仍保留" }));
    } finally { active.inflight = false; }
  }, [profileId, payloadFor]);
  useEffect(() => {
    const active = session.current;
    if (active.target) {
      if (active.target !== printFingerprint) return; // Wait for controlled parent to echo both callbacks.
      active.target = ""; active.last = JSON.stringify(payloadFor());
    }
    if (!state.ready || state.pending || active.blocked || state.saving || !items.length) return;
    const timeout = setTimeout(() => void save(), 800);
    return () => clearTimeout(timeout);
  }, [fingerprint, printFingerprint, state.ready, state.pending, state.saving, items.length, save, payloadFor]);
  return { ...state, enabled: Boolean(profileId), save, reload: () => void load(),
    restore: () => { if (state.pending) apply(state.pending); },
    keepCurrent: () => { session.current.blocked = false; session.current.last = ""; session.current.target = ""; setState(s => ({ ...s, pending: null, message: "已保留当前清单，稍后保存" })); },
  };
}

function PrintImagePreview({ item, options, index }: { item: PrintItem; options: MistakePrintOptions; index: number }) {
  const [attempt, setAttempt] = useState(0);
  const [imageState, setImageState] = useState<{ url: string; attempt: number; width: number; height: number; error: string } | null>(null);
  const needsImage = Boolean(item.printImage) || requiresPrintImage(item);
  const url = item.printImage?.url ?? (item.uploadId && item.pageNumber ? `/api/uploads/${encodeURIComponent(item.uploadId)}/pages/${item.pageNumber}` : "");
  useEffect(() => {
    if (!needsImage || !url) return;
    const image = new Image(); let active = true;
    image.onload = () => { if (active) setImageState({ url, attempt, width: image.naturalWidth, height: image.naturalHeight, error: "" }); };
    image.onerror = () => { if (active) setImageState({ url, attempt, width: 0, height: 0, error: "原图读取或解码失败，可能是网络连接中断、图片暂不可用或登录状态变化；浏览器未提供具体原因。" }); }; image.src = url;
    return () => { active = false; };
  }, [url, needsImage, attempt]);
  if (!needsImage) return <p>本题以可编辑文字打印；文字分页由 Word / WPS 排版。</p>;
  if (!url) return <p className="printing-error">原图预览不可用：缺少原图地址或上传页码，无法核验图片尺寸。</p>;
  const loaded = imageState?.url === url && imageState.attempt === attempt ? imageState : null;
  if (loaded?.error) return <div className="printing-error" role="status"><p>第 {index + 1} 题预览失败：{loaded.error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试读取原图</button></div>;
  const source = loaded ? item.printImage ?? loaded : null;
  if (!source) return <p role="status">正在读取原图尺寸…</p>;
  const region = printImageRegion(source.width, source.height, item.printImage && !item.printImage.fullPage ? undefined : item.questionBounds);
  let segments;
  try { segments = printImageSegments(region.width, region.height, options); }
  catch { return <p className="printing-error">图片尺寸无效或过长，请分开整理。</p>; }
  const regionWidth = 1 - (region.left + region.right) / 100000;
  const regionHeight = 1 - (region.top + region.bottom) / 100000;
  const scale = 2; // Consistent miniature physical scale; labels carry actual mm.
  return <div className="printing-image-preview"><p>第 {index + 1} 题原图：{segments[0].widthMm} × {(region.height / region.width * segments[0].widthMm).toFixed(1)} mm · {segments.length} 段{regionWidth === 1 && regionHeight === 1 ? " · 整页原图，请核对题号" : " · 已按题框裁剪"}</p>
    <div className="printing-pages">{segments.map((segment, part) => <figure key={part} className="printing-page" style={{ width: 210 * scale, minHeight: 297 * scale, padding: 20 * scale }}>
      <figcaption>{segments.length > 1 ? `强制另起页 · 图片分段 ${part + 1}/${segments.length}` : "图片尺寸预览 · 不代表整题自动分页"}<br />{segment.widthMm} × {segment.heightMm.toFixed(1)} mm</figcaption>
      <div className="printing-image-window" style={{ width: segment.widthMm * scale, height: segment.heightMm * scale }}>
        {/* Native img avoids re-encoding the authenticated source. Same srcRect coordinates as Word. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`第 ${index + 1} 题图片，第 ${part + 1} 段`} style={{ width: segment.widthMm * scale / regionWidth, height: source.height / source.width * segment.widthMm * scale / regionWidth,
          left: -region.left / 100000 * segment.widthMm * scale / regionWidth,
          top: -(region.top / 100000 + regionHeight * segment.top / 100000) * source.height / source.width * segment.widthMm * scale / regionWidth }} />
      </div><div className="printing-page-bottom">A4 纸张边界 · 四周 20 mm 留白</div>
    </figure>)}</div>
  </div>;
}

export function PrintSettings({ items, options, onOptions, onItems, onClose, onGenerate, busy, progress, error, download, unsaved, onSaveDrafts, onDiscardDrafts, draftProfileId, reflectionDraftValues, onRestoreReflectionDrafts, draftController }: {
  items: PrintItem[]; options: MistakePrintOptions; onOptions: (options: MistakePrintOptions) => void;
  onItems: (ids: string[]) => void; onClose: () => void; onGenerate: () => void; busy: boolean;
  progress: string; error: string; download: { url: string; name: string } | null;
  unsaved: number; onSaveDrafts: () => void; onDiscardDrafts: () => void;
  draftController?: ReturnType<typeof usePrintWorkspaceDraft>;
  draftProfileId?: string; reflectionDraftValues?: Record<string, string>; onRestoreReflectionDrafts?: (values: Record<string, string>) => void;
}) {
  const internalDraft = usePrintWorkspaceDraft({ profileId: draftController ? undefined : draftProfileId, items, options, onItems, onOptions,
    reflections: reflectionDraftValues, onReflections: onRestoreReflectionDrafts });
  const workspaceDraft = draftController ?? internalDraft;
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeAction = useRef(onClose);
  const isBusy = useRef(busy);
  useEffect(() => { closeAction.current = onClose; isBusy.current = busy; }, [onClose, busy]);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!isBusy.current) closeAction.current(); }
      if (event.key !== "Tab") return;
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('summary, button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') || [])];
      if (!elements.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements[elements.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) { event.preventDefault(); elements[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, []);
  function move(index: number, offset: number) {
    const ids = items.map(item => item.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    onItems(ids);
  }
  return createPortal(<div className="printing-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={panel} className="printing-panel" role="dialog" aria-modal="true" aria-labelledby="printing-title" aria-busy={busy}>
      <header><div><h2 id="printing-title">整理与打印</h2><p>共 {items.length} 道错题 · 下载 Word 后，用 Word / WPS 打印</p></div><button ref={closeButton} type="button" aria-label="关闭打印设置" onClick={onClose} disabled={busy}><X size={20} /></button></header>
      <div className="printing-body">
        {workspaceDraft.enabled && <section className="printing-draft" aria-label="服务端打印草稿"><p role="status">{workspaceDraft.message}</p>
          {workspaceDraft.pending && <><button type="button" disabled={busy || workspaceDraft.saving} onClick={workspaceDraft.restore}>恢复服务端清单与设置</button><button type="button" disabled={busy || workspaceDraft.saving} onClick={workspaceDraft.keepCurrent}>保留当前清单</button></>}
          <button type="button" disabled={busy || workspaceDraft.saving} onClick={workspaceDraft.reload}>重新加载草稿</button>
          <button type="button" disabled={busy || !workspaceDraft.ready || workspaceDraft.saving || Boolean(workspaceDraft.pending)} onClick={() => void workspaceDraft.save()}>保存当前草稿</button>
        </section>}
        <fieldset disabled={busy} className="printing-options"><legend>打印设置</legend>
          <label>版式<select value={options.template} onChange={event => onOptions({ ...options, template: event.target.value as MistakePrintOptions["template"] })}><option value="paste">错题本剪贴版</option><option value="worksheet">错题练习单</option></select></label>
          <label>正文字号<select value={options.fontSize} onChange={event => onOptions({ ...options, fontSize: Number(event.target.value) as 12 | 14 })}><option value="12">12 pt（标准）</option><option value="14">14 pt（大字）</option></select></label>
          <label>原图打印宽度（mm）<input type="number" min="60" max="165" step="0.1" value={options.imageWidthMm ?? 160} onChange={event => { const width = Number(event.target.value); if (width >= 60 && width <= 165) onOptions({ ...options, imageWidthMm: Math.round(width * 10) / 10 }); }} /><span>只改变图内字的物理大小，长图按最多 220 mm 高分段</span></label>
          <label className="printing-wide">错因区域<select value={options.reflectionMode} onChange={event => onOptions({ ...options, reflectionMode: event.target.value as MistakePrintOptions["reflectionMode"] })}><option value="saved-or-blank">使用已保存错因，未填写留白 3 行</option><option value="blank">全部留白 3 行，由学生手写</option><option value="saved-plus-blank">已保存错因后，再留白 3 行</option></select></label>
          <label className="printing-check"><input type="checkbox" checked={options.includeAnswers} onChange={event => onOptions({ ...options, includeAnswers: event.target.checked })} />参考答案与解析集中另起页</label>
          <label className="printing-check"><input type="checkbox" checked={options.includeSimilar} onChange={event => onOptions({ ...options, includeSimilar: event.target.checked })} />加入已经生成的举一反三</label>
        </fieldset>
        <p className="printing-note">{options.template === "paste" ? "A4 单栏 · 每题附错因区域与裁剪线" : "A4 练习单 · 保留答题区域"}。版式示意，实际分页以 Word / WPS 为准。原图中的作答和教师批注可能一并打印；整页图片请核对题号及清晰度。</p>
        {unsaved > 0 && <div className="printing-unsaved" role="status"><p>选中的 {unsaved} 道题有未保存的错因，请先处理后再生成。</p><button type="button" onClick={onSaveDrafts} disabled={busy}>保存这些错因</button><button type="button" onClick={onDiscardDrafts} disabled={busy}>放弃这些更改</button></div>}
        <details className="printing-preview"><summary>预览原图尺寸、分段与分页边界</summary>
          <p>图片按所选宽度等比打印，不缩成单页。长图每段强制另起页，下方 A4 框显示该段边界。题干、错因、类似题及短图会自然流动，完整文档的实际页码和自动分页须在下载后使用 Word / WPS 打印预览核对。参考答案{options.includeAnswers ? "集中强制另起页" : "不打印"}。</p>
          {items.map((item, index) => <PrintImagePreview key={item.id} item={item} options={options} index={index} />)}
        </details>
        <section className="printing-order" aria-label="打印题目顺序"><h3>题目与顺序</h3>{items.length ? <ol>{items.map((item, index) => <li key={item.id}><div><span>{index + 1}. {item.subject}</span><p>{item.question}</p></div><div className="printing-order-actions"><button type="button" aria-label={`上移第 ${index + 1} 题`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`下移第 ${index + 1} 题`} disabled={busy || index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button><button type="button" aria-label={`移除第 ${index + 1} 题`} disabled={busy} onClick={() => onItems(items.filter(value => value.id !== item.id).map(value => value.id))}><Trash2 size={16} /></button></div></li>)}</ol> : <p>没有选择题目，请关闭面板后重新选择。</p>}</section>
      </div>
      <footer><div aria-live="polite">{error && <p className="printing-error" role="alert">{error}</p>}{progress && <p>{progress}</p>}{download && <a href={download.url} download={download.name} target={download.url.startsWith("blob:") ? undefined : "mistake-word-download"}>再次下载：{download.name}</a>}</div><button type="button" className="printing-generate" onClick={onGenerate} disabled={busy || !items.length || unsaved > 0}>{busy ? <LoaderCircle size={17} className="spin" /> : <FileDown size={17} />}{busy ? "正在处理…" : "生成并下载 Word"}</button></footer>
    </div>
  </div>, document.body);
}
