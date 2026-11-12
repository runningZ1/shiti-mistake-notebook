# 全量需求发布记录

用户已明确授权提交推送 GitHub 并部署服务器。

目标仓库：runningZ1/shiti-mistake-notebook，main；服务器server-198，/opt/shiti-mistake-notebook；主域名https://study.chumenclub.com/。

部署前检查：本地和服务器基线均为b9a786e；服务器工作区干净。新增R2、百度OCR与执行器配置，不改原数据库、会话密钥或会员开关。敏感配置仅通过被忽略的私有文件传输，不进入提交。

部署脚本补充数据库自定义格式备份、历史图片归档与完整性检查、迁移后逐记录哈希核对及默认档案关系验证，并启动shiti-processing-worker。构建后应用正式迁移，不执行Drizzle伴随差异文件。

本地既有证据见[实施与验证](requirements-implementation.md)：94项Workers HTTP、35项迁移保护、21项学习持久化、63项历史导入、真实OCR与后台分析、类型/Lint/构建。发布是否成功以远程日志与域名实测为准。

发布结果：进行中，待补充目标提交、备份路径、迁移与线上验收。
