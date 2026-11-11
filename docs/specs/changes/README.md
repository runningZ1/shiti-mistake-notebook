# 变更方案

已有功能调整在此写一页纸或完整迭代 PRD；同名子目录保存 UI-DESIGN/TECH。变更注明所属模块、基线版本、覆盖范围和生效关系；批准并生效后在原规格添加反向指针。

任务引用确切版本和章节。重叠变更先协调，不按日期自动覆盖；正文能独立理解，阅读入口不再依赖寻找散落的修改记录。

- [统一支付宝支付接入核查与方案](alipay-payment.md)：v0.1.0 草案；网关返回 503，来源登记、共享密钥及本地公网回调条件待补齐，尚未实施。

2026-11-06 本地实施以 [支付实施基线](alipay-payment/IMPLEMENTATION.md) 和 [交付记录](../../delivery/features/alipay-payment.md) 为准；上方11月3日草案仅保留历史核查状态。业务端已实现，真实支付未开放；后续自动化验收由用户执行。

- [管理员小额支付测试页](alipay-payment/ADMIN-TEST.md)：支持一分钱与指定金额，管理员专用、独立开关，测试收款不增加会员天数。

- [每日错题整理与剪贴打印](daily-mistake-printing.md)：v0.1.0核心范围已于2026年11月11日 21:48:58（北京时间）发布。[生产发布记录](../../delivery/features/daily-mistake-printing-release-20261111.md)包含备份、正式迁移、数据逐记录保留、97个对象内容校验及真实两题合并下载验收；[技术方案](daily-mistake-printing/TECH.md)和[开发验收](../../delivery/features/daily-mistake-printing.md)保留实现依据。多孩与收费仍为独立待决项，实体打印与超大批量保留实测边界。
