# 拾题 · 智能错题本

拍照上传试卷或作业，由 DeepSeek 视觉模型结合已有批改或自动逐题批改，把错题归档，再按需生成举一反三练习。

入口：<https://study.chumenclub.com/>

## 能做什么

- **拍卷批改**：一次最多 4 张 JPG、PNG、WEBP。已有批改的作业参考原批改，未批改的作业逐题判断对错，并给出解题思路。看不清的题目不会自动归档。
- **错题本**：按科目、日期浏览，搜索题目或知识点，点开卡片查看答案、解析和来源页码。单道错题可下载 Word。
- **举一反三**：对一道错题再出 1 到 5 道类似题。
- **知识图谱**：从已归档错题和单元练习卷的最近一次批改聚合知识点，按错误次数和作业来源排序，可按科目、单元查看，并手动确认单元归属。
- **单元练习卷**：填写科目、单元和重点知识点，按 3、5、10 题的固定结构出卷，在线作答、提交批改，也可下载题目与答案分开的 Word。
- **英语作文分析**：上传作文和题目照片，核对识别出的原文，再生成内容、语言、结构、书写点评、逐句批改、润色和佳句参考。作文不进入错题本，照片只用于当次分析。
- **账号**：开放注册，新账号免费体验 7 天。到期后已有错题仍可查看，继续分析和出卷需要开通 VIP（¥99/月）。管理员在 `/admin` 新建、停用、重置密码、延长体验或开通长期使用。

## 本地开发

需要 Node.js `>= 22.13.0` 和可连接的 PostgreSQL。应用通过 vinext/Workers 运行，Drizzle ORM 连接真实 PostgreSQL，上传图片继续存于 Wrangler 本地 R2。

仓库根目录的配置文件均不进入 Git：

- `.env.postgres` 保存本地数据库脚本使用的 `DATABASE_URL`，由 Node.js `--env-file .env.postgres` 加载。
- `.dev.vars` 保存应用运行时的 `DATABASE_URL`、`DEEPSEEK_API_KEY`、`SESSION_SECRET`。Wrangler 从这个文件读取变量，`DATABASE_URL` 必须与数据库脚本连接的目标一致。使用项目忽略的配置脚本将本地数据库连接地址合并至此文件。
- `.deploy.vars` 保存真实管理员和普通用户的 `SHITI_BOOTSTRAP_*`、`SHITI_DEFAULT_*` 凭据，供初始化及部署验证使用。详见[默认登录账号](docs/architecture/default-accounts.md)。

```bash
npm run install:ci    # 按锁文件安装依赖
npm run db:migrate    # 应用 PostgreSQL 迁移
npm run accounts:seed # 补齐缺少的真实账号，校验凭据与角色
npm run accounts:check # 只读核对 PostgreSQL 中的两组账号
npm run dev           # 开发服务，端口 5173
npm run build         # 构建到 dist/
npm run lint
npm run db:generate   # 改 db/schema.ts 后生成 PostgreSQL 迁移
```

本地预览构建产物时，显式传入仓库根目录 `.dev.vars` 的绝对路径；Wrangler 按配置文件所在目录解析默认变量文件。

```bash
npm start -- --port 3105 --env-file "$PWD/.dev.vars"
```

PostgreSQL 迁移位于 `db/migrations/`，`scripts/migrate-postgres.mjs` 用 `schema_migrations` 记录文件名和校验和。已执行的迁移只能追加后续迁移；修改其内容会报错。`drizzle/` 和旧 SQLite 迁移辅助脚本保留为历史数据来源归档。

导入原有 SQLite 业务数据前，先应用 PostgreSQL 迁移，再指定原始 SQLite 文件的绝对路径：

```bash
npm run db:import -- /absolute/path/to/original.sqlite
```

导入脚本以只读模式打开原始数据库，在一个事务中向空目标库导入真实记录，并保留账号 ID 与密码哈希。导入后再核对默认账号。图片对象继续使用原有 `.wrangler/state` 中的 R2 数据。

## 部署

服务器 `198.44.177.126`，目录 `/opt/shiti-mistake-notebook`，pm2 进程名 `shiti-notebook`，nginx 反代到 `127.0.0.1:3105`。

```bash
ssh server-198 "cd /opt/shiti-mistake-notebook && mkdir -p work && \
  (setsid nohup bash deploy.sh > work/shiti-deploy.log 2>&1 < /dev/null &)"
```

服务器 `.dev.vars` 必须配置真实 PostgreSQL 的 `DATABASE_URL`，`.deploy.vars` 必须包含可用的管理员与普通账号凭据，文件权限均为 600。脚本通过 `git pull --ff-only` 更新代码，完成安装、构建、PostgreSQL 校验和迁移、账号初始化、PM2 重启，再使用现有账号验证状态、登录、错题读取和后台权限。验证中间文件保存在 Git 忽略的 `work/`，退出时清理。

日志保存在 `work/shiti-deploy.log`，尾部出现 `==> 部署完成` 表示部署验证通过。`deploy.sh` 只重启应用，改了 nginx 配置要另行 `nginx -t && systemctl reload nginx`。

开发约定、登录机制、迁移和验证要求写在 [AGENTS.md](AGENTS.md)。
