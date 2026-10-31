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

需要 Node.js `>= 22.13.0`。

```bash
npm run install:ci   # 按锁文件安装依赖
npm run dev          # 开发服务，端口 5173
npm run build        # 构建到 dist/
npm run lint
npm run db:generate  # 改 db/schema.ts 后生成迁移
```

本地预览构建产物：

```bash
npx wrangler dev --config dist/server/wrangler.json --local \
  --persist-to .wrangler/state --ip 127.0.0.1 --port 3105 --inspector-port 0
```

密钥放在仓库根目录的 `.dev.vars`（`DEEPSEEK_API_KEY`、`SESSION_SECRET`），引导账号放在 `.deploy.vars`。这两个文件不进 Git。本地复现生产绑定时，把 `.dev.vars` 复制到 `dist/server/.dev.vars`，因为 wrangler 按配置文件所在目录读取它。

```bash
npm run accounts:check   # 检查默认账号是否齐全
npm run accounts:seed    # 补齐缺少的账号，不覆盖已有账号
```

## 部署

服务器 `198.44.177.126`，目录 `/opt/shiti-mistake-notebook`，pm2 进程名 `shiti-notebook`，nginx 反代到 `127.0.0.1:3105`。

```bash
ssh server-198 "cd /opt/shiti-mistake-notebook && setsid nohup bash deploy.sh \
  > /tmp/shiti-deploy.log 2>&1 < /dev/null & echo 已启动"
```

构建需要 5 到 8 分钟。日志尾部出现 `==> 部署完成` 才算成功。`deploy.sh` 只重启应用，改了 nginx 配置要另行 `nginx -t && systemctl reload nginx`。

开发约定、登录机制、迁移和验证要求写在 [AGENTS.md](AGENTS.md)。
