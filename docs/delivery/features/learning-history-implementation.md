# 连续学习与作文版本交付（G01–G04、H02–H03）

状态：本地实现，代码与 0010 已冻结，准备交接真实 HTTP / Workers 整体验证。未提交、推送或部署；没有对 public / 生产库执行迁移。仅直接修改本任务负责的文件，保留其他代理改动，未修改 lib/practice-papers.ts 或 lib/essay-reports.ts。

## 文件与冻结版本

以同目录 `learning-history-freeze.json` 的 SHA-256 清单固定本次源代码版本。

- `lib/learning-history.ts`：账号/档案 scope、独立轮次、幂等与租约 token、草稿 CAS、来源、作文版本与报告关联、当前复习状态与事件。
- `db/migrations/0010_learning_history.sql`：追加正式迁移；旧 grading 仅迁入已有真实的一轮，不能恢复此前已被覆盖的轮次。
- `db/learning-schema.ts`：对应独立 Drizzle schema。主 schema 的 re-export 由整合代理提供。
- `app/api/learning/route.ts`：历史、草稿、学生版本、复习状态与事件 API。
- `app/api/learning/retries/route.ts`：原题重做/已有类似题转练习，复用相同来源的未完成卷。
- `app/api/practice-papers/[id]/grade/route.ts`：提交 attemptId、独立评分与旧快照兼容、失败持久化。
- `app/api/essays/route.ts`：先保存版本再分析，报告绑定，重发复用已有报告，失败保留版本及错误。
- `app/unit-practice.tsx`：未做练习优先、服务器草稿、每轮作答证据、原图、复习列表可编辑状态/日期/证据与事件历史。
- `app/essay-analysis.tsx`：服务器文字草稿恢复、学生原稿/修改稿、版本原文、对应报告与失败提示。
- `scripts/learning-history-loader.mjs` / `scripts/learning-history.verify.mjs`：真实 PG 隔离验证；不调用 AI。

0010 SHA-256：`124d87412e487450dae74f8fcd4b63e79ceb3429b0217321a3294984e1bce313`。

## 实际行为

G01：练习列表将未批改卷置前；知识点针对练习保留原能力。原题重做/已有类似题练习通过新 endpoint 关联错题 ID；原题页面显示账号及当前档案鉴权的完整原图和可放大的入口，并保留题框坐标用于核对。原图采用既有 `/api/uploads/:id/pages/:page`，该接口的档案校验由档案隔离代理提供。当前展示完整原页，不伪称已完成题框裁剪预览。

G02：每次提交有独立 attemptId、答案、grading、来源、评分来源、起止时间和状态。同 ID 同答案重发返回原轮次；不同答案拒绝复用 ID；进行中轮次拒绝并发重复；失败可以按原 ID 重试。租约 180 秒，重试 token 防止旧请求覆盖新结果。新一轮需新的 UUID。latest grading 继续写 practice_papers，所有新轮次独立保留；0010 保存迁移前已有真实 grading，未创造旧成绩。

原题及缺可靠参考答案的卷不交给文本 AI 猜测，保存为 `uncertain`，grading_source=`unassessed`，提供人工核对与订正入口。此类原题保存不依赖 AI 配置或体验期限；普通 AI 批改仍需原有 AI 权限。类似题转换使用已有题目、答案、解析，补齐 knowledgePoint 与 format=`short`，不编造选择题选项。

G03：通过明确的“保存服务器草稿”按钮保存，打开练习/恢复作文时读取；revision 比较拒绝并发覆盖，错误时保留本地输入。没有承诺未点击保存的文字自动上传。订正/复习按 attempt 只有一条 learning_reviews 当前记录，更新 state/date/evidence 后追加 learning_review_events 快照；标为 reviewed 后旧 needs_review 只在事件历史中，不会继续被 today 对 learning_reviews 的统计计入。页面直接列出并编辑复习记录，无 JSON 链接。

G04：页面展示每轮答案、真实评分来源/结果与错误，复习记录关联 attempt，服务端读取还能追溯 paper、source、答案、评分与时间。不按生成、下载或一次正确推算掌握率。

