# 私有 R2 与百度试卷切题接入

## 行为

新作业照片先上传私有 Cloudflare R2，再请求百度 `paper_cut_edu`，最后把 OCR 文本交给 DeepSeek 解题。模型不再接收图片，不重写归档的题干、作答及坐标。含配图、缺少作答或低置信度的题目暂列待核对，不自动归档。

独立 `POST /api/ocr` 接受 multipart `files`（1–4 张），仅调用百度 OCR，返回完整的 `pages`，可用于后续联调。要求已登录、有效体验/会员和同源请求；结果不缓存。此诊断接口不保存照片或业务记录。

`POST /api/analyze` 保持现有响应结构，在 `uploads.ocr_result` 中保存 OCR 原始结构及页码、原图尺寸。新键为 `{userId}/{uploadId}/cloud/{index}`。原有 `{userId}/{uploadId}/{index}` 仍读本地 `BUCKET`，不自动迁移历史资料。读取、Word 导出、批次删除和账号删除使用同一存储适配器。桶保持私有，浏览器经原有账号鉴权接口读取图片，无需公网域名、公开桶或 CORS。

作文原文也改用百度 OCR；用户仍须核对正文与教师批注，题目要求由用户输入。作文分析只使用核对后的文字，不评估照片书写。作文照片仍遵循原有仅当次处理、不保存历史图片的产品行为。

## 配置与迁移

本机已创建私有桶 `shiti-homework-photos`。所有密钥仅放入忽略提交的 `.dev.vars`，配置项见 `.env.example`。R2 的 S3 凭据应只授予此桶对象读写权限。自托管 Wrangler 的本地 `BUCKET` 仅用于读取历史图片，不能作为新上传的云存储替代。缺少云存储/OCR 配置时返回 503。

百度使用已有应用的 API Key/Secret Key，后端缓存 OAuth access_token，到期前刷新，110/111 错误刷新后重试一次；不对识别调用进行一般性自动重试，避免重复计费。网络请求有超时，并使用 Workers 支持的 `redirect: manual`。错误日志不记录带 token 的 URL、密钥或识别正文。

上线前备份数据库并执行 `db/migrations/0006_upload_ocr.sql`，再切换构建。该迁移保留历史记录，旧上传的 `ocr_result` 为 NULL。Drizzle PostgreSQL 快照已同步。此项接入尚未提交、推送或部署；生产迁移未执行。

百度接口限制：本次入口接受 JPG/PNG，原文件最多 8MB；按 URL 编码后的请求再校验 10MB 上限，边长 15–8192px。WEBP 不再进入识别。为保持原图坐标系，关闭方向检测和图像增强，上传时请保持照片正向。坐标从百度的四角点转换成现有 0–1000 归一化题框。百度返回的参考答案仅视为照片中识别到的内容，不当成接口生成的标准答案。

S3 访问使用 Cloudflare 官方示例支持的 `aws4fetch`（本次查询最新为 1.0.20），XML 使用 `fast-xml-parser`。R2 的 S3 接口没有单独的年度版本号；签名采用 SigV4、region=auto。保留已有 multipart 日志及删除失败后可重试的清理流程。

## 核验

已完成：

- `npx tsc --noEmit` 通过；Lint 为 0 错误、8 条既有类别警告。
- `node --test scripts/ocr-contract.test.mjs scripts/essay-ai.test.mjs scripts/ai-practice.test.mjs`：15/15 通过，新增检查只做图片校验和请求编码，不模拟 OCR 业务响应。
- 原 `dist/client` 被其他预览占用，在 `work/r2-ocr-upgrade/build-check` 完成隔离构建，未停止其他任务进程。校验产物和复制源码均在忽略提交的 `work/`，TypeScript/ESLint 排除此目录。
- 用户确认后创建 `shiti-homework-app`，仅限 `shiti-homework-photos` 桶对象读写，密钥写入本机 `.dev.vars`。
- 在真实 Workers/workerd 运行时连接真实云桶，通过 multipart 创建、写入、完成、回读字节一致性、完成后的 abort 幂等性、对象删除、删除后读取为空、未完成上传 abort；专用验证对象已清理。结果在 `work/r2-ocr-upgrade/storage-verification.json`。
- 百度现有“文字识别专用”应用凭据已写入本机配置，OAuth 鉴权成功，未调用计费的试卷识别接口。鉴权成功不代表此应用的试卷切题权限和额度已验收。
- Workers `/api/status` 返回三个 provider 配置均为 true；匿名 OCR 返回 401、异源 analyze 返回 403。使用真实本地管理员登录成功，WEBP 和损坏图片分别在识别/分析入口被 400 拒绝，无 OCR 费用。记录在 `work/r2-ocr-upgrade/http-verification.json`。
- 本地 PostgreSQL `127.0.0.1/shiti` 已先生成 `work/r2-ocr-upgrade/shiti-before-0006.dump`（52,736 字节），再由校验和执行器补齐 0005、0006；生产数据库未操作。

后续仍须用用户选定的真实试卷验证识别准确性、题目坐标、试卷切题权限/额度及全流程归档；历史图片与 Word 的浏览器验收尚未完成。此次未执行真实试卷的计费 OCR 调用。

## 官方依据

- [百度试卷切题识别](https://cloud.baidu.com/doc/OCR/s/Tlqom5gvh)，本次完整读取正文：接口、参数、返回字段；页面标注更新于 2026-01-16。
- [Cloudflare R2 aws4fetch 示例](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/)
- [R2 S3 兼容 API](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 认证与 API Token](https://developers.cloudflare.com/r2/api/tokens/)

## 后续真实图片联调

已完成公开图片 OCR 和浏览器上传测试，并修正真实返回字段兼容问题。初次因 DeepSeek 余额不足失败；用户充值后两张作答照片均成功完成分析和上传保存，但题目全部待核对、未自动归档错题，详见[真实图片联调记录](r2-baidu-ocr-live-verification.md)。先前“未调用真实试卷 OCR”的描述仅指初始接入阶段。
