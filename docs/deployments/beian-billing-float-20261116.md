# 计费冻结浮点比较修复（2026-11-16）

## 问题

无限积分成员本人余额低于报价时，系统会从管理账号自动补足差额再冻结。冻结条件用 JS number 绑定到 MySQL，`DECIMAL(18,6)` 与 `DOUBLE` 比较时，补足后余额恰好等于报价的金额会被判为不足，事务回滚并返回 `BILLING_AUTO_FUND_FAILED`（前端提示「自动充值未覆盖预订费用」）。

复现数据：余额 0.546756，报价 9.583602，补足 9.036846 后余额为 9.583602，但 `10.546756 + 9.036846` 以 DOUBLE 参与比较得到 9.583602000000001 一侧的误差。

近 30 天 112 个不同报价中，有 4 个会触发：`9.583602`、`9.14004`、`9.84312`、`9.544332`。

## 修复

- `src/lib/billing/ledger.ts`：新增 `moneyToDecimal()`；`reserveWithAutoFund` 的余额比较与差额计算改用 `Prisma.Decimal`（6 位定点）。
- `src/lib/billing/credit-ledger.ts`：`transferPointsInTx` 的管理账号扣减比较改用 Decimal。
- `tests/unit/billing/auto-fund-decimal.test.ts`：回归测试覆盖「补足后恰好等于报价」的场景。

## 发布记录

- 发布目录：`/opt/norivideo/releases/20261116-billing-float`
- source fingerprint：`d0a66388fb06ca9f8ba2badeacae7437d95407d7c532b4ef71f4dda205319179`
- 构建产物 sha256：`e92b6fa31e1192738a04f48fbb502969e02b86bc9184553446db81ef7cdfc49d`
- 候选镜像：`norivideo:release-20261116-billing-float`
- 上一版本：`norivideo:release-20261115-current-workspace`（`81eb0c0f…`）
- 源码基线：上一版 `source.tar.gz`，仅叠加上述两个计费文件与回归测试；未携带工作区其它未发布改动。
- 代码级发布：schema diff 为空，未执行 `prisma db push`；切换前做了数据库备份与受保护文件校验。
- 验证：候选镜像内 `42923.js` 已包含 Decimal 比较；切换后 app/admin 健康检查通过，固定 TOS 校验与探针通过，受保护文件逐字节一致。
