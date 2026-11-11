"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, FileDown, LoaderCircle, Trash2, X } from "lucide-react";
import type { MistakePrintOptions } from "@/lib/mistake-print-options";
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

type PrintItem = { id: string; question: string; subject: string; reflection?: string };

export function PrintSettings({ items, options, onOptions, onItems, onClose, onGenerate, busy, progress, error, download, unsaved, onSaveDrafts, onDiscardDrafts }: {
  items: PrintItem[]; options: MistakePrintOptions; onOptions: (options: MistakePrintOptions) => void;
  onItems: (ids: string[]) => void; onClose: () => void; onGenerate: () => void; busy: boolean;
  progress: string; error: string; download: { url: string; name: string } | null;
  unsaved: number; onSaveDrafts: () => void; onDiscardDrafts: () => void;
}) {
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
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') || [])];
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
        <fieldset disabled={busy} className="printing-options"><legend>打印设置</legend>
          <label>版式<select value={options.template} onChange={event => onOptions({ ...options, template: event.target.value as MistakePrintOptions["template"] })}><option value="paste">错题本剪贴版</option><option value="worksheet">错题练习单</option></select></label>
          <label>正文字号<select value={options.fontSize} onChange={event => onOptions({ ...options, fontSize: Number(event.target.value) as 12 | 14 })}><option value="12">12 pt（标准）</option><option value="14">14 pt（大字）</option></select></label>
          <label className="printing-wide">错因区域<select value={options.reflectionMode} onChange={event => onOptions({ ...options, reflectionMode: event.target.value as MistakePrintOptions["reflectionMode"] })}><option value="saved-or-blank">使用已保存错因，未填写留白 3 行</option><option value="blank">全部留白 3 行，由学生手写</option><option value="saved-plus-blank">已保存错因后，再留白 3 行</option></select></label>
          <label className="printing-check"><input type="checkbox" checked={options.includeAnswers} onChange={event => onOptions({ ...options, includeAnswers: event.target.checked })} />参考答案与解析集中另起页</label>
          <label className="printing-check"><input type="checkbox" checked={options.includeSimilar} onChange={event => onOptions({ ...options, includeSimilar: event.target.checked })} />加入已经生成的举一反三</label>
        </fieldset>
        <p className="printing-note">{options.template === "paste" ? "A4 单栏 · 每题附错因区域与裁剪线" : "A4 练习单 · 保留答题区域"}。版式示意，实际分页以 Word / WPS 为准。原图中的作答和教师批注可能一并打印；整页图片请核对题号及清晰度。</p>
        {unsaved > 0 && <div className="printing-unsaved" role="status"><p>选中的 {unsaved} 道题有未保存的错因，请先处理后再生成。</p><button type="button" onClick={onSaveDrafts} disabled={busy}>保存这些错因</button><button type="button" onClick={onDiscardDrafts} disabled={busy}>放弃这些更改</button></div>}
        <section className="printing-order" aria-label="打印题目顺序"><h3>题目与顺序</h3>{items.length ? <ol>{items.map((item, index) => <li key={item.id}><div><span>{index + 1}. {item.subject}</span><p>{item.question}</p></div><div className="printing-order-actions"><button type="button" aria-label={`上移第 ${index + 1} 题`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button><button type="button" aria-label={`下移第 ${index + 1} 题`} disabled={busy || index === items.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button><button type="button" aria-label={`移除第 ${index + 1} 题`} disabled={busy} onClick={() => onItems(items.filter(value => value.id !== item.id).map(value => value.id))}><Trash2 size={16} /></button></div></li>)}</ol> : <p>没有选择题目，请关闭面板后重新选择。</p>}</section>
      </div>
      <footer><div aria-live="polite">{error && <p className="printing-error" role="alert">{error}</p>}{progress && <p>{progress}</p>}{download && <a href={download.url} download={download.name} target={download.url.startsWith("blob:") ? undefined : "mistake-word-download"}>再次下载：{download.name}</a>}</div><button type="button" className="printing-generate" onClick={onGenerate} disabled={busy || !items.length || unsaved > 0}>{busy ? <LoaderCircle size={17} className="spin" /> : <FileDown size={17} />}{busy ? "正在处理…" : "生成并下载 Word"}</button></footer>
    </div>
  </div>, document.body);
}
