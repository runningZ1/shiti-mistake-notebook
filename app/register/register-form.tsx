"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- vinext beta 当前 next/link 点击崩溃，使用整页导航。 */

import { useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, LoaderCircle } from "lucide-react";
import styles from "../login/auth.module.css";

export default function RegisterForm({ returnTo }: { returnTo: string }) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [wechat, setWechat] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const mismatched = confirm.length > 0 && confirm !== password;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    // 确认密码只在前端比对，后端根本不收这个字段 —— 它防的是打错字，不是攻击。
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }

    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, displayName, wechat }),
      });
      // nginx 限流返回的是 HTML，解析失败要兜住，否则会把 SyntaxError 抛给用户
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(
          data.error ||
            (response.status === 429 ? "操作太频繁，请稍后再试" : "注册失败，请重试"),
        );
      }

      // 整页跳转而不是 router.push：要让服务端重新读一次 cookie 再渲染，
      // 否则会先闪一下未登录状态。
      window.location.href = returnTo;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "注册失败，请重试");
      setPending(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <a className={styles.brand} href="/" aria-label="拾题首页"><span className={styles.brandMark}><BookOpen size={23} aria-hidden="true" /></span><strong>拾题</strong><small>智能错题本</small></a>
        <a className={styles.backLink} href="/">返回首页 <ArrowRight size={14} aria-hidden="true" /></a>
      </header>
      <main className={styles.layout}>
        <aside className={styles.intro} aria-label="新用户体验说明">
          <span className={styles.eyebrow}>从第一道错题开始</span>
          <h2>给认真学习，<br />一个清晰的开始。</h2>
          <p>新用户注册即可免费体验 7 天。拍照批改、整理错题，再用练习检验自己的进步。</p>
          <ol><li><span>01</span>创建个人学习账号</li><li><span>02</span>上传手边的一份作业</li><li><span>03</span>开始积累自己的错题本</li></ol>
          <a className={styles.introLink} href="/pricing">查看会员方案与体验说明 <ArrowRight size={15} aria-hidden="true" /></a>
        </aside>
        <section className={styles.card} aria-labelledby="register-title">
          <span className={styles.eyebrow}>新用户免费体验 7 天</span>
          <h1 id="register-title">创建账号</h1>
          <p className={styles.subtitle}>体验到期后，仍可查看已有错题。</p>
          <form className={styles.form} onSubmit={submit} aria-busy={pending}>
            <label htmlFor="register-username"><span>用户名 <small>必填</small></span><input id="register-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} maxLength={32} pattern="[a-zA-Z0-9_\-]{3,32}" required disabled={pending} aria-describedby="username-hint" /><small id="username-hint" className={styles.hint}>3–32 位字母、数字、下划线或短横线，字母不区分大小写。</small></label>
            <label htmlFor="register-name"><span>昵称 <small>选填</small></span><input id="register-name" name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" maxLength={24} placeholder="留空则使用用户名" disabled={pending} /></label>
            <label htmlFor="register-wechat"><span>微信号 <small>必填</small></span><input id="register-wechat" name="wechat" value={wechat} onChange={(event) => setWechat(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={40} required disabled={pending} aria-describedby="wechat-hint" /><small id="wechat-hint" className={styles.hint}>填写微信号或绑定微信的手机号，供管理员联系你。</small></label>
            <label htmlFor="register-password"><span>密码 <small>必填</small></span><input id="register-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending} aria-describedby="password-hint" /><small id="password-hint" className={styles.hint}>8–128 位，请使用容易记住且不与其他账号重复的密码。</small></label>
            <label htmlFor="register-confirm"><span>确认密码 <small>必填</small></span><input id="register-confirm" name="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending} aria-invalid={mismatched || undefined} aria-describedby={mismatched ? "confirm-hint" : undefined} />{mismatched && <small id="confirm-hint" className={styles.fieldError} role="status">两次输入的密码不一致，请重新核对。</small>}</label>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <button type="submit" className={styles.submit} disabled={pending || !username || !wechat.trim() || !password || !confirm || mismatched}>
              {pending ? <><LoaderCircle size={17} className={styles.spin} aria-hidden="true" />正在创建…</> : <>创建并进入学习空间 <ArrowRight size={16} aria-hidden="true" /></>}
            </button>
          </form>
          <p className={styles.switch}>已经有账号？<a href={`/login?return_to=${encodeURIComponent(returnTo)}`}>返回登录</a></p>
          <p className={styles.footnote}>请妥善记住用户名和密码。忘记密码请联系管理员重置。</p>
        </section>
      </main>
    </div>
  );
}
