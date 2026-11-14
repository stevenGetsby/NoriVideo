# 2026-11-14 批次 2：成员点击成员付与积分方式

## 变更范围

- Schema 提交：`44f8ae7 feat: add the member point mode schema field`，新增 `User.pointMode`，默认 `unlimited`。
- 功能提交：`1e9bdbd feat: charge generation to the acting member`。
- 生成以真实点击者为付款人；无限积分成员不足时在同一事务内从直属管理账号补足差额，分配积分成员仅使用自己的余额。
- 管理账号可查看和修改成员积分方式；成员只看到自己的余额与布尔型资金可用状态，历史管理账号代付记录不泄露管理账号的后续余额。
- 切换前的冻结继续结算给原付款人；确认扣款、失败退款、每日额度和工作监督均按成员归属，不重复记账。

## 本地验证

- E2 相关完整单测：60 文件、365 项通过；聚焦单测：15 文件、137 项通过。
- 使用本机隔离数据库 `nori_billing_test` 验证真实 SQL：付款人切换与任务提交 21 项通过；并发与每日额度路由 16 项通过。
- 资产管理真实组件浏览器回归 7 组通过；项目层级浏览器回归 7 组通过。
- 完整画布浏览器回归通过，覆盖付款人、零余额、积分模式、陈旧余额响应、身份切换及每日额度；日志：`/tmp/nori-e2-canvas-browser-final5.log`。
- `npx prisma validate` 与 `git diff --check` 通过。
- TypeScript 仍有既有 12 条错误，全部来自 4 个 Finder 重复文件；正式源码没有新增错误，未修改重复文件。
- 自动补足、补冻、失败退款、付款归属和并发守恒由隔离数据库集成/并发测试覆盖；本地及测试机均未执行真实付费生成。

## 测试机

- 部署：2026-11-14，`45.76.215.9`；服务复核至 23:29（UTC+8）。
- 部署源码包含 `1e9bdbd` 及此前的批次 3 混合提交，按 R3 使用整个工作区的干净部署快照，无 `.git`、`.claude`、测试产物、环境文件或 Finder 重复文件。
- 源码包 SHA-256：`40421312acdd2a8909a9f5692758d5bce031becce7bfe65067e39c8a692484db`，本机与测试机一致。
- `build-done` 存在，`prisma db push` 完成；`web`、`worker`、`watchdog`、`board` 均为 active。
- 无副作用 Chromium 验收脚本：`test-results/ux-audit/batch-2/acceptance.mjs`；结果：`results.json`，全部 6 项通过，`paidGeneration: false`。
- 通过：零余额无限成员看到自己的 `balancePoints: 0`，`creditAvailable` 与 `generationAllowed` 为 true，响应不含管理账号余额或旧 `walletScope`。
- 通过：积分方式切换即时生效；非法值返回 400；管理账号自行修改被既有工作区权限守卫以 403 拒绝。
- 通过：历史管理账号代付流水的 `balanceAfter` 为 null。
- 通过：团队表格与编辑弹窗显示积分方式；从无限积分切换为分配积分时，零余额警告可见并可保存。
- 通过：零余额无限成员的钱包不标红，说明自动补足规则可见。
- 验收结束后测试成员原始整数余额与无限积分方式均已恢复；只操作测试管理员名下账号，未调用任何生成接口。
- 截图：`test-results/ux-audit/batch-2/01-point-modes.png`、`02-point-mode-editor.png`、`03-member-wallet.png`。

## 独立回滚演练

- 首次 M2-only 包严格取 `44f8ae7`，SHA-256：`ee80070d783b06e7088cae58a25cbdad4dd708f9a1de5d83ff3e167e104be2d6`。
- 应用构建成功，但 `prisma db push` 因数据库已含批次 3 的 `productLine` / `creationMode` 而检测到潜在删列并中止；没有加 `--accept-data-loss`，没有重启，也没有删除字段。后续包只额外保留这些 additive schema 声明，不引入 E2 代码。
- 并发重试造成 `npm ci` 的 esbuild 校验失败，旧 E2 服务保持运行。停止并发后使用 SHA-256 `20b120b2e3679faeddcd47e037c9cb7e18b5c0e13ff267fad99dfdf8ea61b3a4` 的回滚包串行构建成功；没有修改部署脚本。
- 回滚构建的 `prisma db push` 显示数据库已与 schema 同步，四个服务均 active。
- 通过：旧版余额响应恢复 `walletScope: workspace`，不包含 E2 的 `pointMode` / `isMember` / `creditAvailable`；界面显示「共享积分」与「从管理账号共享钱包扣费」。
- 通过：只读 `information_schema` 确认 `user.pointMode` 默认 `unlimited` 仍存在；批次 3 的 `works.productLine` 与 `projects.creationMode` 也未被删除。
- 截图：`test-results/ux-audit/batch-2/04-m2-rollback-wallet.png`；结果：`rollback-results.json`。
- 按无付费限制未在回滚期间触发生成；共享钱包恢复由旧代码、真实响应及界面共同验证，不将未执行的付费扣款写成通过。
- E2 恢复部署使用原包 SHA-256 `40421312acdd2a8909a9f5692758d5bce031becce7bfe65067e39c8a692484db`，构建成功，数据库仍同步，四个服务均 active。
- 恢复后重新运行同一无副作用验收，6 项再次全部通过，测试成员原始余额与无限积分方式再次恢复；未触发生成。

## 偏差

- 未执行原文要求的真实付费图片生成及由此衍生的回滚付费验证。为遵守不擅自产生模型费用的限制，改用真实隔离数据库测试覆盖资金事务，并在测试机执行无副作用 API/UI 验收；未把付费验收记为通过。
- 管理账号不是普通管理账号可直接 PATCH 的子账号，修改其 `pointMode` 会先在既有权限守卫返回 403；子账号非法值与积分方式校验仍返回 400，权限语义未削弱。
- `1e9bdbd` 附带已有工作区修复：素材批量上传继承入口项目归属，选择文件后锁定归属，避免上传途中切换项目。
- 测试机快照包含已混入 `a185484` 的批次 3 代码及工作区现状，符合 R3；本记录不表示批次 3 已完成验收。

## 生产

尚未部署；等待用户明确放行。
