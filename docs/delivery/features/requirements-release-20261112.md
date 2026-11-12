# 全量需求发布记录

用户已明确授权提交推送 GitHub 并部署服务器。

目标仓库：runningZ1/shiti-mistake-notebook，main；服务器server-198，/opt/shiti-mistake-notebook；主域名https://study.chumenclub.com/。

部署前检查：本地和服务器基线均为b9a786e；服务器工作区干净。新增R2、百度OCR与执行器配置，不改原数据库、会话密钥或会员开关。敏感配置仅通过被忽略的私有文件传输，不进入提交。

部署脚本补充数据库自定义格式备份、历史图片归档与完整性检查、迁移后逐记录哈希核对及默认档案关系验证，并启动shiti-processing-worker。构建后应用正式迁移，不执行Drizzle伴随差异文件。

本地既有证据见[实施与验证](requirements-implementation.md)：94项Workers HTTP、35项迁移保护、21项学习持久化、63项历史导入、真实OCR与后台分析、类型/Lint/构建。发布是否成功以远程日志与域名实测为准。

## 发布结果

发布记录更新时间：2026年11月12日 19:13:19（北京时间）。

- 功能提交：`09daf84b42c299930bc3c95c9ad8729c023db97b`，已推送GitHub main并在服务器构建。
- 脱离SSH的部署进程退出码0，`work/requirements-release/deploy.log`明确出现“部署完成”。SSH启动有间歇断连，确认未启动后改为独立会话进程执行；不将断连视作部署成功。
- 新增正式迁移0006–0012全部执行成功，0001–0005校验和保持。
- 私有备份：`/opt/shiti-mistake-notebook/work/deployment-backups/20261112T111133Z/`；database.dump约77KiB，legacy-objects.tar.gz约82MiB，均600权限。数据库归档目录、历史图片tar目录均验证通过，未做备份恢复演练。
- 逐记录哈希验证204条原始记录保留：users 13、uploads 41、upload_objects 1、mistakes 146、practice_papers 2、knowledge_units 0、essay_reports 1；检查仅允许明确学科别名规范化，原上传标签另存original_subject。账号ID、密码哈希、会员期限、原图键、错因和已有报告均按旧列参与核验。
- 默认档案回填关系校验通过。原R2本地对象目录保留，新上传使用配置好的远端私有R2。
- PM2 shiti-notebook、shiti-processing-worker均online；执行器重启次数0、错误日志0字节，pm2 save完成。
- 正式域名 `https://study.chumenclub.com/` 的27项实测通过：公开页面、匿名401、普通用户管理接口403、真实管理员/普通用户登录、档案/作业/学习证据/练习/作文接口200。
- `/api/status`返回aiConfigured、ocrConfigured、storageConfigured均true。实际历史JPEG读取443655字节，SHA-256为27f09aff2f7055b8111a239c1c308f25ab6aedcf74fb78279a8f0bf79f460057。
- 浏览器实际登录默认账号，新版今日/作业/错题本/练习与复习/作文导航与默认档案入口可见，无伪造资料填充。

服务器证据：`work/requirements-release/online-verification.json`、`work/requirements-release/deploy.log`、备份目录的preservation-result.json。本地保留正式站截图`work/requirements-release/production-workspace.png`。凭据未进入Git或记录正文。

代码部署完成不等于全部使用验收：Word/WPS实际分页、纸面打印及家庭多孩/作文连续使用仍沿用实施记录中的边界。未执行实际付款或变更会员价格/规则。