H02/H03：学生原稿是 original，无 parent；从版本页面“基于此版本写学生修改稿”另建 revision，parent_id 指向确切学生版本。已保存版本不覆写文字，AI 润色仍是报告参考内容。报告外键绑定该版原文，失败保留版本和 analysis_error；文本草稿刷新/重登可恢复。恢复后可不重新上传照片进行纯文字分析。新表不保存照片、base64 或文件键，作文照片继续仅当次处理。旧报告保留原服务可读，不给旧报告猜测学生版本关系。

所有新表有账号与档案约束；写入有 active-user trigger。API 使用 requireProfile(userId) 返回的 {id}；长 AI 请求固定创建时 scope。组件的学习写入/批改使用捕获的 X-Shiti-Profile，配合 api-guard 不一致拒绝与 Dashboard 跨标签页 reload。

## Dashboard 对接

```http
POST /api/learning/retries
Content-Type: application/json
X-Shiti-Profile: <当前档案 ID>

{"mistakeId":"<真实错题 ID>","mode":"original"}
```

mode 也可为 `similar`，只读取已保存的类似题，没有类似题时返回 400 提示先生成。

返回 `{ paper: PracticeDetail, paperId: string, url: string }`；url 为 `/?view=practice&paper=<id>`。鉴权/档案检查失败不会生成练习。Dashboard 入口由主代理负责，本任务未修改 dashboard。

## 其他 API

- `GET /api/learning?kind=practice&sourceId=<paperId>`：profileId、source、attempts、draft。
- `GET /api/learning?kind=essay`：profileId、versions（含 report_id / analysis_error）、当前文字 draft。
- `GET /api/learning`：profileId、当前 reviews、历史 events，均限定账号/档案。
- `POST /api/learning` 草稿：`{action:"draft",kind:"practice"|"essay",sourceId,revision,payload}`；作文 sourceId 固定 current。练习 payload `{answers,attemptId}`，作文 `{promptText,essayText,gradeLevel,parentId?}`。
- 学生版本：`{action:"version",id:<UUID>,parentId?,promptText,originalText,gradeLevel}`。
- 复习当前状态更新/事件追加：`{action:"review",attemptId,evidence,state,reviewOn}`；state 为 needs_correction / needs_review / reviewed，reviewOn 为 YYYY-MM-DD 或 null。同 attempt 更新既有当前行。
- 原练习 grade POST：`{answers:string[],attemptId:<UUID>}`。
- 作文 formData 支持 versionId、parentId，旧 confirmedText / promptText / gradeLevel 保留；files 可省略，照片不写入历史。

## 验证命令与证据

在项目目录 PowerShell 运行：

```powershell
npx tsc --noEmit
npx eslint app/unit-practice.tsx app/essay-analysis.tsx app/api/learning app/api/practice-papers/[id]/grade/route.ts app/api/essays/route.ts lib/learning-history.ts db/learning-schema.ts scripts/learning-history.verify.mjs scripts/learning-history-loader.mjs
node --env-file=.env.postgres --loader ./scripts/learning-history-loader.mjs scripts/learning-history.verify.mjs
Get-FileHash db/migrations/0010_learning_history.sql -Algorithm SHA256
```

必须使用 `--loader`，不能直接用 `--import ./scripts/learning-history-loader.mjs`；loader 会实际转译 TypeScript，并仅将 cloudflare:workers env 映射为实际 process.env，仍连接真实 PostgreSQL，不需要 experimental-transform-types。

PG 脚本只接受 localhost，先 pg_dump 备份到忽略的 work/learning-history，随后创建随机独立 schema、复制本机真实资料、应用所有正式迁移并调用真实 service；结束删除独立 schema。未修改 public 学习记录、未外呼 AI、未造账号或作文。两轮持久化检查重放真实错题已有作答，只是隔离副本上的存储验证，不计为两次新学习。复习状态转换使用已有反思或真实作答文本作为证据副本，仅验证当前行/事件机制，不作为真实复习完成证明。

