# 支付请求运行时故障复盘（2026-11-06）

## 故障表现

管理员进入 `/admin/payment-test` 后，测试支付最初因 `PAYMENT_TEST_ENABLED=false` 未开放。启用管理员测试支付后，按钮可以点击，真实 ¥0.01 测试订单能够创建，但调用 `POST /api/orders/{id}/pay` 返回 HTTP 503，页面显示“支付服务暂不可用，请稍后重试”。

这次涉及两个独立条件：测试开关决定按钮是否允许操作；支付请求参数决定点击后能否生成付款入口。

## 根因与证据

`lib/payments.ts` 向支付网关发起请求时使用了 `redirect: "error"`。生产应用运行于 Workers 的 workerd 环境，该环境仅支持 `follow` 和 `manual`。不支持的参数使请求在发出前抛出 TypeError，随后被 `paymentFailure` 转换为通用 HTTP 503 响应。

在实际 Workers 运行环境中复现的错误为：

```text
TypeError: Invalid redirect value, must be one of "follow" or "manual"
("error" won't be implemented since it does not make sense at the edge;
use "manual" and check the response status code).
```

排查证据：

- 服务器支付共享密钥与本地 `.dev.vars`、本地独立密钥文件逐值一致，核对过程没有输出密钥内容。
- 支付来源、支付网关地址及付款返回地址满足应用配置检查。
- 原真实测试订单处于 `PENDING`，已标记请求网关，尚未绑定网关订单；请求租约已经释放，可复用原订单重试。
- 在同一服务器上，Node.js 使用当前配置和原真实测试订单请求网关，收到 HTTP 200、`success: true` 及付款链接。
- Miniflare 中使用 workerd 构造相同 `redirect: "error"` 请求，复现上述 TypeError。

这些证据说明密钥可用于真实网关鉴权，同时定位到 Workers 与 Node.js 的请求参数兼容性差异。

## 配置文件权限

服务器 `.dev.vars` 权限为 `600`，表示文件所属账号可以读取和写入，其他账号没有访问权限。应用由该账号运行，能够读取配置。该权限不控制网页路由访问，也不控制支付按钮状态。

管理员测试支付由 `PAYMENT_TEST_ENABLED` 控制；正式会员支付由 `PAYMENT_ENABLED` 控制。两者独立设置，不能用修改文件权限的方式启用支付。

## 修复与发布

修复提交：`58e27807abab3b3621090180094dd81df169cdca`。

`lib/payments.ts` 使用 `redirect: "manual"`，保留后续 `response.ok` 检查。网关返回 3xx 时不会自动跟随跳转，而会进入现有非成功响应处理。

修复经本地提交、推送 `main`、服务器 `git pull --ff-only`、生产构建和 PM2 重启后生效。服务器部署日志明确输出“部署完成”，线上提交与修复提交一致。依赖及数据库结构没有变化。

用户确认测试结束并授权开放普通用户支付后，当前线上配置为：

| 配置 | 值或状态 |
| --- | --- |
| `PAYMENT_TEST_ENABLED` | `true` |
| `PAYMENT_ENABLED` | `true` |
| `PAYMENT_SOURCE` | `study.chumenclub.com` |
| `PAYMENT_GATEWAY_URL` | `https://skills.chumenclub.com/api/cross-site-payment/create` |
| `PAYMENT_RETURN_URL` | `https://study.chumenclub.com/payment/result` |
| 回调接口 | `https://study.chumenclub.com/api/payment-callback` |
| `.dev.vars` 权限 | `600` |

## 验证结果与范围

- 修改后的 `manual` 参数在实际 Workers 运行环境中验证通过。
- `npx tsc --noEmit` 和 `npm run build` 通过。
- `npm run lint` 没有错误，报告六项现有警告。
- 线上构建、重启与 `/api/status` 健康检查通过。
- 从服务器访问正式域名，真实管理员登录、管理员测试页面和测试开关检查通过。
- 复用原 ¥0.01 待付款订单调用生产支付接口，返回 HTTP 200，成功生成支付宝官方付款链接。
- 访问该付款链接，最终支付宝收银台 `excashier.alipay.com` 返回 HTTP 200。
- 付款结果页面返回 HTTP 200。
- 自动验证停在付款入口，没有提交付款。随后用户手动付款并明确反馈“支付已经跑通了”。

此次没有单独提取或核对真实付款回调日志、最终数据库到账状态，因此用户手动测试结果与自动接口验证结果分别记录。正式会员购买和会员天数交付不在本次管理员测试支付验收范围内。

## 正式会员支付开放验证

开放前在服务器 `work/` 中以权限600备份原配置，仅将 `PAYMENT_ENABLED` 设为 `true`，保留其他配置，随后重启 `shiti-notebook` 并通过健康检查。

通过正式域名使用既有真实普通用户登录，`/payment` 返回 HTTP 200，页面不再显示“支付宝支付暂未开放，当前无法付款”。普通用户访问管理员测试接口返回 HTTP 403，账号权限检查保持生效。该验证账号已有长期权限，创建会员订单返回预期 HTTP 409“当前账号已拥有长期权限，无需购买”；下单请求已通过正式支付配置检查，没有创建新订单或提交付款。管理员及长期账号仍无需购买，有体验期限的普通用户可以使用正式会员付款入口。

## 验证中的缺口

初次发布确认了配置、页面、权限和回调拒绝非法输入的行为，但收费开关关闭时没有执行“生成真实付款入口”的完整路径。这些检查无法发现只在下单请求中触发的运行时参数错误。

服务器 Node.js 能成功调用网关，只能证明该进程中的网络、鉴权与网关响应正常。生产应用使用的 Workers 请求实现需要单独验证。

后续支付验证要求统一维护在根目录 `AGENTS.md` 的“支付与外部请求”章节。

## 参考

- [Cloudflare Workers Request 文档](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [支付回调与数据迁移发布记录](payment-release-20261106.md)
