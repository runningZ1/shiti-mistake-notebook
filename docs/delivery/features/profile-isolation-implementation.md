# E01–E04 学习档案隔离及 F04 软移出

实施日期：2026-11-12。直接修改既有工作区，保留原有及并行任务修改；未提交、推送、部署，未迁移生产或本机 public。

## 已交付代码

- `lib/profiles.ts`：档案创建、名称与年级编辑、默认档案、cookie 选择与数据库归属校验。未设置商业数量上限，不改会员权益。无 cookie 使用默认档案；无效、空或其他账号的 cookie 拒绝访问，不静默串回其他档案。
- `app/api/profiles/**`：GET 列表，POST 创建，PATCH 编辑，POST select 切换。列表及选择接口独立验证登录账号，允许修复过期或其他账号遗留的档案 cookie；不接受其他账号的档案。写操作有同源检查，响应禁止缓存。
- `app/profile-switcher.tsx`：当前档案提示、新增、编辑与切换。切换前调用 `beforeSwitch`，未提供时明确确认未保存内容；成功后整页进入 `/`，清除旧页面内存和记录链接。由主流程挂载及接入草稿保存。
- `lib/api-guard.ts`：认证回查账号后验证当前档案，保留匿名401、权限403及存储故障503的区分。
- `db/migrations/0008_learning_profiles.sql`：追加档案及六张业务表的非空 `profile_id`，所有历史资料迁入该账号的唯一默认档案。保留原账号、ID、密码哈希、图片键、错因及学习内容；停用账号的历史回填同样保留。增加档案/账号复合外键、上传/错题三列复合外键、归属不可变触发器、图片索引与上传归属检查及 `mistakes.removed_at`。本迁移不为遗漏档案的旧写入提供数据库默认值，调用方必须显式绑定档案。
- `db/profile-schema.ts`：独立 Drizzle 档案表定义，主 schema 由集成任务同步。本任务不编辑 `db/schema.ts`。
- `app/api/mistakes/**`：列表、错因、类似题与两种 Word 导出均限制当前账号及档案；默认排除软移出项。列表及 Word payload 包含 `archiveKind` / `judgementSource`，收藏题及 `manual` 人工归档题强制加载原图，与学科无关。
- `app/api/knowledge/**`：归属、概念缓存、示例查询和 upsert 均按档案隔离；知识点唯一键增加档案。
- `lib/practice-papers.ts`、`lib/essay-reports.ts`：既有列表、详情和写入按账号与档案查询；写入可携带固定档案；无匹配练习的评分保存报错，不冒充成功。
- `lib/word-source.ts`、`app/api/uploads/[id]/pages/[page]/route.ts`：在读存储对象前验证上传归属，保留既有原图键和文件格式检查。

`lib/knowledge-map.ts` 是纯函数，不读取数据库；无需为它增加另一套权限状态。其输入由已隔离查询提供。上传、任务、题目服务和新学习服务由其他任务集成，不在此文件清单内。

## 集成接口

```ts
const auth = await authenticate(); // authenticateForAi() 同结构
if ("response" in auth) return auth.response;
auth.profileId;      // 验证后的 string
auth.user.profileId; // 同一个 string

const profile = await requireProfile(userId);
profile.id; // 返回完整 LearningProfile 对象，并非 string

// 服务器任务在创建时捕获档案，执行时不读当前cookie：
const fixed = await requireProfile(userId, job.profileId);
```

`requireProfile(userId, fixedProfileId?)` 的显式档案仍须归属该账号。练习及作文服务的 list/get 支持最后一个可选固定档案参数，练习 savePracticeGrade 同样支持；insert 输入支持 `profileId`。请求内调用保持原签名可用，cookie 是当前请求上下文的快照。

主流程须显式给 uploads、upload_objects 和 mistakes 写入 `profile_id`，查询/统计同样过滤档案及 `removed_at IS NULL`。后台任务携带创建时的档案，不能在执行时凭最新 cookie 选择。0009 的新表与约束由主流程维护；0010 学习历史由对应任务维护。

挂载 `<ProfileSwitcher beforeSwitch={保存或确认草稿的函数} />`。函数返回 false 阻止切换；草稿、sessionStorage 和打印清单必须以账号和档案命名空间隔离。其他浏览器标签页中的未保存状态及后台请求应由页面层核验档案；本组件不声称已实现跨标签页草稿自动保存。旧链接 ID 不变，在其默认档案内仍可访问；切到其他档案访问旧记录返回404，不自动替用户切档。

