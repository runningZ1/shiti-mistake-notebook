---
name: requirements-implementation
status: local-implemented-pending-real-acceptance
spec: docs/specs/changes/requirements-consolidated.md
spec_version: "1.0"
---

# 全量需求实施与验证

依据总清单 1.0，在现有未提交实现上增量开发。不提交、推送、生产迁移或发布。

## 工作流与认领

- 主流程：上传、OCR 保存点、题目版本、手动归档、确认后分析、作业筛选合并、导航与集成。主对话负责 uploads、dashboard、题目服务及 0009 迁移。
- 档案：E01–E04、F04，档案服务/切换器、权限入口及既有资料查询隔离、0008 迁移。Newton 负责。
- 打印：D04–D05、C07，Word 图像尺寸/分段、打印面板和通用服务端草稿、0011 迁移。Erdos 负责。
- 学习：G01–G04、H02–H03，独立练习轮次、学习草稿、作文版本及入口、0010 迁移。Chandrasekhar 负责。

共享 schema 导出和 dashboard 由主对话串行集成；各工作流使用独立 schema 文件。既有资料和历史迁移不可覆盖。

## Documentation Sync

| 改动 | 正文/证据位置 | 负责人 | 状态 |
| --- | --- | --- | --- |
| 人工核对、题目版本、归档与任务 | 本文、AGENTS.md、总清单进度链接 | 主对话 | 通过（实物另列） |
| 档案隔离、历史迁移、撤销 | profile-isolation-implementation.md | Newton/主对话 | 通过（真实孩子资料另列） |
| 图片尺寸、分页预览、打印草稿 | printing-implementation.md | Erdos/主对话 | 通过（Word/WPS及纸面另列） |
| 多轮作答和作文版本 | learning-history-implementation.md | Chandrasekhar/主对话 | 通过（真实作文另列） |

## 验证与发布边界

逐批检查构建、类型、适当的 PostgreSQL 隔离副本验证、真实 HTTP 和浏览器。真实业务数据不编造；若缺打印设备，不把 DOCX 结构通过写成纸面验收通过。上线需要另行授权，迁移先备份。


## 已实现范围与验收映射

记录更新时间：2026年11月12日 18:23:31（北京时间）。本地实现与生产发布分别判断；仍未发布。

| 需求 | 当前实现 | 证据与边界 |
| --- | --- | --- |
| A01–A06、B01–B07、D03 | 上传后先保存/OCR，三种意图；稳定题目ID、只读OCR、确认版本；题干/作答/参考答案及来源编辑；拖框、数值调框、裁剪预览、新增题；待核对/确认/忽略可恢复；人工错题与收藏独立；明确按钮仅分析确认版本 | 两份真实作业逐题HTTP，版本409和重复归档；真实OCR及确认后分析。图形仍保守判断，人工路径可用 |
| A07 | 上传页序和90°旋转；保存原照片键、旋转关系和OCR图像版本；每成功页即时保存，失败重试复用成功页 | 新图写私有R2并实际回读；页序/旋转UI与坐标使用同一图像。逐页超时/断网仍需更多家庭资料验证 |
| A08 | 请求幂等键、上传租约、持久processing_jobs、attempt围栏/过期租约、独立Node执行器及PM2配置 | 关闭浏览器后真实百度OCR和分析均由独立执行器完成。生产必须先配置TASK_WORKER_SECRET和启动执行器；不是仅修改提示语 |
| C01–C06、D01–D02 | 保留北京时间归档日、错因1000字符与Word模板；上传日/作业日/归档日独立；作业按日期学科过滤、多选汇总去重、排序 | 两份真实上传合并DOCX，既有格式回归通过；手动或收藏题强制原图，不能拿字号控制原图 |
| C07、D04–D05 | 服务端题目编辑草稿、打印清单/设置/错因草稿及版本冲突；图像60–165mm宽、长图220mm分段、分页边界预览 | Word OOXML裁剪/分段和媒体关系检查；HTTP409及刷新恢复；实际Word/WPS分页仍待验收 |
| D06 | 输出能力已实现 | **待实物验收**：未获得打印机纸面反馈；不把结构通过视为实际可剪贴验收 |
| E01–E04 | 多档案创建/编辑/切换；默认档案迁移保留原ID；服务端账号/档案查询及附件隔离；后台任务固定档案；跨标签页切档重载及固定请求档案校验 | PostgreSQL真实资料副本、35项迁移/权限/保留检查；HTTP跨档图片404与错误清单422。测试容器不冒称两个真实孩子资料验收 |
| F01–F04 | 桌面/手机统一今日、作业、错题本、练习与复习、作文；真实待办与继续上次；独立名称/年级/日期；显式学科别名归一并保留原标签；软移出与撤销 | 权限与待办HTTP、浏览器入口；独立永久删除仍沿用管理员资料删除，与移出区分 |
| G01–G04 | 原题重做/针对练习来源；优先未完成练习；独立attempt轮次、实际答案/评分来源/时间；服务端草稿、订正与可调整复习安排、事件历史；图谱追溯每轮证据 | 真实旧作答隔离重放两轮，不计作新学生作答。原题保存为待人工核对，不用文本AI猜图；未评分/未知不计正确错误 |
| H01–H03 | 作文服务器文字草稿；学生原稿、修改稿版本；报告绑定原文版本；失败保留版本；照片仍仅当次使用 | 接口格式及版本权限；**本机无真实作文资料，真实作文内容验收待完成** |

