/* eslint-disable @next/next/no-html-link-for-pages -- vinext beta 当前 next/link 点击崩溃，使用整页导航。 */
import { ArrowRight, BookOpen, Camera, CheckCircle2, ClipboardList, Network, PenLine, ShieldCheck, Sparkles } from "lucide-react";
import styles from "./landing.module.css";

const features = [
  { icon: Camera, title: "拍照就能开始", description: "上传试卷、作业或答题卷，一次最多 4 张图片。拍清题目与作答，方便逐题核对。" },
  { icon: CheckCircle2, title: "逐题批改分析", description: "结合已有批改或智能判题，查看对错、正确答案与分步思路，不清楚的题留待核对。" },
  { icon: BookOpen, title: "错题归档练习", description: "按科目与时间整理个人错题，围绕同一知识点生成举一反三练习。" },
  { icon: Network, title: "知识图谱", description: "从错题中梳理知识点，了解反复出错的内容，安排下一步复习。" },
  { icon: ClipboardList, title: "单元练习卷", description: "输入单元名称生成练习，支持在线作答与批改，也能下载附解析的 Word 试卷。" },
  { icon: PenLine, title: "英语作文批改", description: "上传作文图片，查看拼写、语法和表达建议，结合润色内容逐句学习。" },
];

export default function Landing() {
  return <div className={styles.page}>
    <a className={styles.skipLink} href="#landing-main">跳至主要内容</a>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="拾题首页"><span className={styles.brandMark}><BookOpen size={23} aria-hidden="true" /></span><strong>拾题</strong><small>智能错题本</small></a>
      <nav className={styles.nav} aria-label="首页导航"><a className={styles.sectionLink} href="#how-it-works">使用方法</a><a className={styles.sectionLink} href="#features">功能介绍</a><a className={styles.pricingLink} href="/pricing">会员方案</a><a href="/login">登录</a><a className={styles.navCta} href="/register">免费体验 <ArrowRight size={15} aria-hidden="true" /></a></nav>
    </header>
    <main id="landing-main" className={styles.main}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroCopy}>
          <span className={styles.offer}><Sparkles size={15} aria-hidden="true" />新用户免费体验 7 天</span>
          <h1 id="landing-title">把作业拍下来，<br /><em>把错题真正弄明白。</em></h1>
          <p>已批改的试卷，帮你找出错题；还没批改的作业，先逐题判定，再整理答案、思路与知识点。</p>
          <div className={styles.heroActions}><a className={styles.primary} href="/register">注册并开始体验 <ArrowRight size={18} aria-hidden="true" /></a><a className={styles.secondary} href="/login">已有账号，去登录</a></div>
          <div className={styles.trust}><span><CheckCircle2 size={15} aria-hidden="true" />注册后即可开始</span><span><ShieldCheck size={15} aria-hidden="true" />个人账号管理错题</span></div>
        </div>
        <aside className={styles.workflow} aria-labelledby="workflow-title">
          <div className={styles.workflowHeading}><span className={styles.eyebrow}>学习流程</span><BookOpen size={22} aria-hidden="true" /></div>
          <h2 id="workflow-title">一份作业，三步整理</h2>
          <p className={styles.workflowIntro}>从上传到复习，知道每一步该做什么。</p>
          <ol className={styles.workflowList}>
            <li><span className={styles.stepNumber}>01</span><div><h3>上传题目与作答</h3><p>选择科目，上传清晰图片，确认批改方式。</p></div><Camera size={20} aria-hidden="true" /></li>
            <li><span className={styles.stepNumber}>02</span><div><h3>核对批改与解析</h3><p>逐题查看结果，结合解题思路订正答案。</p></div><CheckCircle2 size={20} aria-hidden="true" /></li>
            <li><span className={styles.stepNumber}>03</span><div><h3>整理错题，再练一次</h3><p>回顾知识点，用类似题检查是否掌握。</p></div><BookOpen size={20} aria-hidden="true" /></li>
          </ol>
          <div className={styles.workflowNote}><ShieldCheck size={16} aria-hidden="true" /><span>智能分析供学习参考，重要答案请认真核对。</span></div>
        </aside>
      </section>
      <section className={styles.features} id="features" aria-labelledby="features-title"><div className={styles.sectionHeading}><span className={styles.eyebrow}>围绕每一道错题</span><h2 id="features-title">从批改到巩固，一步步理清思路</h2><p>把零散的作业和试卷，整理成可以反复复习的学习资料。</p></div><div className={styles.featureGrid}>
        {features.map(({ icon: Icon, title, description }) => <article key={title}><span className={styles.featureIcon}><Icon size={22} aria-hidden="true" /></span><h3>{title}</h3><p>{description}</p></article>)}
      </div></section>
      <section className={styles.steps} id="how-it-works" aria-labelledby="steps-title"><div className={styles.stepsIntro}><span className={styles.eyebrow}>开始使用</span><h2 id="steps-title">从手边的一份作业开始</h2></div><ol><li><span>01 / 上传</span><strong>拍清题目与作答</strong></li><li><span>02 / 批改</span><strong>核对逐题结果与解析</strong></li><li><span>03 / 巩固</span><strong>回顾错题并继续练习</strong></li></ol></section>
      <section className={styles.bottom}><div><span className={styles.eyebrow}>给认真作答一个好去处</span><h2>先体验，再决定</h2><p>新用户免费体验 7 天。到期后仍可查看已有错题；继续分析和生成练习，可升级 VIP（¥99 / 30 天）。</p></div><div className={styles.bottomActions}><a className={styles.secondary} href="/pricing">查看会员方案</a><a className={styles.primary} href="/register">立即创建账号 <ArrowRight size={18} aria-hidden="true" /></a></div></section>
    </main>
    <footer className={styles.footer}><span>拾题 · 把每一次错误，变成进步</span><a href="/pricing">会员价格与常见问题 <ArrowRight size={14} aria-hidden="true" /></a></footer>
  </div>;
}
