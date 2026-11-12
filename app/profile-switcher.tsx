"use client";

import { useEffect, useState } from "react";
import type { LearningProfile } from "@/lib/profiles";

/** Mount in the workspace shell. Parent can persist drafts before allowing a switch. */
export default function ProfileSwitcher({ beforeSwitch }: { beforeSwitch?: () => boolean | Promise<boolean> }) {
  const [profiles, setProfiles] = useState<LearningProfile[]>([]);
  const [current, setCurrent] = useState("");
  const [name, setName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [editing, setEditing] = useState(false);
  const [managing,setManaging]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/profiles", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { error?: string; profiles: LearningProfile[]; currentProfileId?: string; profile: LearningProfile };
      if (!response.ok) throw new Error(data.error || "档案加载失败");
      if (active) { setProfiles(data.profiles); setCurrent(data.currentProfileId || ""); }
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);

  async function select(profileId: string) {
    if (!profileId || profileId === current || busy) return;
    if (beforeSwitch ? !await beforeSwitch() : !window.confirm("切换学习档案将重新加载页面。请先保存当前未保存的内容，是否继续？")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/profiles/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId }) });
      const data = await response.json() as { error?: string; profiles: LearningProfile[]; currentProfileId?: string; profile: LearningProfile };
      if (!response.ok) throw new Error(data.error || "切换失败");
      localStorage.setItem('shiti-profile-changed',JSON.stringify({profileId,at:Date.now()}));
      // Drop old record links and all React state. Request-owned tasks retain
      // their captured profile; the new page never renders the old results.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Profile changes must discard all cached React state.
      window.location.assign("/");
    } catch (error) { setError(error instanceof Error ? error.message : "切换失败"); setBusy(false); }
  }

  async function save(edit: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch(edit ? `/api/profiles/${encodeURIComponent(current)}` : "/api/profiles", {
        method: edit ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, gradeLevel }),
      });
      const data = await response.json() as { error?: string; profiles: LearningProfile[]; currentProfileId?: string; profile: LearningProfile };
      if (!response.ok) throw new Error(data.error || "保存失败");
      setProfiles(previous => edit ? previous.map(item => item.id === current ? data.profile : item) : [...previous, data.profile]);
      setName(""); setGradeLevel(""); setEditing(false);
    } catch (error) { setError(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  return <section aria-label="学习档案" className="profile-switcher">
    <label>当前学习档案 <select aria-label="选择学习档案" disabled={busy} value={current} onChange={event => void select(event.target.value)}>
      {!current && <option value="">请选择档案</option>}
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.gradeLevel ? ` · ${profile.gradeLevel}` : ""}</option>)}
    </select></label>
    <button type="button" onClick={()=>setManaging(v=>!v)}>{managing?'收起档案管理':'管理档案'}</button>
    {managing&&<><button type="button" disabled={busy || !current} onClick={() => {
      const profile = profiles.find(item => item.id === current);
      if (profile) { setEditing(true); setName(profile.name); setGradeLevel(profile.gradeLevel); }
    }}>编辑当前档案</button>
    <form onSubmit={event => { event.preventDefault(); void save(editing); }}>
      <input aria-label="档案名称" placeholder="孩子的档案名称" value={name} maxLength={40} required onChange={event => setName(event.target.value)} />
      <input aria-label="年级" placeholder="年级（选填）" value={gradeLevel} maxLength={30} onChange={event => setGradeLevel(event.target.value)} />
      <button disabled={busy || !name.trim()} type="submit">{editing ? "保存档案" : "新增档案"}</button>
      {editing && <button type="button" disabled={busy} onClick={() => { setEditing(false); setName(""); setGradeLevel(""); }}>取消</button>}
    </form>
    <small>资料按当前档案保存；新增后请选择该档案。</small>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