## 实际接口与运行

- `POST /api/analyze` 接收照片、originalFiles、rotations、intent、title、subject、gradeLevel、homeworkDate 和 Idempotency-Key，先保存照片后返回202和uploadId/job。页面不再直接判题。
- `POST /api/uploads/:id/analyze` JSON `{"kind":"recognize"}` 重试未识别页；`{"kind":"analyze"}` 只提交已确认题目。现有结果对应同一确认版本时复用。
- `POST /api/uploads/:id/questions` 保存版本，version冲突409；action=archive按manual来源归档，kind=mistake/collection。新增题用客户端稳定UUID，响应丢失后重发不重复。
- `GET /api/uploads/:id/questions?question=…` 返回历史确认版本和报告；过期分析只保留历史，不覆盖当前汇总。
- `GET/PUT/DELETE /api/uploads/:id/question-drafts?profileId=…&question=…` 读写未提交文字草稿；乐观锁不覆盖另一页面。
- `GET/PUT /api/drafts/printing?profileId=…` 保存打印题目顺序、设置和未提交错因；关闭面板保留清单并继续保存。
- `POST /api/tasks/run` 只接受服务端32字符以上密钥；`scripts/processing-worker.mjs` 轮询此接口。`ecosystem.config.cjs` 已增加shiti-processing-worker，未在生产执行PM2。
- 原始照片通过鉴权的`/api/uploads/:id/pages/:page?original=1`读取；默认路径使用OCR/裁剪的变换版本。

上线准备需先备份数据库和对象索引，再通过现有checksum执行器应用正式0008–0012（连同此前尚未应用的0006、0007），配置执行器密钥并重新构建。`drizzle/postgresql/0008_petite_wrecker.sql`仅为ORM快照伴随差异，不能代替含回填、约束和触发器的正式迁移。历史SQLite导入同步补默认档案，不重写原ID。

## 验证证据

- 真实PostgreSQL副本：`work/profile-isolation/verification-profile_acceptance_frozen_20261112.json`，35项，含0001–0012校验和；备份路径在该证据中。public未迁移。
- Workers HTTP：`scripts/requirements-http.verify.mjs`，结果`work/requirements-verification/http-evidence.json`；覆盖两份作业、版本/草稿冲突、归档幂等、跨档附件与打印、原题两轮作答、复习事件、来源证据。
- 独立执行器：`scripts/requirements-live.verify.mjs --live`，结果`work/requirements-verification/live-evidence.json`；真实R2、百度OCR、确认后模型分析，无浏览器参与执行。
- 学习持久化：`node --env-file=.env.postgres --loader ./scripts/learning-history-loader.mjs scripts/learning-history.verify.mjs`，21项；使用真实作答副本重放，实际新增学生轮次0，无作文时明确SKIP。
- DOCX：`node scripts/check-mistake-docx.mjs`，通过；OCR、数学、知识图谱既有检查8项通过。
- 全项目类型检查与ESLint通过（0 errors，保留11个非阻断warning）。五阶段构建在`work/requirements-build`隔离副本通过；原dist被其他会话预览使用，未结束其进程。
- 浏览器：恢复打印清单、调整项和图片尺寸入口可见；未提交题目编辑保存服务器草稿、刷新找回、随后保存确认版本成功。最终并发回归另附下方记录。