## F04 前端协议

| 操作 | 接口 | 行为 |
| --- | --- | --- |
| 移出错题本 | `DELETE /api/mistakes/:id` | 更新 `removed_at`；返回 `{ removed:true, deleted:false, id, removedAt }`，重复调用保持原移出时间 |
| 撤销移出 | `PATCH /api/mistakes/:id`，JSON `{ "action":"restore" }` | 清空 `removed_at`；返回 `{ restored:true, id, removedAt:null }` |
| 查看已移出 | `GET /api/mistakes?removed=true` | 仅当前档案软移出项；普通列表只查未移出项 |
| 保存错因 | 原 PATCH `{ "reflection":"…" }` | 仅当前档案未移出题；保留1000字符限制 |

前端依据 `removed` 更新列表并给“撤销”按钮，不能继续依据旧 `deleted` 标志把行当真实删除。此操作保留题目、反思、类似题、来源与上传原图；没有新增以相同路径永久删除错题的接口。真实删除上传/账号仍是独立动作。

## 迁移与隔离验证证据

验证脚本：`scripts/profile-isolation.verify.mjs`。读取被忽略的 `.env.postgres`，强制本机连接；先用 PostgreSQL 17 `pg_dump --format=custom --schema=public` 备份，并用 `pg_restore --list` 验证归档目录。凭据仅通过子进程环境传递，不进入命令参数或证据输出。备份位于被忽略的 `work/profile-isolation/`，未进行备份恢复演练。

脚本仅在新建 schema 内重放0001–0007，复制真实账号、上传、图片索引、错题、练习、知识点、作文及支付表，再运行0008和后续全部迁移。默认全部回滚；显式 `--keep-schema=profile_acceptance_…` 在检查成功后保留副本。不删除或复用同名既有 schema，不修改 public 或0009文件。

```powershell
node --env-file=.env.postgres scripts/profile-isolation.verify.mjs
node --env-file=.env.postgres scripts/profile-isolation.verify.mjs --keep-schema=profile_acceptance_20261112_next
node --env-file=.env.postgres scripts/profile-isolation.verify.mjs --keep-schema=profile_acceptance_requirements_20261112 --write-env
```

2026-11-12 09:38 UTC 的保留副本：`profile_acceptance_20261112`，通过0001–0011全部迁移及28项检查。备份为 `work/profile-isolation/public-1794476298643.dump`。供主流程浏览器验收使用，创建后本任务未清理或覆盖该 schema。运行连接串可追加 URL 参数 `options=-c%20search_path%3Dprofile_acceptance_20261112%2Cpublic`；已有参数时使用 `&options=…`。运行时配置由主流程保存，禁止将完整连接串写入交付文档。

09:39 UTC 增补支付表副本后再次完整回归，通过31项检查，测试 schema 已回滚；证据 `work/profile-isolation/verification-profile_verify_fe0903aa620a44e1abb1911a1d0899fe.json`，备份 `work/profile-isolation/public-1794476373278.dump`。该回归未改动上述保留副本。

09:43 UTC 再次完整回归仍通过31项检查，证据增加全部迁移 SHA-256：`work/profile-isolation/verification-profile_verify_a6cab4a6428241fe9ef428a6e6f0139f.json`；该次副本已回滚，备份 `work/profile-isolation/public-1794476631709.dump`。

09:45 UTC 按主流程要求新建固定留存验收副本 **`profile_acceptance_requirements_20261112`**，31项检查通过。`.env.requirements-verify` 已生成，仅包含该副本的 DATABASE_URL，且经 Git 忽略；search_path **只设为该schema，无 public 回退**。主流程可用该文件覆盖运行环境的数据库配置，不要将它提交。证据：`work/profile-isolation/verification-profile_acceptance_requirements_20261112.json`；备份：`work/profile-isolation/public-1794476726783.dump`。脚本在提交副本前重新读取迁移文件核对 SHA-256，发现并行改动即回滚；保留副本创建后修改迁移需要新建另一个副本，不应重用同名 schema。

该固定副本0009校验和为 `c1b2e9994558a93cbd7f9136bd531d7c8f5bcfdfdcc45495f32d7af291c2948f`，包含新增上传/任务的档案复合外键、active-user及owner触发器。0009文件未由本任务改写。

09:49 UTC 根据新增 `question_edit_drafts` 重新准备 HTTP 验收环境：当时 `.env.requirements-verify` 指向 `profile_acceptance_requirements_20261112_http`，旧副本全部保留，不提前清理。0001–0011全部迁移及34项检查通过，增加真实错题文本草稿副本的跨档外键、归属不可变、停用账号写入拒绝验证；验证草稿及停用操作在保存副本前回滚，不污染浏览器资料。真实资料计数保持不变，草稿表为空。

