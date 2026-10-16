# 子账号共享钱包与每日额度修复

## 原因

实际生成按管理账号的工作区钱包预留、结算，但登录会话和余额接口曾读取
子账号个人钱包，导致个人余额为 0 的子账号在前端被误拦截。
`unlimited` 只取消个人每日上限，不代表免计费，也不创建积分。

## 修复边界

- 登录、JWT、服务端会话、余额接口统一解析钱包所有者和实际操作人。
- 子账号展示“共享积分”，实际扣费仍归管理账号；个人额度归实际操作人。
- `0` 禁止新生成；正数限制个人每日积分；`NULL/unlimited` 不限每日用量。
- 共享钱包为 0 时仍拒绝新生成，不回退到子账号个人钱包或旧积分字段。
- 额度和余额按当前身份刷新，丢弃已经被较新响应覆盖的旧响应。
  身份变更前的在途响应不能更新新身份；重叠慢请求不会造成永久加载。
- 工具箱、分镜、资产、音色页区分加载中、禁止生成、额度用尽和积分不足。
- 异步任务只保存服务端验证的实际操作人；worker 使用隔离上下文恢复，
  防止串用其他任务的个人额度，或相信浏览器伪造的 `quotaUserId`。
- 预留时锁定钱包和操作人记录，在同一事务内再次校验个人每日额度，
  避免并发请求共用同一份剩余额度。事务内额度拒绝保留原错误类型。
- 已提交任务的结算和失败退款仍按原冻结归属处理，不因管理员改为 0
  而强制取消；失败退款恢复相应在途额度。

## 验证

相关单元回归：

```sh
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run \
  tests/unit/auth tests/unit/billing tests/unit/frameos tests/unit/canvas \
  tests/unit/user-api/billing-routes-internal-agent.test.ts \
  tests/unit/worker/shared.direct-run-events.test.ts
npm run typecheck --silent
```

真实 MySQL 事务、任务归属、结算与并发回归（仅专用本地测试库）：

```sh
npx cross-env DATABASE_URL=mysql://root:root@127.0.0.1:3307/nori_test \
  REDIS_HOST=127.0.0.1 REDIS_PORT=6380 BILLING_TEST_BOOTSTRAP=1 vitest run \
  tests/concurrency/billing/shared-wallet-quota.concurrency.test.ts \
  tests/concurrency/billing/ledger.concurrency.test.ts \
  tests/integration/billing/submitter.integration.test.ts \
  tests/integration/billing/ledger.integration.test.ts \
  tests/integration/billing/worker-lifecycle.integration.test.ts
```

浏览器验证方式见 `tests/browser/README.md`：真实组件、本地模拟 API，
不调用上游生成、不改生产数据。

2026-10-12 本地验证结果：

- 138 个单元测试文件、786 项测试通过。
- 5 个真实数据库测试文件、31 项测试通过。
- TypeScript 类型检查及 `git diff --check` 通过。
- 浏览器共享钱包、上限 0、取消上限、余额耗尽、旧响应、弱网重叠读取、
  身份切换通过；6 种主画布尺寸和 48 个弹窗边界场景通过。
- ESLint 两次运行仍停留在规则依赖加载，已停止；不计入通过项。

本修复仅修改本地代码，不部署、不转移账号资金、不修改服务器密钥。