## 独立Review闭环

复核发现的六项P1已进入修复与回归：同作业轮询保留编辑器；仅确认版本发布到归档且纯状态变化不清解析；新增题UUID幂等并校验跨作业冲突；旧输入分析只留历史；上传准备固定档案；打印关闭与清单分别保存。缺失打印题显示占位及阻断导出，保留ID/顺序，不静默删除。

## Knowledge Check

本交付只实现总清单1.0范围，无收费或权益变更。当前实现说明见本文件及档案/打印/学习交付文档；总清单保留需求基线，当前状态按本地实现更新并链接本记录。物理打印、真实作文和两个真实孩子资料仍按证据边界保留待验收，不报完成上线。


## 最终复验补记

2026年11月12日 18:32:56（北京时间）：六项Review问题已修复；后续复核补齐“轮询报错仍保留编辑器”及“新增请求旧重放不返回最新版本”两项。真实后台分析期间将题目改为新版本，旧报告仅入历史、当前汇总不被覆盖；重新确认后第4版本分析成功。真实原图重新上传、幂等复用、OCR及两个版本分析由独立执行器完成，未自动归档。两次验证新增的4个远端测试对象均已按确切uploadId删除并回读确认；没有删除生产账号或原照片。

Workers HTTP最终证据包括未确认编辑不覆盖归档、新增题首版本重发幂等、已编辑后旧请求409和跨作业同ID拒绝。浏览器实际完成两份作业选择、汇总、调整顺序后立即关面板、刷新恢复相同顺序；截图为`work/requirements-verification/workspace-browser.png`。预览图片瞬时网络失败已补仅重载原图的按钮，提示实际可知失败范围，不声称网络具体原因。

SQLite导入兼容性已在真实现存源的独立schema验证63项：3个账号的ID/哈希/时间逐列保留、默认档案唯一、重复导入回滚、触发器恢复、public整体指纹不变。该SQLite无学习行，题框/反思/OCR行导入仅源码review，不能冒称真实资料验证。证据`work/profile-isolation/import-review-evidence.json`。

后续发布仍需单独授权；本次只保留本地实现与隔离验证材料，不提交、推送、迁移public或发布。外部验收缺口不因代码完成而勾选。


## 最终检查结论

2026年11月12日 18:37:15（北京时间）：最终代码与隔离构建源码SHA-256一致；五阶段构建、全项目类型检查和ESLint通过（0 errors，11 warnings）；Workers HTTP **94项通过**；迁移/隔离 **35项通过**；学习持久化 **21项通过**；真实SQLite最终导入 **63项通过**；既有OCR/数学/知识图谱8项及DOCX检查通过。最终来源映射使用稳定questionId，重复题干不再通过文字匹配报告。独立Review六项及两项补查均关闭，无剩余确定P0/P1。

最终导入补丁还保留源paid_ends_at、按显式别名同步subject/original_subject、为源已有真实grading补legacy轮次；learning_attempts的active触发器在事务导入时暂停并恢复，使停用账号历史可导入。现有源缺付费期限和学习行，对这些分支不冒称内容实测。

完整汇总：`work/requirements-verification/validation-summary.json`；HTTP：`work/requirements-verification/http-evidence.json`；真实任务：`work/requirements-verification/live-evidence.json`；最终导入：`work/profile-isolation/import-review-evidence.json`（脚本SHA-256为2bf54367b2e9f4d6484e244be5081862add50381cca1c19722c93d1c0a9c40bf）。正式迁移未在public/生产执行。验证进程结束时只关闭本会话创建的执行器、预览和loopback代理。

Documentation Sync：当前需求状态、README、AGENTS、档案/打印/学习正文与本记录已同步。功能代码本地完成；D06、真实作文和真实家庭多孩使用按上表保留待验收，不声称全部实物验收或已上线。