最新证据：`work/profile-isolation/verification-profile_acceptance_requirements_20261112_http.json`；备份：`work/profile-isolation/public-1794476941817.dump`。0009 SHA-256 为 `b7cf95eb7551274904ea48071d3839e28d97c512a6e83296833935d48eb42867`。该磁盘版本包含草稿表 active/owner 触发器，尚未发现额外的问题 scope trigger，不能将其视为已完成验证；若主流程随后追加该触发器，须按新checksum再建副本。

实际副本：4账号、4上传、5图片索引、1错题；练习、知识点、作文与支付表均无内容。验证覆盖记录数、默认回填、上传及错题旧字段整体哈希、跨账号档案外键、跨档上传/错题写入、复合外键独立拒绝、软移出排除和撤销保留内容。没有编造练习、作文或儿童资料；空表不计为真实内容验收完成。

## 最近已验证副本及最终冻结状态

2026-11-12 10:04 UTC 已验证并保留副本 `profile_acceptance_release_20261112`，当时 `.env.requirements-verify` 指向该副本。0001–0012全部迁移及 **35项检查通过**；另行使用该env真实连接，确认 `learning_review_events` 存在、两个业务触发器启用、`original_subject` 与源资料零差异、public 未新增档案字段，全部迁移checksum与当时文件一致。

证据：`work/profile-isolation/verification-profile_acceptance_release_20261112.json`；备份：`work/profile-isolation/public-1794477859299.dump`。此次0010 SHA-256 为 `124d87412e487450dae74f8fcd4b63e79ceb3429b0217321a3294984e1bce313`；0012为 `044e89a72811ec2e5344a4f076d17cb4274f928a9fc880c444f60e7b90c47191`。这些校验和只描述该次验证，不代表仍在并行编辑的0010最终版本。

0012仅允许以下明确alias：小学/初中/高中数学 → 数学，小学/初中/高中语文 → 语文，小学/初中/高中英语 → 英语，政治 → 道德与法治；其他标签原样保留。上传原标签保存在 `original_subject`。验证脚本独立枚举相同规则来构造预期整行哈希，`subject` 没有从校验中移除；ID、图片键、反思、正文等原字段仍完整比较，另行校验 `original_subject`。

主流程随后要求等学习代理明确freeze后仅再执行一次最终保留副本。已读取 `learning-history-freeze.json` 的 `status: frozen`，并在运行前核对其中0010 SHA-256与磁盘文件一致。**2026-11-12 10:08 UTC 冻结后的一次最终验证已完成：0001–0012全部迁移及35项检查通过，保留副本为 `profile_acceptance_frozen_20261112`，当前 `.env.requirements-verify` 已切换至此副本。** 本次0010及0012校验和与上述记录一致，全部迁移在提交前再次核对无变化。

最终证据：`work/profile-isolation/verification-profile_acceptance_frozen_20261112.json`；备份：`work/profile-isolation/public-1794478104385.dump`。凭据未写入文档或日志，env连接只使用该schema且不回退public。现有runtime配置、旧验收副本、Drizzle snapshot及generated SQL均未由本任务改动或执行。未进行额外重复全量回归，未提交、推送或部署。

## SQLite 导入兼容审查（2026-11-12 10:20 UTC）

按主流程请求只读审查 `scripts/import-postgres.mjs`，未修改该脚本。`hasProfiles` 检测、users 后建立默认档案、业务显式 `profile_id`、成功后恢复触发器及失败事务回滚的结构正确；内部外键及check约束未因 `DISABLE TRIGGER USER` 被关闭。

发现一项当前范围内的问题：该工具面向已经应用全部迁移的空目标库，但 uploads 的导入列未写 `original_subject`，uploads/mistakes 的 `subject` 直接采用SQLite源值。0012已在导入前完成，后续导入不会再触发其一次性UPDATE，因而有明确alias的历史学科会留在旧标签，上传原标签字段为空；若源已有 `original_subject` 也不会导入。建议由脚本拥有者在导入时按0012明确规则映射并保留原标签，或在导入事务内对新导入记录执行等价回填。此问题为源码顺序推导，当前本地空业务源不能验证其发生频次。

定位到既有本机SQLite：`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`。使用Node只读打开，含3个现有账号，其余业务表为空；没有新造源文件、作业或业务数据。未使用 `work/deletion-check-*` 等破坏性测试遗留源冒充真实资料。