最终 PG 输出：`checks=16, legacyRounds=0, persistenceReplayRounds=2, actualNewStudentRounds=0, disposableSchema=true, externalAiCalls=0`。覆盖来源、原题内容、草稿 CAS、同轮并发拒绝、失败重试、幂等返回、两轮保存、过期 token 拒绝、旧快照、账号/档案隔离，以及 reviewed 更新不遗留 needs_review 当前行、两条事件。

TypeScript 通过。定向 ESLint 0 errors，2 个 img 提示（作文已有本地照片预览与鉴权原图）。构建在 `work/learning-build` 独立源码副本执行 `npm run build` 通过五阶段；主目录 npm run build 被其他任务占用 dist/client 导致 EBUSY，未终止其他进程。

## 待真实验收与整合注意

尚未执行 Workers 真实 HTTP / 浏览器整体验证，未把 API / PG 验证当成视觉验收。需要主代理在固定版本后使用实际两个档案，验证刷新/重登、跨标签页切换、原图读取与两次真实新作答。当前本机 practice_papers、essay_reports 都无既有记录，因此旧 grading 回填只通过结构与空基线一致性检查；作文原稿/真实学生修改稿/报告绑定需用户真实材料验收，脚本明确 SKIP，没有造文。

0010 依赖 0008 的档案 schema 与归属保护函数，按正式序号执行；发布前遵循主项目备份与授权流程。主 schema 需要保留 learning-schema re-export，并将 practice_papers/essay_reports 的 (id,user_id,profile_id) 唯一索引纳入后续 PostgreSQL 快照整合；本任务不编辑其他代理负责的共享 schema 或旧 journal。


## G04 知识图谱补充交付与重新冻结

本次补充文件：`app/knowledge-map.tsx`、`lib/learning-evidence.ts`、`lib/learning-history.ts`、`app/api/learning/route.ts`、`app/unit-practice.tsx`、`scripts/learning-history.verify.mjs`。冻结清单已更新，0010 未改变。

`GET /api/learning?kind=evidence` 返回 `{profileId,attempts,legacyPapers,limit:500,truncated}`。独立轮次包含 paperId、题干与知识点、实际答案、grading、status、source/sourceId、gradingSource、开始/完成时间、失败错误。每个实际轮次保留其独立 ID；图谱统计时 KnowledgeEvidence.sourceId 使用轮次 ID，原始错题来源仍在展开区显示。读取限定真实账号与档案，使用同一 repeatable-read 快照。

每类最多 500 条，超过则在页面明确显示范围限制；只统计该展示范围。legacyPapers 只读取全库范围内 NOT EXISTS 任意 attempt 的练习卷，不能因为旧 attempt 被 500 条上限截断而回退到同卷最新 grading。KnowledgeMap 已停止从 props papers 的 latest grading 直接生成错误/正确证据；props 仅继续提供单元建议。数据加载失败明确报错，不静默回退冒充完整证据。

错误/正确统计只接收已完成、存在实际非空作答、判定明确的轮次。`uncertain`、`unassessed`、失败、进行中不计正确或错误，生成/打印不算掌握。`Mistake.archiveKind?: 'mistake' | 'collection'` 已加入输入类型，collection 收藏既不进入错误证据，也不显示为已判错示例；兼容旧版缺少 archiveKind 的错题。

知识点详情可展开来源，显示实际作答、时间、评分来源、结果与原始来源 ID。链接带 `paper` 与 `attempt`，UnitPractice 打开对应轮次 details 并滚动定位；legacy 仅链接旧卷报告，不捏造 attempt。

更新后的真实 PostgreSQL 验证 **21 项通过**，新增独立两轮证据返回、来源/真实作答/未评分标记、同卷 legacy 不重复、未评分不算正确/错误、跨档案证据空结果。仍是已有真实作答在隔离副本中重放，实际新学生轮次为 0；没有真实作文，继续明确 SKIP。TypeScript 通过；本次定向 lint 0 errors，仅原图 img 的 1 个 warning；独立目录五阶段构建通过。Workers HTTP 与真实学生/作文验收仍由主代理接续。


## 整合验收更新

原工作流验证记录保留当时状态。最终整合的类型检查、ESLint、隔离五阶段构建、Workers HTTP、浏览器及持久任务证据与边界，以[全量实施与验证](requirements-implementation.md)为准；本地实现未发布。
