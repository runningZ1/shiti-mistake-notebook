"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- vinext beta 当前 next/link 点击崩溃，使用整页导航。 */

import { useState, type FormEvent } from "react";
import { ArrowRight, BookOpen, LoaderCircle } from "lucide-react";
import styles from "./auth.module.css";

export default function LoginForm({ returnTo }: { returnTo: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      // nginx 限流返回的是 HTML，解析失败要兜住，否则会把 SyntaxError 抛给用户
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(
          data.error ||
            (response.status === 429 ? "尝试次数过多，请稍后再试" : "登录失败，请重试"),
        );
      }

      // 整页跳转而不是 router.push：要让服务端重新读一次 cookie 再渲染，
      // 否则会先闪一下未登录状态。
      window.location.href = returnTo;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "登录失败，请重试");
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
        <aside className={styles.intro} aria-label="学习提示">
          <span className={styles.eyebrow}>每一次订正，都是进步</span>
          <h2>让错题有归处，<br />让复习有方向。</h2>
          <p>从一道题的答案，找到一类题的思路。回到你的学习空间，接着上一次的积累继续学。</p>
          <ol><li><span>01</span>拍清题目与作答</li><li><span>02</span>核对答案与解题思路</li><li><span>03</span>回顾知识点，再练一次</li></ol>
        </aside>
        <section className={styles.card} aria-labelledby="login-title">
          <span className={styles.eyebrow}>登录你的账号</span>
          <h1 id="login-title">欢迎回来</h1>
          <p className={styles.subtitle}>登录后继续整理你的错题本。</p>
          <form className={styles.form} onSubmit={submit} aria-busy={pending}>
            <label htmlFor="login-username"><span>用户名</span><input id="login-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={pending} aria-describedby={error ? "login-error" : undefined} /></label>
            <label htmlFor="login-password"><span>密码</span><input id="login-password" name="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required disabled={pending} aria-describedby={error ? "login-error" : undefined} /></label>
            {error && <div id="login-error" className={styles.error} role="alert">{error}</div>}
            <button type="submit" className={styles.submit} disabled={pending || !username || !password}>
              {pending ? <><LoaderCircle size={17} className={styles.spin} aria-hidden="true" />正在登录…</> : <>进入学习空间 <ArrowRight size={16} aria-hidden="true" /></>}
            </button>
          </form>
          <p className={styles.switch}>还没有账号？<a href={`/register?return_to=${encodeURIComponent(returnTo)}`}>立即注册</a></p>
          <p className={styles.footnote}>登录状态保留 30 天。忘记密码请联系管理员重置。</p>
        </section>
      </main>
    </div>
  );
}
