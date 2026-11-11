"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- vinext beta 当前 next/link 点击崩溃，使用整页导航。 */

import { ArrowRight, BookOpen, Check, CheckCircle2, Crown, HelpCircle, ShieldCheck, Sparkles } from "lucide-react";
import type { ChatGPTUser } from "../chatgpt-auth";
import { isTrialExpired, isAccessExpired } from "@/lib/trial";
import styles from "./pricing.module.css";

type PricingProps = { user: ChatGPTUser | null };

const learningFeatures = [
  "拍照批改与错题提取，一次最多 4 张图片",
  "逐题查看参考答案、解题思路与知识点",
  "围绕错题生成举一反三练习",
  "按科目与日期整理错题，回顾知识图谱",
  "单元练习卷生成、在线作答与批改",
  "Word 练习卷导出与英语作文批改",
];

const comparison = [
  ["使用期限", "注册后 7 天", "每次购买增加 30 天"],
  ["拍照批改与解析", "体验期内可用", "会员有效期内可用"],
  ["类似题与单元练习", "体验期内可用", "会员有效期内可用"],
  ["知识图谱与作文批改", "体验期内可用", "会员有效期内可用"],
  ["Word 练习卷导出", "体验期内可用", "会员有效期内可用"],
  ["到期后查看已有错题", "支持", "支持"],
];

const faqs = [
  { question: "7 天体验结束后，已有错题还能看吗？", answer: "可以。到期后仍可查看账号下已保存的错题、答案和解析。继续新增拍照批改、生成练习与使用智能分析，需要开通 VIP。" },
  { question: "体验版和 VIP 的区别是什么？", answer: "新用户注册可体验 7 天，先用自己的题目了解识别与分析效果。VIP 每次购买增加 30 天使用权限，适合需要持续批改和练习的同学。" },
  { question: "如何付款，付款后何时开通？", answer: "在收银页创建订单并使用支付宝付款。系统收到并核对支付通知后自动开通，结果页会查询确认状态。目前建议使用电脑浏览器付款；手机唤起支付仍在完善中。" },
  { question: "付款后还显示待确认怎么办？", answer: "请保留订单号，稍后在收银页查看同一笔订单的状态，避免重复创建订单付款。如长时间未确认，请联系管理员协助核对。" },
  { question: "可以在手机、平板和电脑上使用吗？", answer: "可以使用浏览器登录同一账号，在手机上传图片，在平板或电脑查看错题与练习。付费操作建议使用电脑浏览器完成。" },
  { question: "智能批改的结果需要核对吗？", answer: "需要。图片清晰度、题目完整度和作答格式都会影响识别。请认真核对题目、答案与分析，重要结论结合老师讲解和教材确认。" },
];

