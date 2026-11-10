# 支付接入实施基线（2026-11-06）

本文件补充原核查草案，以用户本次提供的 2026-11-06 指南和支付侧确认信息为协议依据。用户已要求开始开发；本次完成本地实现，不提交、推送或部署，不向未开放网关发送真实订单。

## 产品与验收

- REQ-PAY-001：沿用现有 VIP 月卡 99 元／30天；服务端固定商品快照与金额。暂按现有草案推荐的较晚有效期限顺延实现，保留未用完的体验，计费规则待用户最终确认后才开放收费。
- REQ-PAY-002：登录用户可创建／恢复待支付订单、重试同一订单、查看自己的订单；长期账号及管理员不购买。账号删除时订单保留且解除用户外键，已付款但不可交付的订单进入人工核对状态。
- REQ-PAY-003：严格遵循原始拼接、HMAC-SHA256、标准 Base64、五分钟回调窗口。付款返回参数不作为成功依据。
- REQ-PAY-004：通知持久化；早到事件等待可信下单映射绑定。订单锁、用户行锁、唯一交付记录保证并发及重复事件只延长一次。权益更新与 PAID 在同一数据库事务完成。
- REQ-PAY-005：真实下单需 PAYMENT_ENABLED=true 且所有配置齐全。未开放时显示暂不可用；回调不依赖浏览器会话，处理成功返回 200 {success:true}，配置／数据库故障返回 503，错误签名或订单冲突返回非2xx。

## 页面与交互

保留 pricing.css 的浅色、紫色主按钮、圆角卡片。会员页替换占位微信收款弹窗，跳转 /payment；收银页显示账户、99元／30天、支付前说明和订单历史；按钮提交中禁用，失败显示可重试提示。结果页 /payment/result 每3秒轮询自己的订单，最多20次，超时保留待确认状态，允许手动刷新。无参数时查询最新订单，支持付款关页后的恢复。历史限50条，键盘可操作，状态区域 aria-live，窄屏卡片垂直排列。

## 技术与数据

追加 0002_payment.sql，不更改已执行迁移。新增 users.paid_ends_at、payment_orders、payment_events、payment_deliveries。以整数分保存金额，订单号 ST_加UUID，网关映射唯一；事件以业务订单和网关订单唯一去重，不存签名或完整付款链接。通知金额原文验签后用 BigInt 比分。配置仅服务端 Cloudflare env；签名使用 Web Crypto。

订单创建先锁用户，复用同来源已有待支付订单，防并发双击。网络调用前持久标记已发起及短期租约，网络调用不占数据库事务。超时释放租约，下次使用原订单重试。映射绑定和早到事件处理同事务。所有支付事务按用户→订单顺序锁定，避免与账号操作形成反向锁序。用户停用、删除、变为长期权限期间已付款订单记 PAID/REVIEW，保存事实并等待人工处理，不伪造交付。

接口：POST/GET /api/orders，POST /api/orders/{id}/pay，GET /api/orders/{id}，POST /api/payment-callback。订单写操作要求真实会话及同源；订单查询按用户过滤且 no-store。旧 /api/pricing/apply 关闭，防止匿名修改联系信息及假成功。授权统一计算体验与付费较晚期限，后台显示付费期限。

## 对接与上线

固定 source=study.chumenclub.com，创建接口=https://skills.chumenclub.com/api/cross-site-payment/create，通知=https://study.chumenclub.com/api/payment-callback，返回=https://study.chumenclub.com/payment/result。返回地址不携带动态订单号，页面查询本人最新订单或本人订单列表。

上线前备份 PostgreSQL，执行迁移再发布代码；配置 PAYMENT_GATEWAY_URL、PAYMENT_SOURCE、PAYMENT_SHARED_SECRET、PAYMENT_RETURN_URL，保持 PAYMENT_ENABLED=false。支付维护者登记 source、通知、返回白名单，并提供密钥及开放通知后才能启用。不要单独更换密钥，旧未结订单需先对账。手机唤起、退款和网关查单接口均无已交付协议，不自行实现猜测路径。

## 测试与进度

使用独立真实 PostgreSQL schema 验证迁移、早到通知、重复／并发回调、金额／映射冲突、事务回滚及删除保留。协议测试使用隔离测试密钥，只说明协议与事务正确，不能证明支付宝收款。运行类型、lint、build及本地HTTP检查。真实0.10元付款、线上HTTPS回调、支付服务重试与移动端均须开放后联合验收；当前不得宣称通过。