在新独立schema `profile_verify_sqlite_import_20261112` 应用手写0001–0012后，直接运行原导入脚本，**63项检查通过**：逐列比对3账号（含ID、密码哈希和时间），每账号唯一默认档案，7表记录数，成功后触发器全部启用，第二次重复导入拒绝并回滚且不改变账号/触发器，源SQLite及导入脚本SHA-256保持不变，public账号/上传/错题整体指纹保持不变。该独立导入副本保留，未更新现有验收env或runtime配置。Drizzle companion SQL未执行。

证据：`work/profile-isolation/import-review-evidence.json`；验证执行器：`work/profile-isolation/import-review.verify.mjs`（被忽略的本地工作材料）。本次审查脚本SHA-256：`3ccf8303c14dc7f0328ff940b278ec92190d2e660d6c913074a65837a4308c6c`。题框、reflection、OCR/analysis历史在源码上按字段存在条件导入，但源没有这些列或对应业务行，不能声称已实际验证。未定位到含真实学习记录的本地SQLite源；此前线上归档仅有文档路径，未访问或更改线上资源。

### 新版 importer 复验（2026-11-12 10:34 UTC）

主流程修订后，只读复核并使用同一个未改动的真实SQLite源，按要求复跑原有63项检查，**全部通过**。本次仅把本地验证器的schema名称改为随机唯一，并追加独立证据文件；未增加业务测试范围，也未造源中不存在的会员字段、错题或练习行。新版导入器未由本任务改写。

- 唯一留存schema：`profile_verify_import_85791fa6a9554da784df94f52cec1031`。
- 新版 importer SHA-256：`3c3ed3b8382b13f10a3734602d99d9f7b4fc8e96f9dbbb427efbc02a61cf8b16`。
- 源SHA-256仍为 `cea85c6470088390c9003b4c32c7750204dd8103d822da3a70d6cd8cadda084e`；源中仍为3账号，其他业务表0行。
- 独立证据：`work/profile-isolation/import-review-profile_verify_import_85791fa6a9554da784df94f52cec1031.json`；最新通用证据也更新至 `work/profile-isolation/import-review-evidence.json`。
- public指纹、源文件、执行前后的新版导入脚本均不变；旧副本、验收env及runtime未改动。

源码确认已修复此前两项遗漏：目标存在subject历史字段时按明确alias归一化uploads/mistakes，并以源 `original_subject ?? subject` 保留上传原标签；源users存在 `paid_ends_at` 时显式导入。新增已批改练习的legacy轮次写入也已存在。由于真实源没有对应字段/业务行，这些分支只完成静态审查，不能算实测。

仍有一项新路径问题：导入器为停用账号禁用了六张旧业务表及档案表的USER触发器，但新增legacy轮次写入 `learning_attempts` 时未暂停其 `learning_attempts_active`。因此若源中停用或删除中的账号有 `graded_at` 非空的练习，`require_active_user` 会拒绝轮次插入并回滚整次导入；与保留停用账号历史的既有导入约定不符。当前源没有练习，未构造该场景。建议由脚本拥有者让该历史回填与其他导入表采用同一事务内触发器处理，并在成功后恢复；本任务不改源码。

## 检查结果与边界

- 本范围 ESLint 通过，无错误/警告。
- TypeScript 检查中本范围文件无报错；全项目尚存在并行开发的 unknown JSON 类型错误，不能宣称全项目类型检查通过。
- `npm run build` 被现有预览占用 `dist/client` 的 EBUSY 阻止；未终止其他任务进程。需要主流程停止其预览后统一构建。
- 核心 B API 的真实浏览器验收由主流程在保留 schema 继续执行。此交付不把 SQL 回归等同于 HTTP、浏览器、Workers、跨标签页、实际孩子资料或 Word/WPS 纸面验收。


## 整合验收更新

原工作流验证记录保留当时状态。最终整合的类型检查、ESLint、隔离五阶段构建、Workers HTTP、浏览器及持久任务证据与边界，以[全量实施与验证](requirements-implementation.md)为准；本地实现未发布。

最终导入脚本按主对话修复learning_attempts触发器暂停/恢复后已再次验证63项通过，证据work/profile-isolation/import-review-evidence.json，脚本SHA-256：2bf54367b2e9f4d6484e244be5081862add50381cca1c19722c93d1c0a9c40bf。仍无真实学习行可验收，旧静态发现已修复。
