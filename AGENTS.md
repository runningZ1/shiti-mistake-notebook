# 拾题 · 智能错题本

## 产品与运行方式

拍照上传作业或试卷，调用 DeepSeek 分析并归档错题；支持类似题、知识图谱、单元练习卷、英语作文分析和账号管理后台。

应用使用 vinext、Vite、React、TypeScript，服务端在 Workers 运行环境中执行，自托管服务器使用 Wrangler、PM2 和 nginx。数据库使用真实 PostgreSQL，通过 `pg` 驱动执行参数化 SQL；Drizzle 的 PostgreSQL schema 在 `db/schema.ts`。图片保存在 R2 接口提供的对象存储，自托管时其持久目录为 `.wrangler/state`。

禁止 mock、伪造业务数据和数据库替代实现。验证使用真实账号、真实作业和真实数据库；破坏性验证只在独立数据库或 schema 的真实资料副本上运行。

## 命令

要求 Node >=22.13.0。

```bash
npm run dev
npm run build
npm run start -- --port 3107 --env-file /absolute/path/.dev.vars
npm run lint
npx tsc --noEmit
node --env-file=.env.postgres scripts/migrate-postgres.mjs
node --env-file=.env.postgres scripts/import-postgres.mjs <原SQLite数据库路径>
```

本地 PostgreSQL 为 `127.0.0.1:5432`，独立数据库 `shiti`，应用角色 `shiti_app`。连接字符串保存在被 Git 忽略的 `.env.postgres`，运行时 `.dev.vars` 同样需要 `DATABASE_URL`。凭据禁止输出到日志、文档或提交。

构建前停止本次启动的预览进程，Windows 上它会占用 `dist/client`。先构建，再启动预览。不要终止其他任务的进程。

## 数据库

- `db/client.ts` 提供 `query` 和 `transaction`，使用 PostgreSQL `$1` 参数，禁止拼接外部输入。
- `query` 在结束时关闭连接池；`transaction` 使用同一客户端执行 BEGIN/COMMIT，失败时回滚事务并抛出错误。禁止把数据库错误当作空结果。
- `timestamptz` 读取为 ISO 字符串，JSON 字段使用 `jsonb`。账号 ID 保持 text，迁移不得重写 ID、密码哈希或图片键。
- `db/migrations/*.sql` 为正式迁移，`scripts/migrate-postgres.mjs` 使用校验和记录已执行迁移，修改结构请追加文件，禁止修改已执行迁移。
- `drizzle/` 是原 SQLite 数据迁移来源，应用运行和新部署不使用 D1。
- `scripts/import-postgres.mjs` 使用 Node SQLite 库只读源文件，事务导入 PostgreSQL，遇到重复记录或违反外键、检查约束时直接失败。导入事务内暂时禁用业务状态触发器，以保留停用账号的历史资料，提交前恢复触发器。迁移重复执行与真实账号导入已经在独立 schema 验证。
- 用户数据、迁移来源数据库和对象存储目录禁止提交。

主要表为 `users`、`uploads`、`upload_objects`、`mistakes`、`practice_papers`、`knowledge_units`、`essay_reports`。所有业务表使用账号外键；错题以 `(upload_id,user_id)` 复合外键约束所属上传与账号一致。时间、用户和上传索引支撑列表查询。

写入触发器锁定账号并检查启用状态与删除标记，阻止停用后完成的 AI 请求保存数据。账号更新和删除通过事务锁与行锁保护最后一个启用管理员。图片上传先持久记录 multipart 标识再写内容；删除先 abort 上传、再删除图片、最后提交数据库清理，失败保留可重试的索引。

## 登录与权限

应用自有账号登录，PBKDF2-SHA256 保存密码，HMAC 签名的 `shiti_session` cookie 有效期 30 天。每次认证回查 `users` 的状态、角色和 `session_epoch`。密码重置、停用会使旧会话失效；缺少 epoch 的历史 cookie 按零处理。

页面使用 `getSessionUser`/`requireAdmin`，API 使用 `authenticate`/`authenticateAdmin`/`authenticateForAi`。匿名接口返回401，普通账号访问管理接口返回403；页面按登录状态跳转。禁止仅凭 cookie 签名认定账号仍可用。

生产禁止 `TRUST_OAI_HEADERS=1`。nginx 清空 `oai-authenticated-user-*` 请求头，应用也禁止信任这些头。

公开注册需要微信号，账号默认体验七天；管理员创建与存量长期账号的期限为 NULL。AI 接口检查体验期限，历史读取不受体验期限限制。当前管理员不能停用、删除或降级自己，最后一个启用管理员受到事务保护。

删除账号先标记并停用，阻止重新启用；R2 图片清理失败保留数据库供重试。账号和内容删除会真实删除资料，线上验证禁止删除真实用户。

## 后台与界面

`app/admin/admin-console.tsx`、`app/admin/admin.css` 使用现有浅色、蓝紫色主操作和紧凑表格。保留现有视觉风格。栏目、内容搜索、用户、上传批次与学科条件通过 URL 恢复；后台与普通学习页面外壳分开。

修改后运行构建、类型检查及适当的真实 HTTP、浏览器验证。界面元素通过 DOM、文本和元素属性定位；截图只检查视觉效果。不得用示例业务资料填充页面。

## 部署

SSH 别名 `server-198`，项目路径 `/opt/shiti-mistake-notebook`，PM2 进程 `shiti-notebook`，应用监听 `127.0.0.1:3105`。

主入口 `https://study.chumenclub.com/`；`study.trumen.club` 与 `study.zxai.studio` 跳转到主入口。IP 备用入口监听8095。主域名 DNS 在 DNSPod，证书由 certbot 管理。代理共享配置位于 `/etc/nginx/snippets/shiti-app.conf`，登录限流位于 `/etc/nginx/conf.d/shiti-limit.conf`。

服务器已运行 PostgreSQL；应用数据库和应用角色独立创建，禁止复用其他项目数据库或账号。上线迁移前备份线上真实数据库与对象存储；保持原服务可用，迁移后核对记录数、账号关系与图片读取，再切换应用连接。

`.dev.vars` 保存 `DATABASE_URL`、`DEEPSEEK_API_KEY`、至少32字符的 `SESSION_SECRET`；`.deploy.vars` 保存既有账号配置。二者权限600，禁止进入Git。Wrangler 按配置文件目录加载密钥，运行时通过绝对路径 `--env-file` 指定 `.dev.vars`。

`deploy.sh` 只能执行 `git pull --ff-only`，不得使用Git回滚或强制覆盖。部署进程脱离 SSH，日志保存在项目 `work/` 专用目录。日志明确出现“部署完成”且验证通过才视为发布成功。nginx修改后另行执行配置测试和reload。

域名公网验证从服务器执行，本机代理可能使用fake-IP。未授权不得提交、推送或发布。

## 文档

- 后台规格：`docs/specs/changes/admin-management.md`
- 后台交付：`docs/delivery/features/admin-upgrade/management.md`
- 后台架构：`docs/architecture/overview/admin.md`
- 默认账号：`docs/architecture/default-accounts.md`

项目规则只维护在本文件，根目录 `CLAUDE.md` 仅包含 `@AGENTS.md`。
