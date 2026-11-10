"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Crown,
  HelpCircle,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { ChatGPTUser } from "../chatgpt-auth";
import { isTrialExpired, isAccessExpired } from "@/lib/trial";

type PricingProps = {
  user: ChatGPTUser | null;
};

export default function PricingContent({ user }: PricingProps) {
  const router = useRouter();
  const isLongTerm = user ? user.role === "admin" || user.trialEndsAt === null : false;
  const isPaid = user ? !!user.paidEndsAt && !isTrialExpired(user.paidEndsAt) : false;
  const isVIP = isLongTerm || isPaid;
  const isTrial = user ? !isVIP && !isAccessExpired(user.trialEndsAt, user.paidEndsAt) : false;
  const isExpired = user ? !isVIP && isAccessExpired(user.trialEndsAt, user.paidEndsAt) : false;
  return (
    <div className="pricing-page">
      {/* 头部导航 */}
      <header className="pricing-header">
        <Link className="pricing-brand" href="/" aria-label="拾题首页">
          <span className="pricing-brand-mark">
            <BookOpen size={22} />
          </span>
          <strong>拾题</strong>
          <small>智能错题本</small>
        </Link>
        <nav className="pricing-header-nav" aria-label="会员页面导航">
          <Link className="pricing-nav-link" href="/#features">
            功能介绍
          </Link>
          <Link className="pricing-nav-link" href="/#how-it-works">
            使用方法
          </Link>
          <a className="pricing-nav-link" href="#faq">
            常见问题
          </a>
          {user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span className="pricing-user-chip">
                {isVIP ? <Crown size={14} color="#7562b8" /> : <Sparkles size={14} />}
                {user.displayName}
                {isVIP && " · VIP"}
              </span>
              <Link className="pricing-nav-cta" href="/">
                进入学习空间 <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <Link className="pricing-nav-link" href="/login">
                登录
              </Link>
              <Link className="pricing-nav-cta" href="/register">
                免费体验 7 天 <ArrowRight size={14} />
              </Link>
            </div>
          )}
        </nav>
      </header>

      <main className="pricing-main">
        {/* Hero 标题区 */}
        <section className="pricing-hero">
          <span className="pricing-kicker">
            <Crown size={15} /> 拾题会员计划 · 专注学习与提分
          </span>
          <h1>
            清晰透明的定价方案，
            <br />
            <em>让每一次错题投入都有所值。</em>
          </h1>
          <p>
            初中与高中全学科通用，支持拍卷批改、变式练习、知识图谱与作文润色。
            <br />
            新用户注册立享 7 天完整体验，按需升级 VIP 畅享全部学科提分利器。
          </p>

          {/* 用户身份状态提示 */}
          {user && (
            <>
              {isVIP && (
                <div className="pricing-status-banner vip" role="status">
                  <CheckCircle2 size={18} />
                  <span>{isLongTerm ? "您当前拥有长期使用权限。" : `您的 VIP 会员有效期至 ${new Date(user!.paidEndsAt!).toLocaleString("zh-CN")}，可前往收银页续费。`}</span>
                </div>
              )}
              {isTrial && (
                <div className="pricing-status-banner trial" role="status">
                  <Sparkles size={18} />
                  <span>
                    您当前正在 7 天免费体验中（截止时间：
                    {new Date(user.trialEndsAt!).toLocaleDateString("zh-CN", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                    ）。购买月卡可增加 30 天使用权限。
                  </span>
                </div>
              )}
              {isExpired && (
                <div className="pricing-status-banner expired" role="status">
                  <Lightbulb size={18} />
                  <span>您的 7 天免费体验已到期。已有错题随时可看，立即开通 VIP 恢复全部智能分析与出卷功能。</span>
                </div>
              )}
            </>
          )}
        </section>

        {/* 核心双档位价格卡片（严格满足用户需求：两个档位，一个免费试用，一个99元/月） */}
        <section className="pricing-grid">
          {/* 档位一：基础体验版 */}
          <article className="pricing-card">
            <div className="pricing-card-head">
              <h2 className="pricing-card-name">基础体验版</h2>
              <p className="pricing-card-desc">
                适合初次体验智能错题本、测试题目识别与智能判题准确率的同学与家长。
              </p>
              <div className="pricing-price-wrap">
                <span className="pricing-currency">¥</span>
                <span className="pricing-amount">0</span>
                <span className="pricing-interval">/ 免费体验 7 天</span>
              </div>
              <span className="pricing-subtag">新用户注册即开通 · 零门槛体验</span>
            </div>

            <div className="pricing-card-body">
              <div className="pricing-features-title">包含功能与权益</div>
              <ul className="pricing-features-list">
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>7 天全功能无门槛试用</strong>（注册后即可开始）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>拍照识别与智能错题提取（一次最多 4 张图片）</span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>逐题判断对错与基础解题思路解析</span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>类似题“举一反三”生成（体验期额度）</span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>错题按科目、日期分类归档</span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>体验到期后已归档错题终身免费查阅</strong>
                  </span>
                </li>
                <li className="unsupported">
                  <span className="pricing-feature-cross">
                    <X size={12} strokeWidth={2.5} />
                  </span>
                  <span>体验期到期后暂停新增拍卷与试卷生成</span>
                </li>
                <li className="unsupported">
                  <span className="pricing-feature-cross">
                    <X size={12} strokeWidth={2.5} />
                  </span>
                  <span>不包含专属学习顾问与一对一技术支持</span>
                </li>
              </ul>

              <div className="pricing-cta-wrap">
                {isVIP ? (
                  <button type="button" className="pricing-cta-button" disabled>
                    已拥有更高级权限 (VIP)
                  </button>
                ) : isTrial ? (
                  <button type="button" className="pricing-cta-button" disabled>
                    当前体验中
                  </button>
                ) : user ? (
                  <button
                    type="button"
                    className="pricing-cta-button"
                    onClick={() => router.push("/payment")}
                  >
                    体验已到期 · 升级 VIP
                  </button>
                ) : (
                  <Link href="/register" className="pricing-cta-button">
                    免费注册体验 7 天 <ArrowRight size={15} />
                  </Link>
                )}
              </div>
            </div>
          </article>

          {/* 档位二：VIP 畅学会员（主推 99元/月） */}
          <article className="pricing-card featured">
            <span className="pricing-ribbon">
              <Sparkles size={12} /> 推荐 · 提分首选
            </span>

            <div className="pricing-card-head">
              <h2 className="pricing-card-name vip">
                <Crown size={22} /> VIP 畅学会员
              </h2>
              <p className="pricing-card-desc">
                适合日常课后巩固、周测月考订正、中高考查漏补缺的提分学员与家长。
              </p>
              <div className="pricing-price-wrap">
                <span className="pricing-currency">¥</span>
                <span className="pricing-amount">99</span>
                <span className="pricing-interval">/ 30天</span>
              </div>
              <span className="pricing-subtag">折合每日仅需 ¥3.3 · 不到一杯奶茶钱</span>
            </div>

            <div className="pricing-card-body">
              <div className="pricing-features-title">VIP 专属全部特权</div>
              <ul className="pricing-features-list">
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>无限次拍照智能批改与作业判题</strong>（支持试卷、练习册多图联评）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>名师级深度解题精讲</strong>（分步推导、易错点剖析、避坑要点）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>无限次举一反三相似题生成</strong>（针对每道错题衍生 1~5 道变式题）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>全学科智能知识图谱</strong>（9大学科高频失分点统计雷达）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>单元练习卷一键组卷与在线批改</strong>（按薄弱知识点靶向强化）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>高清排版 Word 错题卷导出</strong>（带详尽解析，随时打印手写重做）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>英语作文智能精批与润色</strong>（中高考标准评分、句法纠正、文采升级）
                  </span>
                </li>
                <li>
                  <span className="pricing-feature-check">
                    <Check size={12} strokeWidth={3} />
                  </span>
                  <span>
                    <strong>专属学习顾问微信一对一支持</strong>（开通即享专属答疑与贴心售后）
                  </span>
                </li>
              </ul>

              <div className="pricing-cta-wrap">
                {isLongTerm ? (
                  <button type="button" className="pricing-cta-button primary" disabled>
                    <CheckCircle2 size={16} /> 尊贵 VIP 会员特权生效中
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pricing-cta-button primary"
                    onClick={() => router.push("/payment")}
                  >
                    <Crown size={16} /> {isPaid ? "续费 VIP" : "开通 VIP"} · 99元／30天
                  </button>
                )}
              </div>
            </div>
          </article>
        </section>

        {/* 详细权益横向对比表 */}
        <section>
          <div className="pricing-section-title">
            <span>DETAILED COMPARISON</span>
            <h2>核心功能特性详细对比</h2>
          </div>
          <div className="pricing-comparison-wrap">
            <table className="pricing-table">
              <thead>
                <tr>
                  <th>功能权益与服务</th>
                  <th style={{ width: "25%" }}>基础体验版</th>
                  <th className="featured-col" style={{ width: "30%" }}>
                    VIP 畅学会员 (¥99/月)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>使用期限 / 授权时长</strong>
                    <small>账号使用权限有效期</small>
                  </td>
                  <td>7 天</td>
                  <td>
                    <strong>30 天 / 按月订阅（可随心续费）</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>拍照识别与智能错题判题</strong>
                    <small>支持单次最多 4 张试卷、练习册多图联评</small>
                  </td>
                  <td>体验期内支持</td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>无限次使用</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>逐题深度精讲与分步解题思路</strong>
                    <small>剖析题目考点、解题步骤与易错避坑点</small>
                  </td>
                  <td>基础解析</td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>名师级深度精讲</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>类似题“举一反三”变式题训练</strong>
                    <small>针对特定错题衍生 1~5 道变式练习题</small>
                  </td>
                  <td>体验期少量额度</td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>无限次智能出题</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>9 大学科弱项知识图谱</strong>
                    <small>数学、语文、英语、物理、化学、生物、历史、地理、政治</small>
                  </td>
                  <td>基础图谱</td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>全景动态分析 & 频错雷达</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>单元练习卷针对性生成与在线批改</strong>
                    <small>输入单元名称智能生成 5 道精选综合题</small>
                  </td>
                  <td>支持体验</td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>无限次出卷 & 智能判卷</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>高清排版 Word 练习卷一键导出</strong>
                    <small>生成规范试卷格式，附带完整答案和解析，便于打印练习</small>
                  </td>
                  <td>单题基础导出</td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>整卷 & 单题高清排版导出</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>英语中高考作文智能批改与润色</strong>
                    <small>拍照识别手写作文，提供中高考评分、语法改错与地道佳句</small>
                  </td>
                  <td>基础识别</td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>中高考分级批改 + 佳句润色</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>已归档错题终身保存</strong>
                    <small>体验期或会员期结束后，之前保存的错题依然随时可查</small>
                  </td>
                  <td>
                    <span className="check-icon">
                      <Check size={17} strokeWidth={2.8} />
                    </span>{" "}
                    永久免费可看
                  </td>
                  <td>
                    <span className="check-icon purple">
                      <Check size={17} strokeWidth={2.8} />
                    </span>{" "}
                    <strong>永久免费可看</strong>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>多端数据实时云同步</strong>
                    <small>手机、iPad 平板、电脑浏览器多端无缝协同</small>
                  </td>
                  <td>
                    <span className="check-icon">
                      <Check size={17} strokeWidth={2.8} />
                    </span>
                  </td>
                  <td>
                    <span className="check-icon purple">
                      <Check size={17} strokeWidth={2.8} />
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>专属教研顾问一对一答疑</strong>
                    <small>使用指导、功能建议、一对一专属客服解答</small>
                  </td>
                  <td>
                    <span className="dash-icon">—</span>
                  </td>
                  <td>
                    <strong style={{ color: "#6e5cae" }}>专属微信客服一对一支持</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* 常见问题解答 FAQ */}
        <section id="faq">
          <div className="pricing-section-title">
            <span>FREQUENTLY ASKED QUESTIONS</span>
            <h2>关于会员付费的常见问题</h2>
          </div>
          <div className="pricing-faq-grid">
            <div className="pricing-faq-card">
              <h3>
                <HelpCircle size={18} /> 7 天体验期结束后，我之前保存的错题会丢失吗？
              </h3>
              <p>
                <strong>绝对不会！</strong>
                体验期结束后，您账号下所有已归档的错题、答案、解析以及知识图谱记录都会
                <strong>永久免费保留</strong>，随时可以在手机或电脑上复习查阅。只有新增拍照批改与生成新题需要升级
                VIP。
              </p>
            </div>

            <div className="pricing-faq-card">
              <h3>
                <HelpCircle size={18} /> 99 元/月的 VIP 适用于哪些年级和学科？
              </h3>
              <p>
                拾题全面适配小学高年级、初中三年（七/八/九年级）以及高中阶段。涵盖数学、语文、英语、物理、化学、生物、历史、地理、道德与法治全部
                9 大学科，题目综合性越强，AI 分步思路剖析的价值越明显。
              </p>
            </div>

            <div className="pricing-faq-card">
              <h3>
                <HelpCircle size={18} /> 付款后多长时间可以开通 VIP 权限？
              </h3>
              <p>
                支付宝付款后，系统收到并核对支付通知后自动开通。结果页会持续查询确认；
                如仍显示待确认，请保留订单号并稍后在收银页查看，勿重复新建订单付款。目前建议使用电脑浏览器付款，手机唤起尚未完成联调。
              </p>
            </div>

            <div className="pricing-faq-card">
              <h3>
                <HelpCircle size={18} /> 可以在手机和平板上使用吗？支持几台设备登录？
              </h3>
              <p>
                拾题采用自适应网页端设计，完美适配 iPhone、安卓手机、iPad 平板与各类 PC
                电脑浏览器。支持同一账号在手机拍照上传、在平板查看知识图谱、在电脑端一键导出 Word
                打印，数据云端秒级实时同步。
              </p>
            </div>

            <div className="pricing-faq-card">
              <h3>
                <HelpCircle size={18} /> 导出的 Word 试卷如何使用？
              </h3>
              <p>
                导出的 Word
                文档经过专业教研排版，题目与作答留白清晰，末尾附带参考答案与详细思路精讲。无论是用家用打印机打印手写刷题，还是给辅导老师批改，都极其规范整洁。
              </p>
            </div>

            <div className="pricing-faq-card">
              <h3>
                <HelpCircle size={18} /> 是否有退费与售后保障？
              </h3>
              <p>
                我们承诺提供真实的学习提分价值。开通 VIP 7
                天内，若因产品技术问题导致无法正常使用且无法解决，可联系客服沟通退费。错题数据严格私密，仅本人可见，绝不泄露给第三方。
              </p>
            </div>
          </div>
        </section>

        {/* 底部保障与行动呼吁 */}
        <section className="pricing-guarantee">
          <div className="pricing-guarantee-copy">
            <h3>
              <ShieldCheck size={24} /> 把每一次认真作答，变成实实在在的进步
            </h3>
            <p>
              不盲目刷题，只针对性攻克薄弱盲区。新用户即可免费获得 7
              天全功能试用体验，现在就开始整理第一份智能错题本吧！
            </p>
          </div>
          {user ? (
            <button
              type="button"
              className="pricing-guarantee-btn"
              onClick={() => {
                router.push(isLongTerm ? "/" : "/payment");
              }}
            >
              {isLongTerm ? "进入学习空间" : isPaid ? "续费 VIP 会员" : "开通 VIP 会员 (¥99／30天)"} <ArrowRight size={16} />
            </button>
          ) : (
            <Link href="/register" className="pricing-guarantee-btn">
              免费注册开始体验 <ArrowRight size={16} />
            </Link>
          )}
        </section>
      </main>


    </div>
  );
}
