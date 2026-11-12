# 公开真实图片联调记录

## 结论

用户充值后，百度 paper_cut_edu → DeepSeek 文本分析 → PostgreSQL 保存 → 浏览器展示的完整链路已成功运行两次。两张作答照片分别返回 3 道、8 道题，最终均为待核对、确认错题 0 道，未向错题本写入无法确认的题目。原图在真实 R2 持久保存且回读校验一致。链路可用不等于自动判题准确性已验收。生产未发布。

## 图片与接口

| 来源 | 本地图片 | 尺寸 | POST /api/ocr |
| --- | --- | --- | --- |
| https://zy.21cnjy.com/22180600 | grade7-exam.png | 860×1215 | HTTP 200，10 道题 |
| https://udn.com/news/story/6898/8039311 | answered-jelly.jpg | 800×600 | HTTP 200，3 道题 |
| https://udn.com/news/story/6898/7495756 | answered-rounding.jpg | 1280×1706 | HTTP 200，8 道题 |

原图片、来源和完整实际响应保存在忽略提交的 `work/r2-ocr-live-test/`。所有图片来自公开网页，未生成或补写学生答案。题目个数包含照片边缘的不完整题目，不代表每题完整或识别准确。

## 实测修复

1. 百度真实响应的 `elem_type` / `qus_type` 为字符串，`qus_location` 是 `{points:[{x,y}]}`，文字行位置为矩形对象。修正类型与题框解析，保留原始 API 响应；`Number(elem_type)` 用于元素分类。
2. 从公开原图获得的真实响应加入 `scripts/fixtures/baidu-paper-cut-real.json`，回归核对题干、手写算式和归一化题框，未使用模拟 OCR 结果。
3. 运行时 DeepSeek 密钥与现有 `.env.local` 不一致；仅核对长度和指纹，在 `/models` 鉴权成功后同步有效现有密钥至 `.dev.vars`，未输出密钥。
4. 真正的 `/responses` 调用随后返回 `Insufficient Balance`；`/user/balance` 返回 HTTP 200，`is_available=false`。将 401/402/429 转为明确中文错误，分析入口保留适当 HTTP 错误状态，避免暴露密钥片段和请求细节。

## 浏览器与存储

在 http://127.0.0.1:3107/ 使用当前真实登录账号操作。启用 ChatGPT 扩展的本地文件访问后，`answered-jelly.jpg` 经文件选择框上传，预览成功，点击“开始智能分析”后实际请求进入百度 OCR 和 DeepSeek；第一次因余额不足返回错误；用户充值后重新发起，两次请求均正常完成。

失败阶段的分析未被当成完成的上传/错题写入业务表，已执行 R2 abort/delete 清理，当时真实云桶剩余对象数为 0。成功阶段的两条上传记录已保存原始 OCR JSON；两张原图的真实 R2 回读 SHA-256 均与下载原图一致。保留既有 `upload_objects` 重试索引的设计不变。

## 验证和限制

修复后的 TypeScript、隔离构建、定向 ESLint、16 项回归检查通过。浏览器最终中文提示截图存于 `work/r2-ocr-live-test/browser-analysis-result.png`。

本批含作答图片有大量低置信度元素；现有保守规则会将其列为待核对。未通过放宽阈值、伪造模型响应或更换无关模型来制造分析成功。用户充值后余额接口 `is_available=true`，页面已成功分析；但本批题目全部待核对，尚未形成可验收的自动错题归档样本，后续仍需更清晰的已作答试卷验证判题和归档准确性。


## 充值后复测

- 第一张 `answered-jelly.jpg`：上传批次 `94b36a3f-bd97-4c6f-83d1-64cb3e17b847`，OCR 3 题，最终全部待核对。
- 第二张 `answered-rounding.jpg`：上传批次 `4e48b84d-5cf1-474e-8741-a985ac13d58e`，OCR 8 题，最终全部待核对。
- 原图回读：分别 69,148 和 471,728 字节，SHA-256 校验均一致，记录 `work/r2-ocr-live-test/saved-r2-checks.json`。
- 修复了模型初步摘要与服务端保守判定统计矛盾的问题：摘要从最终 grading/mistakes 数量生成。
- 修复后重新构建，TypeScript、定向 ESLint、16 项相关检查通过；本地服务继续运行于 http://127.0.0.1:3107/，未提交、推送或部署。