export default function PricingContent({ user }: PricingProps) {
  const isLongTerm = user ? user.role === "admin" || user.trialEndsAt === null : false;
  const isPaid = user ? !!user.paidEndsAt && !isTrialExpired(user.paidEndsAt) : false;
  const isVIP = isLongTerm || isPaid;
  const isTrial = user ? !isVIP && !isAccessExpired(user.trialEndsAt, user.paidEndsAt) : false;
  const isExpired = user ? !isVIP && isAccessExpired(user.trialEndsAt, user.paidEndsAt) : false;

  return <div className={styles.page}>
    <a className={styles.skipLink} href="#pricing-main">跳至会员方案</a>
    <header className={styles.header}>
      <a className={styles.brand} href="/" aria-label="拾题首页"><span className={styles.brandMark}><BookOpen size={23} aria-hidden="true" /></span><strong>拾题</strong><small>智能错题本</small></a>
      <nav className={styles.nav} aria-label="会员页面导航">
        <a className={styles.faqLink} href="#faq">常见问题</a>
        {user ? <><span className={styles.userChip} title={user.displayName}>{isVIP ? <Crown size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}<span>{user.displayName}{isVIP && " · VIP"}</span></span><a className={styles.navCta} href="/">学习空间 <ArrowRight size={14} aria-hidden="true" /></a></> : <><a href="/login?return_to=%2Fpricing">登录</a><a className={styles.navCta} href="/register?return_to=%2Fpricing">免费体验 <ArrowRight size={14} aria-hidden="true" /></a></>}
      </nav>
    </header>
    <main id="pricing-main" className={styles.main}>
      <section className={styles.hero} aria-labelledby="pricing-title">
        <span className={styles.kicker}><Crown size={15} aria-hidden="true" />拾题会员方案</span>
        <h1 id="pricing-title">先体验，再为持续学习选择。</h1>
        <p>新用户免费体验 7 天。需要继续批改与练习时，<br className={styles.desktopBreak} />可按需购买 ¥99 / 30 天的 VIP 会员。</p>
        {user && <div className={`${styles.status} ${isExpired ? styles.expired : isVIP ? styles.vip : ""}`} role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>
          {isLongTerm ? "你当前拥有长期使用权限，可直接进入学习空间。" : isPaid ? `VIP 有效期至 ${new Date(user.paidEndsAt!).toLocaleString("zh-CN")}，可前往收银页续费。` : isTrial ? `你正在免费体验中，截止 ${new Date(user.trialEndsAt!).toLocaleString("zh-CN")}。购买月卡可增加 30 天使用权限。` : "你的使用权限已到期。已有错题仍可查看，开通 VIP 后可继续批改与生成练习。"}
        </span></div>}
      </section>
      <section className={styles.planGrid} aria-label="会员方案对比">
        <article className={styles.card}>
          <div className={styles.cardHead}><span className={styles.planLabel}>先用自己的题目试一试</span><h2>新用户体验</h2><p>适合初次使用，了解拍照识别与批改流程。</p><div className={styles.price}><span>¥</span><strong>0</strong><small>/ 7 天</small></div><span className={styles.priceNote}>新用户注册即可开始</span></div>
          <div className={styles.cardBody}><h3>体验期内可使用</h3><ul className={styles.featureList}>{learningFeatures.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
            <div className={styles.cardAction}>
              {isVIP ? <button className={styles.secondaryCta} type="button" disabled><CheckCircle2 size={16} aria-hidden="true" />已拥有 VIP 权限</button> : isTrial ? <button className={styles.secondaryCta} type="button" disabled><CheckCircle2 size={16} aria-hidden="true" />当前正在体验中</button> : user ? <a className={styles.secondaryCta} href="/payment">体验已结束 · 升级 VIP <ArrowRight size={16} aria-hidden="true" /></a> : <a className={styles.secondaryCta} href="/register?return_to=%2Fpricing">免费注册体验 <ArrowRight size={16} aria-hidden="true" /></a>}
              <p>体验到期后，已有错题仍可查看。</p>
            </div>
          </div>
        </article>
        <article className={`${styles.card} ${styles.featured}`}>
          <div className={styles.cardHead}><span className={styles.planLabel}><Crown size={14} aria-hidden="true" />适合持续批改与巩固</span><h2>VIP 畅学会员</h2><p>把日常作业、试卷订正与针对性练习接起来。</p><div className={styles.price}><span>¥</span><strong>99</strong><small>/ 30 天</small></div><span className={styles.priceNote}>按需购买 · 可在收银页续费</span></div>
          <div className={styles.cardBody}><h3>会员有效期内可使用</h3><ul className={styles.featureList}>{learningFeatures.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
            <div className={styles.cardAction}>
              {isLongTerm ? <button className={styles.primaryCta} type="button" disabled><CheckCircle2 size={16} aria-hidden="true" />长期使用权限已生效</button> : <a className={styles.primaryCta} href="/payment"><Crown size={16} aria-hidden="true" />{isPaid ? "续费 VIP" : "开通 VIP"} · ¥99 / 30 天 <ArrowRight size={16} aria-hidden="true" /></a>}
              <p>前往收银页确认订单与支付金额。</p>
            </div>
          </div>
        </article>
      </section>
      <p className={styles.paymentNote}><ShieldCheck size={16} aria-hidden="true" />支付建议使用电脑浏览器。已有待确认订单时，请先查看订单状态。</p>
      <section className={styles.comparisonSection} aria-labelledby="comparison-title">
        <div className={styles.sectionHeading}><span>一目了然</span><h2 id="comparison-title">功能与使用期限</h2><p>先体验实际效果，再根据学习安排决定是否继续。</p></div>
        <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="会员权益对比表，窄屏可左右滚动"><table className={styles.table}><caption>新用户体验与 VIP 会员权益对比</caption><thead><tr><th scope="col">功能与权益</th><th scope="col">7 天体验</th><th scope="col">VIP · ¥99 / 30 天</th></tr></thead><tbody>{comparison.map(([feature, trial, vip]) => <tr key={feature}><th scope="row">{feature}</th><td>{trial}</td><td>{vip}</td></tr>)}</tbody></table></div>
        <p className={styles.tableHint}>小屏幕可左右滑动表格查看完整内容。</p>
      </section>
      <section id="faq" className={styles.faqSection} aria-labelledby="faq-title"><div className={styles.sectionHeading}><span>购买前了解清楚</span><h2 id="faq-title">常见问题</h2></div><div className={styles.faqGrid}>{faqs.map(({ question, answer }) => <details key={question} className={styles.faqCard}><summary><HelpCircle size={18} aria-hidden="true" /><span>{question}</span><span className={styles.faqToggle} aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
      <section className={styles.bottom}><div><span>让每一次订正都有积累</span><h2>{user ? "回到学习，接着进步。" : "从第一份作业开始。"}</h2><p>把错题整理清楚，把不懂的知识点再练一次。</p></div>{user ? <a className={styles.primaryCta} href={isLongTerm ? "/" : "/payment"}>{isLongTerm ? "进入学习空间" : isPaid ? "续费 VIP 会员" : "开通 VIP 会员"}<ArrowRight size={16} aria-hidden="true" /></a> : <a className={styles.primaryCta} href="/register?return_to=%2Fpricing">免费注册，体验 7 天 <ArrowRight size={16} aria-hidden="true" /></a>}</section>
    </main>
    <footer className={styles.footer}><span>拾题 · 把每一次错误，变成进步</span><a href="/">返回首页 <ArrowRight size={14} aria-hidden="true" /></a></footer>
  </div>;
}
