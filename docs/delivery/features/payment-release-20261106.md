# 支付回调公网部署记录

用户于2026-11-06明确授权提交并部署当前最新版本。首次发布时正式会员及管理员测试收费开关均关闭，未向支付网关创建真实订单，未运行自动化测试套件。同日后续已开启管理员测试支付、发布运行时兼容性修复，并由用户完成手动付款；详见[支付请求运行时故障复盘](payment-runtime-20261106.md)。下文记录首次发布的数据迁移与验证范围。

## 发布前核查

本地分支feat/postgres-admin-upgrade包含PostgreSQL迁移和管理员升级，线上main仍为fefb4ad并使用本地D1/SQLite；支付功能依赖新数据层，因此本次包括真实数据迁移。禁止以本地资料覆盖线上。发布采用快进合并main、服务器git pull --ff-only、依赖安装、构建、迁移、重启。

线上资源：server-198、/opt/shiti-mistake-notebook、shiti-notebook、127.0.0.1:3105。迁移前在服务器项目work专用目录备份SQLite、对象存储、原配置和构建产物，创建项目独立PostgreSQL角色及数据库。构建阶段旧服务保持可用；最终迁移时停止旧服务写入，制作一致性SQLite副本后导入，按表记录数、账号ID/密码哈希、图片键核对。失败不清除原SQLite和图片，保留备份用于恢复。

密钥只从用户提供文件通过SSH加密通道传输并写入权限600的服务器.dev.vars，不进入Git、URL、聊天或日志。原线上会话及DeepSeek密钥保留；付款返回页固定https://study.chumenclub.com/payment/result。

## 发布验收范围

检查提交一致、构建成功、迁移完成、PM2在线、公开登录页及付款结果页路由、HTTPS POST回调错误签名拒绝。空JSON回调应返回400；合法格式但错误签名返回401。没有真实订单时，不伪造业务付款来获得200。有效真实通知验签并处理事务成功后才返回200和success=true，此项待支付侧开放后联合验收。

## 发布结果

业务提交093926575ccfa3fbab49865e183cd0a7b7987dd3已快进合并并推送origin/main及原功能分支。线上完成git pull --ff-only、npm依赖安装、五阶段生产构建、0001/0002/0003迁移、SQLite真实资料导入及PM2重启，后台任务明确输出DEPLOYMENT_COMPLETE。备份保存在服务器 `/opt/shiti-mistake-notebook/work/payment-release-20261106T094200Z/`，包含原配置、原构建、SQLite一致性副本及图片对象最终快照；不得对外分享其中凭据或用户资料。

数据核对：users=10、uploads=40、mistakes=144、practice_papers=2、knowledge_units=0、essay_reports=1、upload_objects=0。账号ID与密码哈希、上传归属与图片键逐条一致。默认账号初始化核对通过，原有账号凭据保留。原SQLite与对象存储未删除。

从服务器访问正式HTTPS域名：登录页200；真实管理员和默认用户登录均200；管理员后台、管理员支付测试页、付款返回页、本人订单接口均200。付款开关PAYMENT_ENABLED与PAYMENT_TEST_ENABLED均为false，支付订单数为0。共享密钥已安全写入服务器后端配置，原会话密钥与DeepSeek配置保留。

公网POST https://study.chumenclub.com/api/payment-callback：空JSON返回400（无效通知字段或时间戳）；合法格式但错误签名返回401。说明HTTPS POST已进入回调处理，不再返回404。没有伪造有效付款通知，也没有向真实网关创建订单。真实有效通知的200、支付宝实际收款、两段通知及最终到账状态仍待支付维护者放行后共同验收。

本次未运行自动化测试套件，仅完成部署必要的数据核对与少量HTTP可用性检查。页面点击与实际付款由用户手工验收。
