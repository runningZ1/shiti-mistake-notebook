# 默认登录账号

两组初始账号凭据保存在项目根目录的 `.deploy.vars`，该文件已被 Git 忽略。密码不写入文档或前端代码。

| 用途 | 用户名变量 | 密码变量 | 入口 |
|---|---|---|---|
| 管理员 | SHITI_BOOTSTRAP_USER | SHITI_BOOTSTRAP_PASSWORD | /login 登录，随后 /admin |
| 普通用户 | SHITI_DEFAULT_USER | SHITI_DEFAULT_PASSWORD | /login 登录，随后 / |

账号记录保存在真实 PostgreSQL 的 `users` 表。管理员和普通用户的用户名、ID 必须分别唯一，各自拥有独立的数据归属。历史账号 ID 必须保留，修改 ID 会影响原有错题与上传记录的关联。

## 环境配置

- `.env.postgres`：本地数据库脚本使用的 `DATABASE_URL`，由 Node.js 的 `--env-file .env.postgres` 加载。
- `.dev.vars`：应用运行时使用的 `DATABASE_URL`、`DEEPSEEK_API_KEY`、`SESSION_SECRET`，由 Wrangler 加载。数据库地址须与初始化脚本连接的数据库一致。
- `.deploy.vars`：`SHITI_BOOTSTRAP_*` 和 `SHITI_DEFAULT_*`，只供初始化和部署验证使用。每组包含 `USER`、`PASSWORD`，可选 `NAME`、`ID`。

这三个文件均不进入 Git。服务器上将配置文件权限设为 600。Wrangler 使用名为 `.dev.vars` 的文件加载运行时变量；本地 `.env.postgres` 中的连接地址应通过项目忽略的配置脚本合并至 `.dev.vars`。

`SHITI_BOOTSTRAP_ID` 未配置时为 `shiti`，`SHITI_DEFAULT_ID` 未配置时为 `shiti-user`。已有环境配置中的 ID 应保持原值。

## 初始化与核对

```bash
npm run db:migrate      # 连接真实 PostgreSQL，应用 db/migrations/ 中的迁移
npm run accounts:seed   # 补齐缺少的真实账号并核对凭据、角色和状态
npm run accounts:check  # 只读核对两组真实账号，不输出密码和哈希
```

`accounts:seed` 从 `.deploy.vars` 读取凭据，通过参数化 SQL 直接写入 PostgreSQL。重复执行保留已有账号的密码、昵称、角色和状态；仅当数据库完全没有管理员时，才将启用中的引导账号设为管理员。ID 与用户名对应关系冲突会立即报错。

初始化和检查都会核对数据库中的密码哈希与配置是否一致，并检查管理员和普通用户的角色、启用状态与删除状态。更改环境文件中的密码不会重置已有账号密码。已有账号请在后台重置密码，并更新部署使用的真实凭据配置。

单独初始化账号时，先加载对应凭据文件：

```bash
node --env-file .env.postgres --env-file .deploy.vars scripts/seed-user.mjs --admin
node --env-file .env.postgres --env-file .deploy.vars scripts/seed-user.mjs --default-user
```

服务器部署从 `.dev.vars` 读取 `DATABASE_URL`，直接运行迁移和默认账号脚本。部署验证使用 `.deploy.vars` 中的真实管理员、普通用户登录，核对错题读取、后台页面和后台接口的权限。

## 历史数据导入

旧 SQLite 数据源通过 `scripts/import-postgres.mjs` 以只读模式打开，数据导入已应用迁移的空 PostgreSQL 目标库。导入保留用户 ID、密码哈希和业务记录关联。重复导入发生主键冲突时会中止整个导入事务。

```bash
npm run db:import -- /absolute/path/to/original.sqlite
```

图片继续使用原有 `.wrangler/state` 中的本地 R2 数据。导入账号和业务记录时，应保留这些图片及其对象键。
