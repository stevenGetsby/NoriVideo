# LanmiaoTV「算力账本」：把 `周项目算力汇总` 表格的记账方式搬进平台 — 设计与实现文档

日期：2026-11-20　角色：产品/数据设计 → 交给实现 agent（kimi3.1 / qwen4max）。本文自成一体，照做即可，不需要再问用户；真正需要用户拍板的事全部集中在 §16，其余一律按「默认」执行。

## 0 这份文档在解决什么

用户的原话：**「你理解一下这三个表格，我想让 lanmiaotv 的记账方式是这样的，你设计一下给 agent 的实现方案以及细节」**。

三个表格 = 两张截图 + 一份 xlsx（`20260622_周项目算力汇总.xlsx`，只有一个 sheet「❗每日算力日报」，和截图 2 是同一张表）：

- **截图 1「算力表」**：以项目为行的总账。每个项目一行：每个人在该项目上花了多少元、总消耗、算力预算、预算余额、工期、开工日期、时长（分钟）、完成情况。
- **截图 2 / xlsx「每日算力日报」**：流水账。一行 = 一个人、一个项目、一天。每人每天提交，填「当天 API 消耗（token）」「当天即梦消耗（积分）」，系统折成「当天算力总消耗（元）」，再往上滚出 周 / 三日 / 项目累计。

结论先行，因为它决定了改造范围：

1. **LanmiaoTV 已经自动记了一大半。** 每次在平台里生成图/视频/语音/文本，`UsageCost` 都会落一行「哪个项目、谁、哪天、多少元（CNY，6 位小数）」。表格里最费人工的「按人按项目按天汇总」平台可以直接算出来，不需要谁再手填。
2. **平台没有的是四样东西**：
   - 平台外的花费（人在即梦网页、火山控制台等地方花的钱）——表格里的「即梦积分」和一部分「API token」就是这类，只能手填；
   - 项目级元数据：预算、项目类型、开工日期、目标交付日期、时长、集数、完成情况；
   - 周 / 三日 / 项目累计 这些滚动汇总，以及「算力表」这种项目 × 人的矩阵视图；
   - 导出成与表格同形状的文件。
3. **有一个必须在设计里解决的硬伤**：项目进回收站 15 天后会被物理删除，而 `UsageCost.projectId` 是 `onDelete: Cascade`，**项目一删，它的全部花费流水跟着消失**（§3.3）。账本是账，历史周报不能因为谁清了回收站而改数字，所以平台侧花费必须**快照**到独立表，不能每次都从 `UsageCost` 现算。
4. 因此方案是：**平台自动快照（`LedgerDailyFact`）+ 外部手填（`LedgerEntry`）+ 项目元数据（`LedgerProject`）**，三者在读取时合并成表格里的每一种视图。

## 1 表格语义（实现者必读，全部用 openpyxl 逐格核对过）

### 1.1 日报行

xlsx 导出自飞书多维表格。共 25 列、136 行（日期 2026-05-07 ～ 2026-06-22，31 个项目，21 个提交人，**全部为值，没有公式**）。其中 `父记录`、`父记录 2`、`文本 2` 三列全空，是导出残留，丢弃。

一行的主键语义：**(日报提交日期, 项目名称, 提交人)**，136 行里没有重复。

| 列 | 含义 | 平台里的归宿 |
|---|---|---|
| 日报提交日期 | 花费发生日 | `dateKey`（上海自然日，`YYYY-MM-DD`） |
| 项目名称 | 业务项目 | `LedgerProject`（有则关联 `Work`） |
| 项目类型 | 精品 / 甲方Demo / 测试 / 短片 / 试岗（多选，脏数据见 §1.5） | `LedgerProject.category` |
| 提交人 | 谁花的 | `actorUserId` |
| 当天API消耗（token） | 外部 API 的 token 数 | `LedgerEntry(kind=api_token)` |
| 当天即梦消耗（积分） | 即梦网页的积分数 | `LedgerEntry(kind=jimeng_points)` |
| 当天算力总消耗（元） | 上面两项折算后的元 | 读取时 Σ（平台快照 + 外部条目） |
| 备注 | 自由文本，4 行有值，用来拆账（如 `婚介65+悬疑131`） | `LedgerEntry.remark` + `splitGroupId` |
| 周区间 / 周起始日期 | 如 `5.18-5.24` / `2026/05/18` | 派生，不存 |
| 个人周项目算力总和（元） | 一个人在一个项目一周的合计 | 派生，不存 |
| 周项目算力总和（元）、项目周算力总消耗（元） | 一个项目一周的合计（两列同值） | 派生，不存（只留一个） |
| 每三天分组 / 三日算力总消耗（元） | 见 §1.4 | 派生，不存 |
| 项目算力总消耗（元） | 一个项目的累计 | 派生，不存 |
| 项目开始日期 / 目标算力成本（元） / 目标交付日期 | 项目级元数据 | `LedgerProject` |
| 总集数 / 已完成集数 / 完成比 | 进度 | `LedgerProject`（完成比派生） |

### 1.2 换算公式（xlsx 全部 136 行核对通过，最大残差 ¥0.005，即源表四舍五入到分）

```
当天元 = token × 46 / 1_000_000 + 即梦积分 × 0.1
```

- token 单价 **¥46 / 百万 token**，即梦 **¥0.1 / 积分**。
- 行的构成：只填 token 131 行；token + 即梦都填 2 行；只填即梦 2 行；都没填 1 行（0 元）。
- 推测 ¥46 / 百万 token 是视频模型 API 的 token 单价（本文没有核实，**需要用户确认**，见 §16）。无论是不是，实现上都把它当成**可配置的汇率**，不写死。
- xlsx 这 136 行的合计：**¥24,138.18**（31 个项目、21 个提交人）。注意这**不是**表里汇总列所代表的总额，见 §1.3。

### 1.3 汇总层级（这是「记账方式」的核心），以及 xlsx 是「部分导出」这个事实

设计意图的层级（表头和截图 1 都体现了这个结构）：

```
日报行（人 × 项目 × 日）
  └─ 个人周项目算力总和 = 同一人、同一项目、同一周 的日报行之和
       └─ 周项目算力总和 = 同一项目、同一周 的全部人之和
            └─ 项目算力总消耗 = 同一项目 的全部周之和
```

**但 xlsx 里的汇总列无法由它自己的 136 行复算出来**（逐项核对，用表自带的 `周区间` 分组，容差 ¥0.011）：

| 汇总列 | 能对上的比例 | 说明 |
|---|---|---|
| 个人周项目算力总和 | 36 / 136 | 其余偏大 |
| 周项目算力总和（= 项目周算力总消耗） | 17 / 67（项目 × 周） | 如 布鲁萌探队 5.18–5.24：行之和 ¥268.22，表里写 ¥1,757.09 |
| 三日算力总消耗 | 24 / 73（项目 × 三日段） | 有的比同时段「全队所有项目」的行之和还大 |
| 项目算力总消耗 | 2 / 31 | 能对上的是只做了一两天的小项目；聊斋 行之和 ¥2,782.86，表里 ¥12,651.90 |

且表里 31 个项目的「项目算力总消耗」之和是 **¥82,643.90**，是行之和的 3.4 倍；截图 1 的「聊斋 ¥12,432.11」「大明仙师 ¥8,685.02」也与表里汇总列同量级（大明仙师：表里 ¥8,685.00）。结论：**这份 xlsx 是「部分导出」——汇总列是在飞书里的完整数据上算的，导出的只是其中 136 行**（原因未知：可能是导出时套了视图筛选或被截断，本文无法判断）。

这对设计有三个后果，实现者必须照做：

1. **导入时忽略所有汇总列**（个人周 / 周 / 三日 / 项目累计 / 完成比），只取原始日报行，汇总永远由平台重新计算（R4）。
2. **历史导入后项目累计会比表里少很多**（约少 71%）。所以 xlsx 历史导入**不能静默提交**：必须先给用户看 dry-run 报告并让用户在三种方案里选一个（§12.1 / §16 Q1）。
3. **验收不能再用「导入后项目累计 = 表里的项目算力总消耗」**，只能用「行级求和」口径（附录 A）。

### 1.4 时间规则（上海时间，固定 UTC+8）

- **周**：周一到周日。标签写成 `M.D-M.D`（如 `5.18-5.24`），键用周一的日期 `YYYY-MM-DD`。表里 5.4–5.10 到 6.22–6.28 全部符合。
- **三日段**：**按自然月内的日号切**：`1–3 / 4–6 / 7–9 / 10–12 / 13–15 / 16–18 / 19–21 / 22–24 / 25–27 / 28–30 / 31`。表里 136 行的 `每三天分组` 标签（共 15 种，`2026-05-07 至 2026-05-09` … `2026-06-22 至 2026-06-24`）与这条规则**逐行一致，0 例外**；**不是**从某个固定起点连续每 3 天一段（否则 6 月应从 5.31 起算，表里是 6.1–6.3）。
- 31 号单独成一段（`31–31`，因为下月 1 号重新开始），2 月的最后一段按月末截断。**这一条是推断**（表里 5 月 31 日没有数据可印证），已是最合理的外推，实现时照做并写进单测。
- 标签格式沿用表里的：`2026-05-07 至 2026-05-09`。

### 1.5 数据质量问题（导入与录入校验都要处理）

| 问题 | 实例 | 处理 |
|---|---|---|
| 多选字段重复值 | `短片,短片`（1 个项目）、`甲方Demo,甲方Demo`（2 个项目） | 按逗号拆开、去重、取第一个；仍有多个不同值时取第一个并在导入报告里记警告 |
| 项目名首尾空格 | `" 猫、浴缸和早上八点"` | `trim()` 后再匹配 / 建项目；报告里记一条 |
| 预算大面积缺失 | 31 个项目里只有 **10 个**填了目标算力成本（同一项目内没有冲突值） | 预算允许为空；空预算的项目不报超支，界面显示「未设预算」 |
| 目标交付日期整列为空 | — | 允许为空，不做任何依赖 |
| 一天拆给多个项目 | 备注 `婚介65+悬疑131`、`141禁忌+7婚介`、`32.09婚介+387绝世` | 备注只是人写的说明；导入不解析备注（表里已经拆成了独立行），只原样保留 |
| 手填 token / 积分 | 全靠人记 | 录入时校验为非负数；金额由服务端按汇率重算，不信前端传的金额 |
| 重名人 / 改名 | 提交人是文本 | 平台里用 `userId`，导入时按用户名匹配（§12） |

### 1.6 截图 1 的用途与限制

截图 1（算力表）与 xlsx 汇总列同量级而与 xlsx 的 136 行不同量级（§1.3），所以它们是同一份「完整数据」的两个视图，xlsx 只是其中一部分行。截图 1 与 xlsx 汇总列并不逐项相等（聊斋 ¥12,432.11 vs ¥12,651.90，大明仙师 ¥8,685.02 vs ¥8,685.00），推测是导出时点不同，未证实。**截图 1 只用来决定「算力表」有哪几列（§11.2），不用于数字验收。**

## 2 表格 → 平台：字段与概念映射

先把术语钉死，否则会写反（`prisma/schema.prisma:376-380` 的注释）：**业务「项目」= `Work`（表 `works`）；业务「作品」= `Project`（表 `projects`，历史命名）**。表格里的「项目」是 `Work`。`UsageCost.projectId` 指向的却是 `Project`（作品），要经 `Project.workId` 才能归到 `Work`。

| 表格概念 | 平台对象 | 说明 |
|---|---|---|
| 项目 | `LedgerProject`（新），可选关联 `Work` | 账本自己持有一份项目行，因为 ① 要存预算等元数据 ② `Work` 会被物理删除 ③ 历史上有不在平台里的项目（只在即梦里做的） |
| 提交人 | `actorUserId` | 真实操作者，不是钱包所有者（§3.2） |
| 平台内的花费 | `LedgerDailyFact`（新，从 `UsageCost` 快照） | 按 (项目, 日, 人, apiType) 汇总，单位 ¥ |
| 平台外的花费 | `LedgerEntry`（新，手填） | token / 即梦积分 / 直接填元 |
| 汇率 | `LedgerSetting`（新） | 默认 46 元 / 百万 token、0.1 元 / 积分；条目上快照当时的单价 |
| 周 / 三日 / 项目累计 | 不存，读取时算 | 口径见 §1.3–§1.4 |
| 算力表（截图 1） | `GET /api/admin/compute-ledger/overview` | §10、§11.2 |
| 每日算力日报（截图 2） | `GET /api/admin/compute-ledger/report?view=day` | §10、§11.3 |

## 3 现状盘点：平台已经记了什么、没记什么（全部为只读核对，file:line 为 2026-11-20 的状态）

### 3.1 `UsageCost`：每次付费调用一行，单位 ¥

`prisma/schema.prisma:753`：`projectId`（→ `Project`，**`onDelete: Cascade`**）、`userId`（→ `User`，Cascade）、`apiType`（`text|image|video|voice|voice-design|lip-sync`，见 `src/lib/billing/cost.ts:38`）、`model`、`action`、`quantity Int`、`unit`、`cost Decimal(18,6)`、`metadata String? @db.Text`（JSON 文本）、`createdAt`。索引：`apiType`、`createdAt`、`projectId`、`userId`。**没有 `workId` 列**，归属到项目要 `usage_costs → projects → works` 两次 JOIN。

### 3.2 谁花的：必须还原真实操作者，两种行形态并存

- 子账号的 `session.user.id` 是**工作区所有者**，`session.user.actorId` 才是本人（`src/lib/api-auth.ts:36-55`、`src/lib/billing/actor-scope.ts:8-19`）。管理员两者相等。
- 2026-11-14「个人点击个人付」之前：行挂在所有者（管理员）钱包下，`metadata` 里带 `"quotaUserId":"<操作者>"`。之后：行挂在成员自己的钱包下（`userId` = 操作者），通常不带 `quotaUserId`。`confirmChargeWithRecord` 在 `src/lib/billing/ledger.ts:421-426` 把 freeze 里的 `quotaUserId` 抄进 `metadata`。
- 所以**真实操作者 = `COALESCE(metadata.quotaUserId, userId)`**。`src/lib/account/activity-stats.ts:30-38,91` 对 `Task` 用的是同一个思路（那里取 `payload.meta.quotaUserId`），照抄这个思路即可。
- `auto_allocate_out / auto_allocate_in`（成员无限积分时自动从管理员账号补）是 `BalanceTransaction` 的转账行，**不是消耗**，账本根本不读 `BalanceTransaction`，不会误计。

### 3.3 回收站 15 天后物理删除，`UsageCost` 随之级联消失（本方案的第一个设计约束）

- `src/lib/projects/recycle-bin.ts:9` `PROJECT_RECYCLE_RETENTION_DAYS = 15`。
- `:160-168` `purgeProject()` 里 `await prisma.project.delete({ where: { id: project.id } })`；`UsageCost.project` 是 Cascade，该作品的所有花费流水一并删除。`:199` `purgeExpiredRecycleBinProjects()` 循环调用它；`:237` 随后 `prisma.work.deleteMany` 清理已无作品的 `Work`。
- 结论：任何「每次从 `UsageCost` 现算」的账本，在回收站清理之后**历史周报的数字会变小**。→ 平台侧花费必须快照到不带外键的 `LedgerDailyFact`，并且在 `purgeProject` 删除前强制刷一次快照（§8.4）。

### 3.4 `UsageCost` 只在 ENFORCE 计费模式下写

- `src/lib/billing/mode.ts:13`：`BILLING_MODE` 环境变量，缺省 **`OFF`**。
- `ENFORCE`：`confirmChargeWithRecord` 在 `ledger.ts:420` `if (chargedAmount > 0)` 内写 `UsageCost`。
- `SHADOW`：只写一条 `BalanceTransaction(type='shadow_consume', amount=0)`（`ledger.ts:571-619`，调用点 `src/lib/billing/service.ts:476`、`:1147`），**没有 `UsageCost`**。`OFF`：什么都不记。
- 所以账本的平台侧只对 `ENFORCE` 环境有意义。账本页必须在 `getBillingMode() !== 'ENFORCE'` 时顶部显示警告条（文案见 §11.6）。不要去读 `shadow_consume` 补数。

### 3.5 其它必须知道的现状

| 事实 | 位置 | 对设计的影响 |
|---|---|---|
| 内部记录标记（`NORI_AGENT*`、`super-agent*`、`自动创作模式`）被现有费用页隐藏 | `src/lib/workspace/internal-record-visibility.ts:1,38`（`isInternalUsageCostRecord`） | 账本默认同口径排除，保证和「费用」页对得上（D6）。SQL 里无法复刻整套正则，§8.2 给出「SQL 粗筛 + JS 精判」的做法 |
| 资产库 / 工具箱 / 视频转绘用虚拟项目 id（`asset-hub`、`global-asset-hub`、`system`、`video-repaint`），不是真实 `Project` | 计费调用处 | `UsageCost.projectId` 有外键，这类花费**根本没有 `UsageCost` 行**，账本记不到。属于已知缺口，写进非目标（§4.2） |
| 有一个 worker 进程里的看门狗定时器，但不是通用调度器 | `src/lib/task/reconcile.ts:225` 的 `setInterval(…, WATCHDOG_INTERVAL_MS)`，每轮里顺带调 `purgeExpiredRecycleBinProjects()`（`:260-264`） | 清理回收站发生在 worker 进程、与任何用户请求无关，所以「删除前刷快照」必须放在 `purgeProject` 内部（§8.4）。账本**不**往看门狗里加任务（R2 不许改 `reconcile.ts`）；快照用「读取时懒同步 + 一次性回填脚本 + 删除前刷新」三件套，已经没有缺口（§8.1） |
| `package.json` 里没有 `exceljs` / `xlsx` | `package.json` | 导出用 CSV（UTF-8 BOM + CRLF，同 `buildActivityCsv`，`activity-stats-shared.ts:293`）；导入由一次性 Python 脚本把 xlsx 转成 JSON（§12）。**不要新增依赖** |
| `csvCell` 是模块私有函数 | `activity-stats-shared.ts:278` | 账本自己写一份，且要防公式注入（§10.7）。**不要改动工作监督的文件** |
| 管理员专属页面的现成样板 | `src/app/api/admin/activity/route.ts`（鉴权 + 范围解析 + CSV）、`src/lib/account/activity-stats.ts`（SQL 聚合）、`src/components/frameos/FosStaffActivityClient.tsx`（表格 + 详情抽屉）、`src/components/frameos/TeamManagementTabs.tsx`、`src/app/[locale]/account-management/activity/page.tsx`（服务端守卫） | 账本照这套样板做，保持视觉与交互一致 |
| 上海自然日工具 | `src/lib/account/activity-stats-shared.ts:6-7,91,124`（`ACTIVITY_OFFSET_MS`、`startOfShanghaiDay`、`shanghaiDateKey`） | 直接复用，禁止自己写时区转换 |
| 金额工具 | `src/lib/billing/money.ts`（`toMoneyNumber`、`roundMoney(value, scale=6)`）、`src/lib/billing/currency.ts`（`BILLING_CURRENCY = 'CNY'`） | 复用 |
| API 默认权限 | `src/lib/account/permissions.ts:211` `requiredPermissionsForApiPath`：未列出的非 GET 路径函数末尾 `return ['admin']`；`ADMIN_PREFIXES`（:166）不含 `/api/admin/activity`，该路由靠自身 `requireAdminAuth` + 角色检查（`activity/route.ts:19-25`）把关 | 成员自助录入的写接口必须在这里显式加一条放行规则（§10.1），否则成员 POST 会被默认拒绝 |
| 迁移命名 | `prisma/migrations/20261117120000_add_dy_minigame` 是最新一条 | 新迁移用 `20261120120000_add_compute_ledger` |

## 4 目标、非目标与默认决策

### 4.1 目标

- **G1** 管理员在「团队管理」里多一个标签「算力账本」，看到和截图 1、2 同形状的两张表：**算力表**（项目 × 人）和**每日算力日报**；数据 = 平台自动记的 + 人手填的外部花费。
- **G2** 每个人（含子账号）能录入自己的外部花费：API token、即梦积分、或直接填元；录完立即体现在账本里。
- **G3** 项目级预算、预算余额、使用率、超支提醒；项目元数据（类型、开工日期、时长、集数、完成情况）可维护。
- **G4** 周 / 三日 / 项目累计视图，口径与表格完全一致（§1.3–§1.4）；可导出 CSV。
- **G5** 一次性导入历史 xlsx：导入后行级数字与 xlsx 的 136 行逐行一致、汇总与「行级求和」一致（附录 A）；项目累计与表里汇总列的差额按用户选择的方案处理（§12.1）。
- **G6** 删除项目、清空回收站都不会改变历史账目。

### 4.2 非目标（遇到就不做，不要「顺手」）

- 不改任何计费、扣费、钱包、积分逻辑；不回填、不修改 `UsageCost`。
- 不做审批 / 报销 / 发票 / 多币种 / 多汇率历史曲线。
- 不做通知、邮件、飞书同步、定时日报提醒。
- 不记资产库 / 工具箱 / 视频转绘等**无项目归属**的消耗（技术上记不到，§3.5）。以后要做另立方案。
- 不做 xlsx 导出（P4 可选，需用户批准新增依赖）。
- 不在账本里显示「积分」。平台面向用户的积分和元的换算是 `POINTS_PER_CNY = 100`（`src/lib/billing/credit-policy.ts:5`），而表格里的「即梦积分」是外部平台自己的积分，两者无关；账本统一用 ¥，混用必出错。
- 不做财务级的借贷记账、不做会计科目。

### 4.3 默认决策表（实现时照做；§16 里标「待确认」的用户可推翻，推翻只需改这一行对应的实现）

| # | 决定 | 默认 | 理由 | 待确认 |
|---|---|---|---|---|
| D1 | 记账单位 | ¥（CNY） | 表格单位就是元；`UsageCost.cost` 已是 CNY | 否 |
| D2 | 平台侧花费口径 | `UsageCost.cost`（模型目录定价 × `MARKUP=1.0`，`cost.ts:24-33`），**不是**上游真实发票价 | 平台只知道这个数；差异靠 `amount_cny` 校准条目修正 | **是** |
| D3 | 完成情况 / 总集数 / 已完成集数 | 手填（`LedgerProject.status` 等）；P3 才提供「从系统读取建议值」 | 「一集」在平台里到底是 `NovelPromotionEpisode`、`Project` 还是 `WorkflowAssignment` 完成，团队没有统一口径，猜了必错 | **是** |
| D4 | 谁能看全表 | 仅 `role === 'admin'`；超管、项目组长都看不到（同工作监督，`activity/route.ts:22-25`） | 全表含每个人的花费，和工作监督同敏感度 | 是 |
| D5 | 成员自助录入 | 开（P2）：成员只能录、看、改**自己**的外部条目和自己的日报 | 表格就是 21 个人各填各的 | 是 |
| D6 | 内部记录（agent / 自动创作） | 排除，与现有费用页同口径 | 总数能和「费用」页对上 | 否 |
| D7 | 汇率 | 46 元 / 百万 token、0.1 元 / 积分；`LedgerSetting` 可改；**条目保存时快照当时的单价** | 汇率会变，改汇率不能重写历史 | 否 |
| D8 | 预算预警 | 使用率 ≥ 80% 黄、≥ 100% 红；阈值是代码常量 | 表格没有预警，这是平台加值；常量避免再加一张设置表 | 否 |
| D9 | 项目类型 | 固定 5 个：`premium 精品`、`client_demo 甲方Demo`、`test 测试`、`short 短片`、`trial 试岗`；可空 | 表格里就这 5 种 | 否 |
| D10 | 历史 xlsx | P4 一次性导入，默认 dry-run，需用户提供文件副本 | xlsx 在微信缓存目录，不稳定 | 是 |
| D11 | 导出 | CSV（BOM + CRLF） | 不加依赖 | 否 |
| D12 | 周起点 | 周一；三日段按月内日号 | §1.4 | 否 |

## 5 执行规则

- **R1 不碰计费核心**：`src/lib/billing/*` 一行不改，只许 import 现成的 `getBillingMode`、`toMoneyNumber`、`roundMoney`、`BILLING_CURRENCY`，以及 `src/lib/workspace/internal-record-visibility.ts` 的 `isInternalUsageCostRecord`。
- **R2 允许修改的既有文件只有这些**（每处改动都在文中标了章节）：`prisma/schema.prisma`（§6）、`src/lib/projects/recycle-bin.ts`（§8.4，仅在 `purgeProject` 删除前加一次调用）、`src/lib/account/permissions.ts`（§10.1，仅加一条成员放行规则）、`src/components/frameos/TeamManagementTabs.tsx`（§11.1）、`src/components/frameos/FosShell.tsx`（§11.8，仅成员入口）、`src/styles/frameos-replica.css`（§11，仅追加 `.fos-ledger-*` 样式）、`package.json`（§8.5、§14，仅在 `scripts` 里加 `ledger:backfill` 与 `test:ledger`）、`tests/contracts/route-catalog.ts`（§14.4，仅在 `ROUTE_FILES` 里按字母序加入本方案新增的每个 `route.ts`）。除此之外一律新建文件。**不许改工作监督的任何文件。**
- **R3 快照只增不减**：`LedgerDailyFact` 的同步一律 `INSERT … ON DUPLICATE KEY UPDATE x = GREATEST(x, VALUES(x))`，**禁止**先删后插、禁止覆盖写。理由：`UsageCost` 只追加，真实总额只会涨；任何「变小」只可能来自级联删除，必须忽略（§8.3）。
- **R4 汇总不落库**：周、三日、项目累计、完成比、预算余额、使用率全部在读取时计算；表里只存原始事实。
- **R5 金额只在服务端算**：`LedgerEntry.amountCny` 由服务端按 `quantity × unitPrice` 算，前端传来的金额一律忽略。SQL 里用 `SUM(DECIMAL)`，JS 里用 `roundMoney(x, 6)`；界面显示 2 位小数，**禁止把已四舍五入的显示值再相加**。
- **R6 日期只用上海自然日**：复用 `startOfShanghaiDay` / `shanghaiDateKey`；SQL 里取日用 `DATE(DATE_ADD(createdAt, INTERVAL 8 HOUR))`（库里是 UTC，Prisma 默认）；禁止 `toLocaleDateString`、禁止依赖服务器时区。
- **R7 条目软作废，不物理删除**：`LedgerEntry` 用 `voidedAt` 作废，作废行不计入任何汇总但保留可追溯。
- **R8 权限三层**：admin 全部；成员只限自己；其余角色全拒。任何成员接口里 `actorUserId` 一律取自会话（`session.user.actorId ?? session.user.id`），**禁止信任请求体里的 `actorUserId`**。
- **R9 路由与日志合规**：所有 route 用 `apiHandler`，错误用 `ApiError`（`INVALID_PARAMS` / `FORBIDDEN` / `NOT_FOUND` / `CONFLICT`），请求体用 zod 校验；不许 `console.*`，用 `@/lib/logging/core` 的 `logInfo` 等；改完要过 `npm run check:api-handler`、`npm run check:logs`、`npm run check:log-semantic`。
- **R10 不新增依赖**。
- **R11 不碰机密**：不读不拷贝 `.env.local`、`api_config.yaml`、任何 `.pem`。
- **R12 迁移与部署要用户批准**：agent 只写 `schema.prisma` + 迁移 SQL，并只在**本地 dev 库**跑；**禁止**对测试机 / 生产 / 备案机执行迁移或部署，除非用户明确批准（§16）。生产只有 `14.103.65.61`，且禁止用 `lanmiao-prod` 别名；`/data` 下任何东西禁止删除。
- **R13 导出防公式注入**：CSV 单元格以 `= + - @ \t \r` 开头时前置一个 `'`（§10.7）。备注是用户自由文本，这是真实风险。
- **R14 每批独立可上线**：批一做完就能用，批二批三是增强（§15）。

## 6 数据模型（`prisma/schema.prisma` 末尾追加，纯新增，不改任何既有 model）

设计原则：**账本表不与 `Work` / `Project` / `User` 建外键**，只存软引用 id 和当时的名字快照。理由：这三者都会被物理删除（§3.3），账目必须比它们活得久。所以也**不要**在 `User` / `Work` / `Project` 上加反向关系字段——既有 model 一个字符都不改。

```prisma
// ============================================================
// 算力账本：平台侧快照 + 外部手填 + 项目元数据
// 刻意不与 Work/Project/User 建外键：账目必须在它们被物理删除之后继续存在。
// 日期一律存上海自然日字符串 'YYYY-MM-DD'（避免 Date 时区歧义，字符串可直接区间比较）。
// ============================================================

model LedgerProject {
  id                 String    @id @default(uuid())
  workspaceOwnerId   String    @db.VarChar(191)
  workId             String?   @db.VarChar(191) // 软引用 Work.id；外部项目为 null
  name               String    @db.VarChar(191)
  nameKey            String    @db.VarChar(191) // normalizeProjectName(name)，用于匹配/去重
  category           String?   @db.VarChar(16)  // premium|client_demo|test|short|trial，可空
  status             String    @default("in_progress") @db.VarChar(16) // in_progress|completed|paused
  startDate          String?   @db.VarChar(10)
  targetDeliveryDate String?   @db.VarChar(10)
  completedDate      String?   @db.VarChar(10)
  budgetCny          Decimal?  @db.Decimal(18, 2)
  durationMinutes    Decimal?  @db.Decimal(8, 2) // 成片时长（分钟）
  totalEpisodes      Int?
  doneEpisodes       Int?
  note               String?   @db.VarChar(500)
  archivedAt         DateTime?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @default(now()) @updatedAt

  facts   LedgerDailyFact[]
  entries LedgerEntry[]

  @@unique([workspaceOwnerId, workId], map: "ledger_projects_owner_work_key")
  @@index([workspaceOwnerId, nameKey], map: "ledger_projects_owner_name_idx")
  @@index([workspaceOwnerId, archivedAt], map: "ledger_projects_owner_arch_idx")
  @@map("ledger_projects")
}

// 平台自动记的花费：从 UsageCost 按 (项目, 上海日, 真实操作者, apiType) 汇总后快照。
model LedgerDailyFact {
  id               String   @id @default(uuid())
  workspaceOwnerId String   @db.VarChar(191)
  ledgerProjectId  String
  dateKey          String   @db.VarChar(10)
  actorUserId      String   @db.VarChar(191)
  actorLabel       String   @db.VarChar(64) // 同步时的用户名快照
  apiType          String   @db.VarChar(16) // text|image|video|voice|voice-design|lip-sync
  costCny          Decimal  @db.Decimal(18, 6)
  callCount        Int      @default(0)
  syncedAt         DateTime @default(now())

  ledgerProject LedgerProject @relation(fields: [ledgerProjectId], references: [id], onDelete: Restrict)

  @@unique([ledgerProjectId, dateKey, actorUserId, apiType], map: "ledger_facts_uniq")
  @@index([workspaceOwnerId, dateKey], map: "ledger_facts_owner_date_idx")
  @@index([actorUserId, dateKey], map: "ledger_facts_actor_date_idx")
  @@map("ledger_daily_facts")
}

// 人手填的外部花费（平台之外的 API、即梦网页、其它）。作废用 voidedAt，不物理删除。
model LedgerEntry {
  id               String    @id @default(uuid())
  workspaceOwnerId String    @db.VarChar(191)
  ledgerProjectId  String
  dateKey          String    @db.VarChar(10)
  actorUserId      String?   @db.VarChar(191) // 导入时匹配不到账号则为 null，靠 actorLabel 显示
  actorLabel       String    @db.VarChar(64)
  kind             String    @db.VarChar(16) // api_token | jimeng_points | other_cny
  quantity         Decimal   @db.Decimal(20, 4) // token 数 / 积分数 / 元（other_cny）
  rate             Decimal   @db.Decimal(18, 6) // 保存时的单价快照：元/百万token、元/积分、1
  amountCny        Decimal   @db.Decimal(18, 6) // 服务端算：见 calc.computeEntryAmount
  remark           String?   @db.VarChar(500)
  source           String    @default("manual") @db.VarChar(16) // manual | import
  importKey        String?   @unique(map: "ledger_entries_import_key") @db.VarChar(191)
  importBatchId    String?   @db.VarChar(64)
  replacesEntryId  String?   @db.VarChar(191) // 编辑 = 作废旧行 + 新增一行，并记录替换关系
  createdById      String    @db.VarChar(191)
  createdAt        DateTime  @default(now())
  voidedAt         DateTime?
  voidedById       String?   @db.VarChar(191)

  ledgerProject LedgerProject @relation(fields: [ledgerProjectId], references: [id], onDelete: Restrict)

  @@index([workspaceOwnerId, dateKey], map: "ledger_entries_owner_date_idx")
  @@index([ledgerProjectId, dateKey], map: "ledger_entries_project_date_idx")
  @@index([actorUserId, dateKey], map: "ledger_entries_actor_date_idx")
  @@index([importBatchId], map: "ledger_entries_batch_idx")
  @@map("ledger_entries")
}

// 每个工作区一行：汇率 + 同步水位。
model LedgerSetting {
  workspaceOwnerId       String    @id @db.VarChar(191)
  tokenRateCnyPerMillion Decimal   @default(46) @db.Decimal(18, 6)
  jimengCnyPerPoint      Decimal   @default(0.1) @db.Decimal(18, 6)
  syncedThroughDate      String?   @db.VarChar(10) // 已同步到的上海日
  lastSyncAt             DateTime?
  syncLockedUntil        DateTime? // 简易互斥锁：见 §8.1
  updatedById            String?   @db.VarChar(191)
  updatedAt              DateTime  @default(now()) @updatedAt

  @@map("ledger_settings")
}
```

实现注意：

1. **索引名必须显式 `map:`**。MySQL 标识符上限 64 字符，Prisma 默认生成的 `ledger_daily_facts_ledgerProjectId_dateKey_actorUserId_apiType_key` 是 66 个字符，会在迁移时报错。上面已经全部指定短名，别改。
2. `@@unique([workspaceOwnerId, workId])` 的 `workId` 可空：MySQL 唯一索引允许多个 NULL，外部项目可以有很多条。
3. 迁移目录 `prisma/migrations/20261120120000_add_compute_ledger/migration.sql`。生成办法：先改 `schema.prisma`，再 `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`（或对旧版 schema 做 `--from-schema-datamodel`），输出应**只含 `CREATE TABLE` / `CREATE INDEX`**，逐行核对；风格对齐 `prisma/migrations/20261117120000_add_dy_minigame/migration.sql`（`DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`）。若输出里出现 `ALTER`/`DROP` 既有表，说明改错了，停下。
4. **只在本地 dev 库执行**（R12）。写完迁移后 `npx prisma generate`，类型检查通过即可。
5. 不需要 seed：`LedgerSetting` 行在首次读取时 `upsert` 出来（默认 46 / 0.1）。

## 7 计算规则（纯函数，`src/lib/compute-ledger/calc.ts`，可脱离数据库单测）

这是全文最需要被测试钉死的一层。**所有口径只在这里定义一次**，UI、API、CSV、导入都调它。

### 7.1 金额：用整数微元，禁止浮点直接相加

```ts
export const MICROS = 1_000_000
export const toMicros = (cny: number | string): number => Math.round(Number(cny) * MICROS)
export const fromMicros = (m: number): number => m / MICROS
export const toCents = (micros: number): number => Math.round(micros / 10_000) / 100 // 仅用于显示
```

所有跨行求和先 `toMicros` 再整数相加，最后一次性 `fromMicros`。理由：xlsx 验收要求「按行求和 = 汇总」，浮点累加会差 1e-10，测试里的 `toBe` 会随机失败。

### 7.2 条目金额

```ts
export const ENTRY_KINDS = ['api_token', 'jimeng_points', 'other_cny'] as const
export function computeEntryAmountMicros(kind: EntryKind, quantity: number, rate: number): number {
  switch (kind) {
    case 'api_token':     return Math.round(quantity * rate)            // 元/百万token：quantity×rate/1e6 元 = quantity×rate 微元
    case 'jimeng_points': return Math.round(quantity * rate * MICROS)   // 元/积分
    case 'other_cny':     return Math.round(quantity * MICROS)          // quantity 本身就是元，rate 恒为 1
  }
}
```

核对：12,799,434 token × 46 元/百万 = 588.774… 元，加 583 积分 × 0.1 = 58.3 元，合 647.07 元，与 xlsx 一致（残差来自源表四舍五入到分）。

### 7.3 日期

全部基于 `activity-stats-shared.ts` 的 `shanghaiDateKey` / `startOfShanghaiDay`（R6），在 `calc.ts` 里只补纯字符串日期运算（不碰 `Date` 的本地时区）：

```ts
export function addDaysKey(dateKey: string, n: number): string      // 'YYYY-MM-DD' ± n 天，用 Date.UTC
export function daysBetweenKeys(a: string, b: string): number       // b - a，天
export function isValidDateKey(s: string): boolean                   // 正则 + 真实日期（拒绝 2026-02-30）
export function weekStartKey(dateKey: string): string                // 当周周一
export function weekLabel(weekStart: string): string                 // '5.18-5.24'（无前导零，同表格）
export function triBucket(dateKey: string): { start: string; end: string; label: string }
```

`weekStartKey`：`dow = new Date(Date.UTC(y, m-1, d)).getUTCDay()`（0=周日），`back = (dow + 6) % 7`，返回 `addDaysKey(dateKey, -back)`。

`triBucket`：设日号 `d`，当月天数 `dim`，`startDay = 3 * Math.floor((d - 1) / 3) + 1`，`endDay = Math.min(startDay + 2, dim)`；`label = `${y}-${mm}-${startDay 补零} 至 ${y}-${mm}-${endDay 补零}``。按这个公式 30 号落在 `28–30`，31 号自然单独成 `31–31`，2 月是 `28–28`（平年）或 `28–29`（闰年），不需要特判。

单测必须覆盖（期望值全部来自 xlsx 的真实分组标签）：

| 输入 | 期望 `triBucket.label` |
|---|---|
| 2026-05-07 | `2026-05-07 至 2026-05-09` |
| 2026-05-11 | `2026-05-10 至 2026-05-12` |
| 2026-05-18 | `2026-05-16 至 2026-05-18` |
| 2026-05-26 | `2026-05-25 至 2026-05-27` |
| 2026-06-01 | `2026-06-01 至 2026-06-03` |
| 2026-06-21 | `2026-06-19 至 2026-06-21` |
| 2026-05-31（推断，表里没有） | `2026-05-31 至 2026-05-31` |
| 2026-02-28 / 2028-02-29 | `2026-02-28 至 2026-02-28` / `2028-02-28 至 2028-02-29` |

`weekStartKey` / `weekLabel`：`2026-05-18 → 5.18-5.24`、`2026-05-24 → 周一 05-18`、`2026-06-22 → 6.22-6.28`、跨月 `2026-06-29 → 6.29-7.5`、跨年 `2026-12-28 → 12.28-1.3`。

### 7.4 预算与等级

```ts
export type BudgetLevel = 'none' | 'ok' | 'warn' | 'over'
export const BUDGET_WARN_RATIO = 0.8
export function budgetState(budgetCny: number | null, totalMicros: number) {
  if (budgetCny == null || budgetCny <= 0) return { level: 'none' as const, ratio: null, remainingCny: null }
  const ratio = totalMicros / toMicros(budgetCny)
  const level = ratio >= 1 ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok'
  return { level, ratio, remainingCny: fromMicros(toMicros(budgetCny) - totalMicros) } // 超支时为负数，照实显示
}
```

预算余额 = 预算 − **累计**消耗（不随查询区间变），和截图 1 一致。

### 7.5 其它派生

- `elapsedDays`（工期，天）：`startDate` 为空 → `null`；否则 `daysBetweenKeys(startDate, endKey) + 1`，`endKey = status==='completed' && completedDate ? completedDate : 今天(上海)`。
- `costPerMinute`：`durationMinutes > 0` 才有，`累计消耗 / durationMinutes`，显示 2 位。
- `completionRatio`（完成比）：`totalEpisodes > 0 && doneEpisodes != null` → `doneEpisodes / totalEpisodes`，夹在 `[0,1]`；否则 `null`。
- `normalizeProjectName(s)`：`s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()`。全角/半角、首尾空格（xlsx 里的 `" 猫、浴缸和早上八点"`）都归一。
- `normalizeCategory(raw)`：按 `,` `，` `、` 拆开 → trim → 去重 → 映射 `{精品:'premium', 甲方Demo:'client_demo', 测试:'test', 短片:'short', 试岗:'trial'}` → 取第一个；映射不到的返回 `null` 并让调用方记警告。`'短片,短片'` → `'short'`，`'甲方Demo,甲方Demo'` → `'client_demo'`。

## 8 平台侧自动记账：`UsageCost` → `LedgerDailyFact` 快照（`src/lib/compute-ledger/sync.ts`）

### 8.1 触发方式：读取时懒同步 + 回填脚本 + 删除前刷新

没有后台调度（§3.5），所以：

1. **懒同步**：每个账本读接口（overview / report / me）进入时先调 `syncPlatformFacts(ownerId)`。
2. **回填脚本** `scripts/ledger-backfill.ts`：运维上线时手动跑一次，补齐全部历史（§8.5）。
3. **删除前刷新**：`purgeProject` 物理删除前强制把该作品的整段历史快照进账本（§8.4）。

懒同步流程：

```
syncPlatformFacts(ownerId, { maxChunks = 3 }): Promise<{ complete: boolean; syncedThroughDate: string }>
  1. 取/建 LedgerSetting（upsert，默认汇率）。
  2. 节流：lastSyncAt 在 60 秒内 → 直接返回 { complete: true }。（refresh=1 也只能绕过到 10 秒）
  3. 抢锁：updateMany({ where: { workspaceOwnerId, OR: [{ syncLockedUntil: null }, { syncLockedUntil: { lt: now } }] },
            data: { syncLockedUntil: now + 60s } })；count === 0 → 别人在同步，直接返回 { complete: true }（读旧快照即可）。
  4. 起点：syncedThroughDate 非空 → addDaysKey(syncedThroughDate, -2)（回看两天，吸收迟到的结算）；
            为空 → 该工作区最早一条 UsageCost 的上海日（SELECT MIN(u.createdAt) …，JOIN 同 §8.2）；
            该工作区没有任何 UsageCost → 记 syncedThroughDate = 今天，返回。
  5. 终点：今天（上海）。把 [起点, 终点] 按 31 天一块切，最多处理 maxChunks 块；每块依次：
        runFactChunk(ownerId, fromKey, toKey)  →  upsertFacts(rows)
     没处理完就把 syncedThroughDate 推进到已处理块的末日并返回 { complete: false }；处理完则设为今天。
  6. finally：写 lastSyncAt = now，syncLockedUntil = null。
```

`complete: false` 时 API 把它透传给前端，页面顶部显示「正在补齐历史数据…」并每 2 秒自动重取，最多 20 次（§11.6）。

### 8.2 一块数据的取法：两遍法（精确复刻「内部记录」过滤）

`isInternalUsageCostRecord`（`internal-record-visibility.ts:38`）是一个带单词边界的 JS 正则 + 递归 JSON 检查，SQL 无法等价复刻。所以用「全量 − 内部」：

**A 遍（SQL，全量按键汇总）**

```sql
SELECT w.id                                                AS workId,
       MAX(w.name)                                         AS workName,
       DATE_FORMAT(DATE_ADD(u.createdAt, INTERVAL 8 HOUR), '%Y-%m-%d') AS dateKey,
       COALESCE(
         NULLIF(CASE WHEN u.metadata IS NOT NULL AND JSON_VALID(u.metadata)
                     THEN JSON_UNQUOTE(JSON_EXTRACT(u.metadata, '$.quotaUserId')) END, 'null'),
         u.userId)                                         AS actorId,
       u.apiType                                           AS apiType,
       SUM(u.cost)                                         AS costCny,
       COUNT(*)                                            AS callCount
FROM usage_costs u
JOIN projects p ON p.id = u.projectId
JOIN works    w ON w.id = p.workId
WHERE w.workspaceOwnerId = ? AND u.createdAt >= ? AND u.createdAt < ?
GROUP BY w.id, dateKey, actorId, u.apiType
```

- `[?, ?)` 是 UTC 时刻：`startOfShanghaiDay` 的结果，即「上海日 fromKey 的 00:00」到「上海日 toKey 次日 00:00」。
- `UsageCost.metadata` 是 **Text 不是 JSON 列**，直接 `JSON_EXTRACT` 遇到非法 JSON 会让整条查询报错，所以必须 `JSON_VALID` 守卫；`JSON_UNQUOTE` 对 JSON `null` 会返回字符串 `'null'`，所以套 `NULLIF(…, 'null')`。
- 用 `prisma.$queryRaw(Prisma.sql\`…\`)`，参数全部走占位符。`SUM(DECIMAL)` 返回 `Prisma.Decimal` 或字符串，统一用 `toMoneyNumber`（`src/lib/billing/money.ts:5`）转，再 `toMicros`。
- 这条 SQL 走 `usage_costs.createdAt` 索引；块限定 31 天保证单次扫描量可控。

**B 遍（SQL 粗筛 + JS 精判，只取内部记录）**

```sql
SELECT u.id, u.action, u.apiType, u.model, u.metadata, u.cost, u.createdAt, u.userId, w.id AS workId
FROM usage_costs u JOIN projects p ON p.id = u.projectId JOIN works w ON w.id = p.workId
WHERE w.workspaceOwnerId = ? AND u.createdAt >= ? AND u.createdAt < ?
  AND ( u.action LIKE '%agent%' OR u.model LIKE '%agent%' OR u.apiType LIKE '%agent%' OR u.metadata LIKE '%agent%'
     OR u.action LIKE '%自动创作模式%' OR u.model LIKE '%自动创作模式%' OR u.metadata LIKE '%自动创作模式%' )
```

`LIKE '%agent%'` 在 `utf8mb4_unicode_ci` 下不区分大小写，是 `NORI_AGENT*` / `super-agent` / `super_agent` / `super agent` 的严格超集。取回的行逐行过 `isInternalUsageCostRecord({ action, apiType, model, metadata })`，为真的按**同一个键**（workId, dateKey, actorId, apiType；其中 `dateKey`/`actorId` 在 JS 里用同样规则算：`shanghaiDateKey(createdAt)`、`parseJsonRecord(metadata)?.quotaUserId ?? userId`）累加到 `internal` 表。

**合并**：`fact = A − internal`（微元整数相减，`callCount` 同理），≤ 0 的丢弃。

> 为什么不直接 `WHERE NOT LIKE`：会误杀「action 里恰好含 agent 但不满足单词边界」的正常记录，而现有费用页并不隐藏它们，账本就会和费用页对不上（D6）。

### 8.3 写入：只增不减（R3）

```sql
INSERT INTO ledger_daily_facts
  (id, workspaceOwnerId, ledgerProjectId, dateKey, actorUserId, actorLabel, apiType, costCny, callCount, syncedAt)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3)), …           -- 每批 ≤ 200 行
ON DUPLICATE KEY UPDATE
  costCny    = GREATEST(costCny, VALUES(costCny)),
  callCount  = GREATEST(callCount, VALUES(callCount)),
  actorLabel = VALUES(actorLabel),
  syncedAt   = NOW(3)
```

- `id` 用 `crypto.randomUUID()`；用 `VALUES()` 写法（MySQL 8.0.20 起标记为弃用但仍可用，MariaDB 也支持，别换成行别名语法）。
- `UsageCost` 只追加，真实总额只会涨；「变小」只可能来自级联删除，`GREATEST` 刚好把这种情况挡在账本外（§3.3）。
- `ledgerProjectId` 由 `ensureLedgerProjects` 先算好（§8.4a），不要在 SQL 里 JOIN。
- `actorLabel`：批量查 `User.name`（`findMany({ where: { id: { in } }, select: { id, name } })`），查不到的用上一次快照；都没有则 `'未知账号'`，截断到 64 字符。

### 8.4a 项目关联：`ensureLedgerProjects(ownerId, works: {workId, workName}[])`

对每个出现的 Work，依次：

1. `ledgerProject.findUnique({ workspaceOwnerId_workId })` 命中 → 若 `normalizeProjectName(workName) !== nameKey` 就更新 `name` / `nameKey`（**已关联的项目名跟随 Work**）；
2. 否则找「同工作区、`workId = null`、`nameKey` 相同、未归档」的外部项目（xlsx 导入的、手工建的）→ 命中则**认领**：`update({ workId })`；多个命中取最早创建的，其余不动并 `logInfo('[Ledger] ambiguous name', …)`；
3. 否则 `create`；撞唯一键（`P2002`）说明并发创建，重读一次。

返回 `Map<workId, ledgerProjectId>`。重名的 Work（同工作区两个同名项目）各自是独立的 `LedgerProject`，界面用 `名称 · #前6位id` 区分（§13）。

### 8.4 删除前刷新：`snapshotProjectCostsBeforePurge(projectId)`

改动点唯一：`src/lib/projects/recycle-bin.ts` 的 `purgeProject`（当前 `:160`），在 `await prisma.project.delete(...)`（当前 `:168`）**之前**加一行：

```ts
await snapshotProjectCostsBeforePurge(project.id)   // from '@/lib/compute-ledger/sync'
```

函数行为：

1. `project.findUnique({ where: { id }, select: { workId, work: { select: { workspaceOwnerId, name } } } })`；查不到直接返回。
2. 这个作品的 `UsageCost` 最早/最晚时间 → 按 31 天切块 → 走 §8.2 的两遍法（WHERE 额外加 `AND u.projectId = ?`）→ §8.3 upsert；先 `ensureLedgerProjects`。
3. **失败语义**：抛错 → `purgeProject` 失败 → 调用方既有逻辑记 `recycle-bin.purge_failed` 并按 `RECYCLE_BIN_PURGE_RETRY_MS` 重试，**宁可晚删，不可丢账**。
4. **唯一例外**：捕获到 Prisma `P2021`（表不存在，意味着代码先于迁移上线），`logWarn` 后返回，别让回收站被卡死。这条要有单测。
5. 不要改 `purgeExpiredRecycleBinProjects` 的其它逻辑，不要动 `reconcile.ts`。

### 8.5 回填脚本 `scripts/ledger-backfill.ts`

```
npx tsx scripts/ledger-backfill.ts --owner <workspaceOwnerId> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]
npx tsx scripts/ledger-backfill.ts --all-owners [--dry-run]
```

- 复用 `runFactChunk` / `upsertFacts` / `ensureLedgerProjects`，31 天一块，逐块打印「块 / 行数 / 微元合计」。
- `--dry-run` 只打印不写；默认写。结束时打印每个工作区的累计总额，和 `SELECT SUM(cost)`（同口径）人工对一眼。
- 脚本的 import 与输出写法照抄 `scripts/billing-reconcile-ledger.ts`：`import { prisma } from '@/lib/prisma'`，结果用 `process.stdout.write(JSON.stringify(payload, null, 2) + '\n')`。**不要用 `console.*`**：`npm run check:logs`（`scripts/check-no-console.ts`）用 `rg "console\.(log|info|warn|error|debug)\(" src scripts` 同时扫 `src` 和 `scripts`。
- 在 `package.json` 的 `scripts` 里加一条 `"ledger:backfill": "tsx --env-file=.env --env-file=.env.local scripts/ledger-backfill.ts"`（参照 `dev:worker` 的 `--env-file` 写法）。**agent 只在本地 dev 库跑**；对测试机/生产跑由用户决定（§16）。

## 9 手填条目与项目元数据（服务层，`entries.ts` / `projects.ts` / `settings.ts`）

### 9.1 录入条目 `createEntry(ctx, input)`

`ctx = { ownerId, actorId, isAdmin }`，全部取自会话（R8）：`ownerId = session.user.workspaceOwnerId ?? session.user.id`，`actorId = session.user.actorId ?? session.user.id`，`isAdmin = normalizeAccountRole(session.user.role) === 'admin'`（超管 `super_admin` 不走账本：他不属于任何工作区）。

输入（zod）：

```ts
{ ledgerProjectId: string,
  dateKey: string,                          // 'YYYY-MM-DD'，isValidDateKey
  kind: 'api_token' | 'jimeng_points' | 'other_cny',
  quantity: number,                         // 见下
  remark?: string,                          // ≤ 500，trim
  actorUserId?: string }                    // 仅 admin 有效，代别人录；成员传了也忽略
```

校验与规则：

| 规则 | 内容 |
|---|---|
| 项目 | 必须存在、属于本工作区、未归档；成员额外要求：关联了 Work 的项目，该 Work 必须在 `prisma.work.findFirst({ where: workReadWhere(session, workId) })` 里可见（`src/lib/collaboration/access.ts:84`）；没关联 Work 的外部项目，成员可见 |
| 日期 | 不得晚于「今天（上海）」；成员只能记最近 **14 天**内（常量 `MEMBER_BACKDATE_DAYS = 14`）；admin 不限，但要 ≥ `2020-01-01` |
| 数量 | `api_token`：整数 `1 … 1e12`；`jimeng_points`：`0.01 … 1e9`，最多 2 位小数；`other_cny`：成员 `0.01 … 1e7`，**admin 允许负数**（用来校准，必须带备注） |
| 汇率 | 服务端读 `LedgerSetting`：`api_token → tokenRateCnyPerMillion`，`jimeng_points → jimengCnyPerPoint`，`other_cny → 1`；写进 `rate` 快照。请求体里任何 `rate` / `amount` 字段一律忽略（R5） |
| 金额 | `amountCny = fromMicros(computeEntryAmountMicros(kind, quantity, rate))` |
| 提交人 | 成员：`actorUserId = ctx.actorId`；admin：可指定，指定的账号必须是本工作区的 `active` 账号（直接用 `requireActiveWorkspaceUser(ownerId, userId)`，`access.ts:107`，不满足会抛 `ApiError('INVALID_PARAMS')`；已停用的账号不能代录，历史花费照常显示）；`actorLabel` 取其当前用户名 |
| 去重 | **不做**唯一约束：同一人同一天同项目同类型允许多条（xlsx 里也有人一天填两次的情形）。前端在重复时给出温和提示「你今天已为这个项目记过一条 API token，确定再加一条？」，不拦截 |
| 单日合计上限 | 单条 `amountCny > 100000`（常量 `ENTRY_SANITY_MAX_CNY`）拒绝并提示核对数量；admin 带 `confirmLarge: true` 可放行 |
| 日志 | `logInfo('[LedgerAudit] entry.create', { operator, entryId, ledgerProjectId, dateKey, kind, amountCny, onBehalfOf })` |

### 9.2 作废与编辑

- `voidEntry(ctx, id)`：`voidedAt = now, voidedById = ctx.actorId`。成员只能作废**自己**的、且 `dateKey` 在最近 14 天内的条目；admin 任意。已作废的再作废返回 200（幂等）。
- `replaceEntry(ctx, id, patch)`：编辑 = 在一个事务里作废旧行 + 新增一行（`replacesEntryId = 旧id`），新行重新套 §9.1 的全部校验（汇率重新取当前值，**不沿用旧行的 `rate`**：编辑等于重新录入）。这样不需要审计表，历史链完整。
- 导入行（`source = 'import'`）成员不可改不可作废；admin 可作废。

### 9.3 项目元数据 `projects.ts`

- `createLedgerProject(ctx, { name, workId?, category?, … })`（admin）：给了 `workId` → 必须是本工作区未删除的 Work，且尚未被别的 `LedgerProject` 关联，`name` 取 Work 的名字；没给 → 外部项目，`name` 必填，`normalizeProjectName` 后与本工作区未归档项目撞名返回 409 `CONFLICT`。
- `patchLedgerProject(ctx, id, patch)`（admin）：可改 `category / status / startDate / targetDeliveryDate / budgetCny / durationMinutes / totalEpisodes / doneEpisodes / note`；`name` 仅当 `workId == null` 才可改；`status` 变为 `completed` 且 `completedDate` 为空时自动写今天（上海），变回别的状态清空 `completedDate`；`doneEpisodes > totalEpisodes` 返回 400；`budgetCny` 允许置空（`null`），不允许负数。每次改预算 `logInfo('[LedgerAudit] project.budget', { from, to })`。
- `archiveLedgerProject(ctx, id, archived: boolean)`（admin）：只设 `archivedAt`。归档项目默认不出现在 overview 和成员的项目选项里，但**它的数字照常计入「全部」合计**——不能因为归档让总数变化；overview 提供 `includeArchived=1` 切换行显示。**不提供删除**。
- `listProjectOptions(session)`：成员「记一笔」下拉用。未归档项目；按 §9.1 的可见性过滤；返回 `{ id, name, category, status, hasBudget: boolean }`——**不返回预算金额和累计消耗**（成员不该看到别人的花费，D4）。

### 9.4 设置 `settings.ts`

`getSettings(ownerId)`（首次 upsert 默认值）、`updateSettings(ctx, { tokenRateCnyPerMillion?, jimengCnyPerPoint? })`（admin；两个都 `0 < x ≤ 10000`，最多 6 位小数）。改汇率**只影响之后新录入的条目**，旧条目的 `rate` / `amountCny` 保持不变（D7）；设置页要把这句话写给用户看。`logInfo('[LedgerAudit] settings', …)`。

## 10 读取与 API

### 10.1 路由清单与权限

| 方法 路径 | 谁能调 | 作用 |
|---|---|---|
| `GET /api/admin/compute-ledger/overview` | admin | 算力表（项目 × 人 + 预算） |
| `GET /api/admin/compute-ledger/report` | admin | 日报 / 周 / 三日（`view=day\|week\|tri`），支持 `format=csv` |
| `GET /api/admin/compute-ledger/entries` | admin | 全部手填条目（含已作废，可筛选） |
| `POST /api/admin/compute-ledger/projects` | admin | 新建账本项目（关联 Work 或外部项目） |
| `PATCH /api/admin/compute-ledger/projects/[id]` | admin | 改元数据 / 预算 / 归档 |
| `GET /api/admin/compute-ledger/work-candidates` | admin | 还没有账本项目的 Work 列表，供「新建」选 |
| `GET` `PATCH /api/admin/compute-ledger/settings` | admin | 汇率 |
| `POST /api/admin/compute-ledger/sync` | admin | 「立即刷新」，同 §8.1，返回 `{ complete, syncedThroughDate }` |
| `POST /api/admin/compute-ledger/import` | admin | 历史导入（`mode=dry-run\|commit`，P4，§12） |
| `GET /api/compute-ledger/me` | admin + 成员 | 我自己的日报（我的平台花费 + 我的手填） |
| `GET /api/compute-ledger/project-options` | admin + 成员 | 「记一笔」的项目下拉（§9.3，不含金额） |
| `POST /api/compute-ledger/entries` | admin + 成员 | 记一笔（§9.1） |
| `PATCH` `DELETE /api/compute-ledger/entries/[id]` | admin + 成员 | 编辑 / 作废（§9.2） |

每条路由的骨架（照抄 `src/app/api/admin/activity/route.ts`）：

```ts
export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()                       // 成员路由用 requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  if (normalizeAccountRole(authResult.session.user.role) !== 'admin')
    return forbidden('仅管理员可以查看算力账本。')                    // 超管同样拒绝：他不属于任何团队工作区
  const ownerId = authResult.session.user.id                         // admin 的 id 就是工作区 id
  …
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS })   // 'private, no-store, max-age=0'
})
```

- 成员路由：`ownerId = session.user.workspaceOwnerId ?? session.user.id`，`actorId = session.user.actorId ?? session.user.id`；`role === 'super_admin'` 一律 403。
- 请求体和查询参数一律 zod；失败抛 `new ApiError('INVALID_PARAMS', { message })`（R9）。日期参数必须 `isValidDateKey`，且 `from ≤ to`。
- **`src/lib/account/permissions.ts` 的唯一改动**：在 `requiredPermissionsForApiPath`（`:211`）里 `if (path.startsWith('/api/works')) return ['read']`（`:229`）这一行**之前**加一行：

  ```ts
  if (path.startsWith('/api/compute-ledger')) return ['read']   // 成员自助录入；对象级权限在路由内校验
  ```

  原因：非 GET 请求落不到任何规则时末尾 `return ['admin']`（`:262`），成员 POST 会被拒。`/api/admin/compute-ledger/**` **不要**加规则，它的非 GET 本来就落到 `['admin']`，正好。要加单测（`tests/unit/account/` 下找现有 permissions 测试，追加：成员 `POST /api/compute-ledger/entries` 返回 `['read']`；`POST /api/admin/compute-ledger/projects` 返回 `['admin']`）。

### 10.2 `GET /api/admin/compute-ledger/overview`

查询参数：`from` / `to`（可选，都不传 = 全部时间）、`q`（项目名子串）、`category`、`status`、`includeArchived=1`、`refresh=1`。流程：`syncPlatformFacts` → 读 → 合并 → 返回。

```ts
type OverviewResponse = {
  currency: 'CNY'
  asOf: string                                    // 今天（上海）
  range: { from: string | null; to: string | null }
  sync: { complete: boolean; syncedThroughDate: string | null; billingMode: 'OFF' | 'SHADOW' | 'ENFORCE' }
  rates: { tokenRateCnyPerMillion: number; jimengCnyPerPoint: number }
  totals: {                                       // 含归档项目：归档不改变总数
    totalCny: number; periodCny: number
    platformCny: number; externalCny: number
    budgetCny: number                             // 仅统计设了预算的项目
    overCount: number; warnCount: number
  }
  rows: OverviewRow[]
}
type OverviewRow = {
  projectId: string; name: string; workId: string | null
  workState: 'active' | 'recycled' | 'purged' | 'external'   // external = 没有关联 Work
  duplicateName: boolean                          // 同工作区还有同名项目 → 界面加 #id 后缀
  category: Category | null; status: 'in_progress' | 'completed' | 'paused'
  startDate: string | null; completedDate: string | null; targetDeliveryDate: string | null
  elapsedDays: number | null                      // §7.5
  durationMinutes: number | null; costPerMinute: number | null
  totalEpisodes: number | null; doneEpisodes: number | null; completionRatio: number | null
  budgetCny: number | null; remainingCny: number | null; usageRatio: number | null; level: BudgetLevel
  totalCny: number                                // 累计（全部时间）
  periodCny: number                               // 所选区间；没传区间时等于 totalCny
  platformCny: number; externalCny: number        // 累计中的两部分
  byActor: Array<{ actorKey: string; name: string; totalCny: number; periodCny: number }>  // 按 totalCny 降序
  archived: boolean
}
```

计算（不要全表拉进 JS）：

1. `ledgerProject.findMany({ where: { workspaceOwnerId } })`；
2. `ledgerDailyFact.groupBy({ by: ['ledgerProjectId', 'actorUserId'], where: { workspaceOwnerId }, _sum: { costCny: true } })`，区间版本多一个 `dateKey: { gte: from, lte: to }`（字符串比较，格式固定所以正确）；
3. `ledgerEntry.groupBy({ by: ['ledgerProjectId', 'actorUserId', 'actorLabel'], where: { workspaceOwnerId, voidedAt: null }, _sum: { amountCny: true } })`，同样一份带区间的；
4. 一次 `user.findMany({ where: { id: { in } }, select: { id, name } })` 取名字；一次 `work.findMany({ where: { id: { in: workIds } }, select: { id, deletedAt } })` 算 `workState`（查不到 = `purged`）；
5. `actorKey`：`actorUserId ? 'u:' + actorUserId : 'l:' + actorLabel`。同一个人在 facts 与 entries 里的 key 一致才能合并，所以 key 的生成函数放在 `calc.ts`，两边共用；
6. 所有 Decimal 经 `toMoneyNumber` → `toMicros` 整数累加，返回前 `fromMicros`；
7. 预算 / 等级 / 余额按 §7.4（用 `totalCny`，不是 `periodCny`）。

### 10.3 `GET /api/admin/compute-ledger/report`

查询参数：`view`（默认 `day`）、`from` / `to`、`projectId`、`actorKey`、`page` / `pageSize`（仅 `day`，默认 1–200，最大 1000）、`format=csv`。默认区间：`day` 最近 30 天；`week` 含本周在内的最近 8 周；`tri` 最近 30 天。上限：`day` ≤ 93 天，`week` / `tri` ≤ 400 天，超出返回 `INVALID_PARAMS`。

第一步统一：取区间内的 facts（按 `ledgerProjectId, dateKey, actorUserId` 汇总）和未作废的 entries（按 `ledgerProjectId, dateKey, actorKey, kind` 汇总，同时收集 `remark`），合并成 `LedgerCell[]`：

```ts
type LedgerCell = {
  dateKey: string; projectId: string; actorKey: string; actorName: string
  platformMicros: number
  tokenQty: number; tokenMicros: number
  jimengQty: number; jimengMicros: number
  otherMicros: number
  remarks: string[]
}
// totalMicros = platformMicros + tokenMicros + jimengMicros + otherMicros
```

三种视图都是对 `LedgerCell[]` 的纯函数（`calc.ts` 或 `aggregate.ts`，可单测）：

- **day**（= 截图 2 / 每日算力日报）：一行一个 cell。字段：`dateKey, weekLabel, projectName, category, actorName, platformCny, apiTokens, apiTokenCny, jimengPoints, jimengCny, otherCny, totalCny, remark`。排序 `dateKey` 降序 → 项目名 → 提交人。
- **week**：先按 `(weekStartKey(dateKey), projectId)` 分组得「周项目算力总和」，组内再按 actor 分得「个人周项目算力总和」。一行 = 一个项目的一周，带 `people[]`。排序：周降序 → 周合计降序。
- **tri**：按 `(triBucket(dateKey).label, projectId)` 分组得「三日算力总消耗」。一行 = 一个项目的一个三日段。

返回时每个视图附 `footer: { totalCny }`（该筛选下的总和，**对整个筛选结果求和而不是只对当前页**）。

### 10.4 `GET /api/compute-ledger/me`

参数 `from` / `to`（默认最近 14 天，最多 93 天）。只返回「actor = 我」的 cell（facts 按 `actorUserId = actorId`；entries 按 `actorUserId = actorId`）。额外返回我自己的未作废条目列表，每条带 `editable: boolean`（§9.2 的规则）。**不返回**预算、项目累计、别人的任何数据。

### 10.5 CSV（`format=csv`）

照 `buildActivityCsv`（`activity-stats-shared.ts:293`）：UTF-8 BOM 开头、行尾 `\r\n`、响应头 `Content-Type: text/csv; charset=utf-8`、`Content-Disposition: attachment; filename="compute-ledger-<view>-<from>_<to>.csv"`，`Cache-Control: private, no-store`。

| view | 列（顺序，中文表头，与表格一致，新增列用「平台自动消耗（元）」标出） |
|---|---|
| `day` | 日报提交日期、项目名称、项目类型、周区间、提交人、当天API消耗（token）、当天即梦消耗（积分）、**平台自动消耗（元）**、当天算力总消耗（元）、备注 |
| `week` | 周区间、项目名称、项目类型、提交人、个人周项目算力总和（元）、周项目算力总和（元） |
| `tri` | 每三天分组、项目名称、三日算力总消耗（元） |
| overview（`/overview?format=csv`） | 项目名称、项目类型、开工日期、总消耗（元）、算力预算（元）、预算余额（元）、使用率、成片时长（分钟）、元/分钟、总集数、已完成集数、完成情况、个人明细（`姓名 金额；姓名 金额`） |

- 金额写 2 位小数；`项目类型` 写中文（`精品` …）；`完成情况` 写 `进行中 / 已完成 / 暂停`。
- `csvCell` 在 `activity-stats-shared.ts:278` 是私有函数，**不要改那个文件**（R2）。账本自己在 `csv.ts` 里写一份：双引号转义 + 逗号/换行/双引号时加引号；**另加 R13**：字符串以 `=` `+` `-` `@` `\t` `\r` 开头时前置 `'`。（纯数字列不受影响；负数金额是 number 类型，不走字符串逻辑，不要把 `-12.5` 误加引号前缀。）
- 单测：备注 `=cmd|' /C calc'!A0` 导出后以 `'=cmd` 开头；备注含逗号、双引号、换行时能被标准 CSV 解析器还原。

### 10.6 缓存与性能

- 所有接口 `no-store`，不做服务端缓存。
- overview 只发约 6 条查询，全部走 `workspaceOwnerId` 开头的索引（§6）；report 的 `day` 视图按 93 天封顶。
- 懒同步有 60 秒节流（§8.1），连续刷新页面不会反复扫 `usage_costs`。

## 11 界面

视觉与交互一律复用现有 `fos-*` 体系，**不引入新组件库、不用渐变**（设计方向：纸面/放映，纯色；`project_design_direction`）。颜色用现成 token：`--fos-warning`（黄）、`--fos-danger` / `--fos-danger-text`（红）、`--fos-success`（绿）、`--fos-primary`。控件高度遵守「32px 工具栏控件 / 28px 密集控件 / 40px 弹窗主按钮」（`fos-btn` 默认、`fos-btn-sm`、`fos-input`、`fos-seg`、`fos-seg-opt`、`fos-stat-tile` + `statTileStyle(key)` 都是现成的）。

### 11.1 文件清单

| 文件（新建，除非标「改」） | 作用 |
|---|---|
| `src/app/[locale]/account-management/ledger/page.tsx` | 服务端守卫，**逐行照抄** `src/app/[locale]/account-management/activity/page.tsx`（未登录 → 登录页；`super_admin` → `/admin/accounts`；非 `admin` → `/projects`），渲染 `<FosComputeLedgerClient />` |
| `src/components/frameos/FosComputeLedgerClient.tsx` | 管理员页外壳：`<FosShell activeKey="accounts">` + 标题 + `<TeamManagementTabs active="ledger" />` + 分段控件 + 横幅；只做状态与拼装，≤ 300 行 |
| `src/components/frameos/compute-ledger/LedgerOverviewTable.tsx` | 「算力表」（§11.2） |
| `src/components/frameos/compute-ledger/LedgerReportTable.tsx` | 「日报 / 周 / 三日」三个视图共用的表（§11.3） |
| `src/components/frameos/compute-ledger/LedgerEntriesPanel.tsx` | 「手填记录」，管理员看全员（§11.4） |
| `src/components/frameos/compute-ledger/LedgerSettingsPanel.tsx` | 「设置」：汇率（§11.5） |
| `src/components/frameos/compute-ledger/LedgerProjectDrawer.tsx` | 项目元数据编辑抽屉 + 「新建项目」 |
| `src/components/frameos/compute-ledger/RecordEntryDialog.tsx` | 「记一笔」弹窗，管理员页与成员页共用（§11.7） |
| `src/components/frameos/compute-ledger/ledger-format.ts` | 纯函数：金额 / 比例 / 数量格式化、等级文案；可单测 |
| `src/components/frameos/compute-ledger/use-ledger-sync.ts` | 「正在补齐历史」自动重取的 hook（§11.6） |
| `src/app/[locale]/compute-ledger/page.tsx` | 成员页服务端守卫（未登录 → 登录页；`super_admin` → `/admin/accounts`；其余直接渲染），渲染 `<FosMyLedgerClient />` |
| `src/components/frameos/FosMyLedgerClient.tsx` | 「我的算力」（§11.8） |
| 改 `src/components/frameos/TeamManagementTabs.tsx` | 第三个标签（见下） |
| 改 `src/components/frameos/FosShell.tsx` | 成员入口（§11.9） |
| 改 `src/styles/frameos-replica.css` | 末尾追加 `.fos-ledger-*`（§11.10） |

`TeamManagementTabs` 的改动（只此一处，别重排现有两个标签）：

```tsx
export function TeamManagementTabs({ active }: { active: 'members' | 'activity' | 'ledger' }) {
  const tabs = [
    { key: 'members' as const, label: '成员与积分', href: '/account-management' },
    { key: 'activity' as const, label: '工作监督', href: '/account-management/activity' },
    { key: 'ledger' as const, label: '算力账本', href: '/account-management/ledger' },
  ]
```

改完跑 `npx vitest run tests/unit/frameos`：该目录有字符串型契约测试（如 `account-management-platform.test.ts`），可能断言标签结构，若断言了标签个数就把期望更新为 3。

### 11.2 算力表（对应截图 1）

数据：`GET /api/admin/compute-ledger/overview`（§10.2）。

页面头部（同工作监督的版式）：标题「团队管理」，副标题「算力账本：平台自动记录的花费 + 手填的外部花费，按上海时间自然日计算，仅管理员可见」。

**分段控件**（`fos-seg`）：`算力表 | 日报 | 周 | 三日 | 手填记录 | 设置`，默认「算力表」。切换不跳页，只换面板；当前面板写进 URL 查询串 `?tab=overview|day|week|tri|entries|settings`，刷新后保留。

**筛选行**：区间（`fos-seg` 四选一：`全部 | 本月 | 近 30 天 | 自定义`，自定义出两个 `<input type="date">`）、项目名搜索（`fos-input`，300ms 防抖，`q`）、类型下拉（5 个 + 全部）、状态下拉（进行中 / 已完成 / 暂停 / 全部）、`显示已归档` 复选框、`刷新`（`refresh=1`）、`导出 CSV`（`format=csv`，沿用工作监督的 blob 下载写法）、`新建项目`（打开 §11.2.2 的抽屉）。

**汇总卡**（`fos-stat-tile`，6 张，`statTileStyle` 的 key 给括号里的）：累计总消耗（`total`）、所选区间消耗（`workflow`）、平台自动（`visual`）、外部手填（`renders`）、预算合计（`quality`，仅统计设了预算的项目，副文案「N 个项目设了预算」）、超支 / 预警项目数（`failed`，文案 `2 超支 · 3 预警`）。数字取 `totals`，**不要前端自己再加**。

**表格**（照 `FosStaffActivityClient` 的 `role="table"` + CSS grid 做法，`min-w-[1180px]` 横向滚动）：

| 列 | 内容 | 对齐 / 排序 |
|---|---|---|
| 项目 | 名称（`duplicateName` 时后缀 ` · #abc123`）+ 小标签：`外部`（`workState=external`）、`已回收`、`已删除`（`purged`，灰色，tooltip「作品已从平台删除，历史花费仍保留」）、`已归档` | 可按名称排序 |
| 类型 | 中文类型；空则 `—` | |
| 总消耗（元） | `totalCny`，2 位小数；tooltip 显示「平台自动 ¥x + 手填 ¥y」 | 右对齐，可排序，**默认降序** |
| 算力预算（元） | `budgetCny`；空显示 `未设预算`（灰） | 右对齐 |
| 预算余额（元） | `remainingCny`；负数红色并显示 `超支 ¥x` | 右对齐，可排序 |
| 使用率 | 细进度条（`fos-ledger-bar`，纯色，宽度 `min(ratio,1)`）+ 百分比；`warn` 黄，`over` 红，`ok` 默认，`none` 不画条 | 可排序 |
| 工期（天） | `elapsedDays`；空 `—` | 右对齐 |
| 开工日期 | `startDate`，`MM-DD`（跨年显示完整） | 右对齐，可排序 |
| 时长（分钟） | `durationMinutes` | 右对齐 |
| 元 / 分钟 | `costPerMinute` | 右对齐 |
| 完成情况 | `完成比` 文本：`doneEpisodes/totalEpisodes（xx%）`；没有集数时用状态徽标 `进行中 / 已完成 / 暂停` | |

**展开行**：点击一行展开「个人明细」（`byActor`，按累计降序）：姓名、区间金额、累计金额、占该项目累计的百分比；最后一行「合计」，必须等于该项目 `totalCny`（实现时用同一批整数微元，保证相等）。截图 1 是把每个人摊成一列，团队有 20+ 人时太宽，所以改为行内展开，**CSV 的 `个人明细` 列保留完整信息**（§10.5）。点击项目名右侧的「编辑」图标（`edit`）打开元数据抽屉。

**空状态**：没有任何项目时显示「还没有账本项目。平台里一旦有付费调用，会自动出现；也可以点「新建项目」记录平台之外的项目。」

#### 11.2.1 排序 / 筛选在前端还是后端

项目数是几十量级，`overview` 一次全量返回，排序、`q` 子串过滤在前端做（`useMemo`）；`from / to / category / status / includeArchived` 才发请求。用 `createLatestRequestTracker()`（`src/lib/api/latest-request.ts`）丢弃过期响应，写法照抄 `FosStaffActivityClient` 的 `load`。

#### 11.2.2 项目抽屉（编辑元数据 / 新建）

右侧抽屉，结构照 `FosStaffActivityClient` 的 `ActivityDrawer`（`ViewportDialogLayer` 包一层，`useDialogDismiss` 处理 Esc）。字段：

| 字段 | 控件 | 规则 |
|---|---|---|
| 名称 | 文本；**仅外部项目可改**，关联了 Work 的项目只读并注明「名称跟随平台作品」 | ≤ 191，trim，撞名提示（409） |
| 关联作品 | 仅「新建」时出现：下拉，数据来自 `GET /api/admin/compute-ledger/work-candidates`；留空 = 外部项目 | 选了作品则名称取作品名 |
| 类型 | 下拉 5 种 + 空 | |
| 状态 | 进行中 / 已完成 / 暂停 | 变「已完成」自动写完成日（§9.3） |
| 开工日期 / 目标交付日期 | `<input type="date">` | 可空 |
| 算力预算（元） | 数字，`step=0.01`，可清空 | ≥ 0；清空 = 未设预算；改动弹一行确认「预算将从 ¥a 改为 ¥b」 |
| 成片时长（分钟） | 数字 | ≥ 0 |
| 总集数 / 已完成集数 | 整数 | 已完成 ≤ 总集数 |
| 备注 | 多行 ≤ 500 | |
| 归档 | 底部「归档此项目」按钮（二次确认）；说明「归档后默认不显示，累计数字不变」 | 无删除按钮 |

提交调 `PATCH /api/admin/compute-ledger/projects/[id]`，成功后局部刷新该行，不整页重载。

### 11.3 日报 / 周 / 三日（对应截图 2）

数据：`GET /api/admin/compute-ledger/report?view=…`（§10.3）。三个视图共用 `LedgerReportTable`，由 `view` 决定列：

| view | 列 | 备注 |
|---|---|---|
| `day` | 日期、项目、类型、周区间、提交人、API token、API 折元、即梦积分、即梦折元、其它（元）、平台自动（元）、当天合计（元）、备注 | 与截图 2 同列序，新增「平台自动」「其它」两列；分页（200/页），底部显示**整个筛选结果**的合计（`footer.totalCny`） |
| `week` | 周区间、项目、周合计（元），行内展开 `people[]`：提交人、个人周合计（元） | 周降序 |
| `tri` | 每三天分组、项目、三日合计（元） | 三日段降序 |

筛选：区间（默认值见 §10.3）、项目下拉（含归档）、提交人下拉（来自 `byActor` 或 overview 的人名集合）、`导出 CSV`。费用为 0 的 cell 不显示（平台没有数据也没有手填的日子不出行）。

金额显示 2 位小数；**列合计由后端给，前端不要把显示出来的 2 位小数再相加**（R5）。token 数用千分位，积分保留最多 2 位小数。

### 11.4 手填记录（管理员）

数据：`GET /api/admin/compute-ledger/entries`（含已作废；参数 `from/to/projectId/actorKey/kind/includeVoided/source/page`）。表格列：日期、项目、提交人、类型（`API token / 即梦积分 / 直接填元`）、数量、单价快照、金额、备注、来源（`手填 / 导入`）、状态（`正常 / 已作废`）、操作。作废行灰显、删除线金额。

操作：`作废`（二次确认，`DELETE …/entries/[id]`）、`编辑`（= 作废 + 新建，打开 `RecordEntryDialog` 预填，§9.2）。导入的行（`source=import`）只有 `作废`。顶部按钮 `记一笔`（管理员可在弹窗里选「代谁记」，§11.7）。

### 11.5 设置

`GET / PATCH /api/admin/compute-ledger/settings`。两个数字输入：`API token 单价（元 / 百万 token）`、`即梦积分单价（元 / 积分）`，保存按钮。**必须在表单下方写明**：「修改汇率只影响之后新记的条目，已记的条目保持当时的单价和金额不变。」再加一行只读：平台自动记账同步到 `syncedThroughDate`、上次同步时间；一个按钮 `立即刷新平台数据`（`POST …/sync`）。

### 11.6 横幅与同步状态

页面顶部，按优先级只显示一条（`role="status"`，样式沿用 `fos-activity` 错误条的 `rounded-[9px] border …` 那套）：

1. **计费模式不是 ENFORCE**（`sync.billingMode !== 'ENFORCE'`）：「当前环境的计费模式是 `{mode}`，平台不会写入消耗流水，算力账本里「平台自动」一栏不会有数据；手填记录不受影响。」
2. **正在补齐历史**（`sync.complete === false`）：「正在补齐历史数据（已到 {syncedThroughDate}）…」。`use-ledger-sync` 每 2 秒重取一次当前面板，最多 20 次，之后停止并改为「数据较多，请稍后点「立即刷新」继续」。组件卸载 / 切换面板时必须清定时器。
3. **请求失败**：沿用工作监督的错误条 + 「重试」按钮（`readApiErrorMessage`）。

### 11.7 「记一笔」弹窗 `RecordEntryDialog`

管理员页和成员页共用。`ViewportDialogLayer` + `fos-dialog` 结构，`useDialogDismiss`，打开时焦点落到第一个输入。控件：

| 字段 | 控件 | 规则 |
|---|---|---|
| 日期 | `<input type="date">`，默认今天（上海），`max` = 今天；成员 `min` = 今天 − 14 天 | 与 §9.1 同步，后端为准 |
| 项目 | 下拉，选项来自 `GET /api/compute-ledger/project-options`（不含金额）；最近用过的项目排在最前（`localStorage` 存最近 5 个项目 id，**只存 id，不存任何金额**） | 必填 |
| 类型 | `fos-seg` 三选一：`API token`、`即梦积分`、`直接填元` | 默认 `API token` |
| 数量 | 数字输入；单位随类型变化（`token` / `积分` / `元`） | 校验同 §9.1 |
| 折合金额 | **只读预览**：`≈ ¥xx.xx（单价 46 元/百万 token）` | 前端用 `calc.computeEntryAmountMicros` + 当前汇率算，**仅供预览，服务端重算**（R5） |
| 备注 | 单行 ≤ 500，占位「例：和婚介拆账，婚介 65 + 悬疑 131」 | 可空 |
| 代谁记（仅管理员） | 下拉：本工作区 `active` 账号 | 默认自己 |

提交：`POST /api/compute-ledger/entries`；成功后关闭弹窗、列表局部刷新、toast「已记录 ¥xx.xx」。重复提示（§9.1「去重」）在提交前用已加载的「我的条目」判断，在弹窗内用行内确认（一行黄字 + 「仍然记录」按钮），不要用 `window.confirm`。失败显示后端 `message`。

**外部 API 重复计算的提示**（写在弹窗里，灰字）：「在平台内生成的花费已经自动记账，这里只记平台之外的花费，否则会重复计算。」§13 说明了原因。

### 11.8 成员页「我的算力」

路由 `/compute-ledger`，`<FosShell activeKey="computeLedger">`。数据：`GET /api/compute-ledger/me`（§10.4）。

- 标题「我的算力」，副标题「你在平台内的花费会自动记录；平台之外的花费请在这里补记。只有你和管理员能看到。」
- 区间（`fos-seg`：`近 14 天 | 近 30 天 | 本月`）、右上 `记一笔`。
- 汇总卡 3 张：区间合计、平台自动、手填。
- 日报表：日期、项目、平台自动、token、即梦、其它、当天合计、备注；每行下面不展开别人的数据（后端本来就不返回）。
- 「我的手填」列表：日期、项目、类型、数量、金额、备注、`编辑 / 作废`（按 `editable` 显示；不可改时按钮置灰并 tooltip「只能修改最近 14 天内、自己记的条目」）。
- **不展示**任何预算、项目累计、别人的数据（D4）。

### 11.9 `FosShell` 入口（只加成员入口）

1. `FosNavKey`（`FosShell.tsx:21`）增加 `| 'computeLedger'`。
2. `Sidebar` 页脚，在 `{isAdmin ? <团队管理 …/> : null}` 之后、`secondaryNav.map` 之前加：

```tsx
{!isAdmin ? (
  <Link href={{ pathname: '/compute-ledger' }} className={`fos-nav-item${activeKey === 'computeLedger' ? ' active' : ''}`}>
    <AppIcon name="coins" className="h-4 w-4 shrink-0" />
    <span className="min-w-0 truncate">我的算力</span>
  </Link>
) : null}
```

`coins` 已在 `src/components/ui/icons/registry.ts:176` 注册。管理员不加这个入口（他在「团队管理 → 算力账本」里记账，且可代记）。`canAccess`（`FosShell.tsx:512`）只拦 `accounts`，`computeLedger` 不需要改。改完跑 `npm run check:locale-navigation`（`Link` 必须用 `@/i18n/navigation` 的 `Link`，不要用 `next/link`）。

### 11.10 样式

`src/styles/frameos-replica.css` **末尾追加**，类名统一 `.fos-ledger-*`，只写没有现成类可复用的几处：`.fos-ledger-bar`（进度条轨道 6px 高圆角 + 填充，纯色，`data-level="ok|warn|over"` 分别用 `--fos-primary` / `--fos-warning` / `--fos-danger`）、`.fos-ledger-tag`（小标签）、`.fos-ledger-grid`（算力表的 grid 列模板）、`.fos-ledger-num`（`font-variant-numeric: tabular-nums` 右对齐）、`.fos-ledger-banner`。**日间模式**：用 token 变量而不是写死白字（已有 `html[data-nori-theme="light"]` 体系，参考 `.fos-activity-row` 的写法 `:4586`）。`tests/unit/css-viewport-units.test.ts` 会扫全部 CSS：用到 `dvh/svh/lvh` 的声明，紧挨着的上一行必须是同属性的 `vh` 回退；本方案的样式用不着视口单位，不要写。改完跑 `npx vitest run tests/unit/css-viewport-units.test.ts`。

## 12 历史导入（P4；默认只做 dry-run，提交要用户先选方案）

### 12.1 先解决「xlsx 是部分导出」：三个方案，由用户在 §16 Q1 选

xlsx 的 136 行行级之和 ¥24,138.16，而表里「项目算力总消耗」31 项之和 ¥82,643.90（§1.3）。差额约 ¥58,505.7（约 71%）。三个方案：

| 方案 | 做法 | 结果 | 代价 |
|---|---|---|---|
| **A** 重新导出完整表（推荐） | 用户在飞书里取消视图筛选 / 全量导出，再提供新的 xlsx；转换、dry-run、提交流程不变 | 项目累计 = 完整日报行之和；可以和表里汇总列对账（预期差异只有源表四舍五入） | 需要用户再导一次 |
| **B** 导入 136 行 + 每个项目一条「期初结转」 | `carryForward = 'stated-total'`：每个项目写一条 `other_cny` 条目，金额 = 表里「项目算力总消耗」 − 本次导入行之和（差额 ≤ ¥0.05 视为源表 0.1 元舍入，不写），备注 `[期初结转]`，提交人显示「期初结转」，**日期固定为 `2020-01-01`**（`CARRY_FORWARD_DATE_KEY`） | 项目累计与表里汇总列对得上；周 / 三日 / 日报视图不被这笔钱污染（默认区间根本取不到 2020 年） | 缺失的约 71% 花费没有「谁、哪天」的明细，个人明细里会出现一个「期初结转」的人头；表里汇总列本身是否准确无法核对 |
| **C** 不导历史，从上线日起记 | 不执行导入 | 干净，但项目累计从零开始，预算余额失真（`重生少年` 预算 ¥400，表里已累计 ¥661.50） | 历史预算管控丢失 |

**没有用户的选择，agent 不得提交**（`mode=commit` 前必须有用户在对话里明确说选 A / B / C）。agent 能做的只有：转换器、接口、dry-run 报告、在本地 dev 库用合成数据跑通（§12.7）。

一个值得告诉用户的发现：表里写的汇总列显示 `绝色嫡女`（预算 ¥600，累计 ¥896.80）和 `重生少年`（预算 ¥400，累计 ¥661.50）按完整数据其实已经**超支**，而按这 136 行只会显示「99%」和「66%」。所以方案选择直接影响预警是否准确。

### 12.2 转换器（一次性，用户机器上跑，不进 `package.json`）

`scripts/ledger-xlsx-to-json.py`（Python 3 + `openpyxl`，这两样用户机器上已有；**不要**往 Node 项目里加任何依赖）：

```
python3 scripts/ledger-xlsx-to-json.py <input.xlsx> <output.json>
```

规则：

1. `openpyxl.load_workbook(path, data_only=True)`，取第一个 sheet；按**表头名**找列（不要写死列号：飞书每次导出列序可能变），找不到必需列就报错退出。必需列：`日报提交日期`、`项目名称`、`提交人`、`当天API消耗（token）`、`当天即梦消耗（积分）`。可选列：`项目类型`、`备注`、`项目开始日期`、`目标算力成本（元）`、`目标交付日期`、`总集数`、`已完成集数`、`当天算力总消耗（元）`、`项目算力总消耗（元）`。其余全部忽略（含 `父记录`、`父记录 2`、`文本 2` 和所有周 / 三日 / 完成比汇总列，R4）。
2. 日期单元格可能是 `datetime` 也可能是 `2026/05/07` 字符串，统一成 `YYYY-MM-DD`；解析失败的行写进输出的 `errors`，不要猜。
3. 空白数值 → 0；非数字字符串 → 写进 `errors`。`日报提交日期` 为空的行直接跳过（表尾空行）。
4. 文本字段只做 `str().strip()`，**不在转换器里做归一化**（归一化只在服务端 `calc.ts` 做一次，口径唯一）。
5. 输出：

```json
{
  "source": { "file": "20260622_周项目算力汇总.xlsx", "sheet": "❗每日算力日报", "sha256": "<文件哈希>", "rowCount": 136 },
  "rows": [
    { "rowNo": 2, "dateKey": "2026-05-07", "projectName": "聊斋", "categoryRaw": "短片,短片",
      "actorName": "宋国傲", "apiTokens": 0, "jimengPoints": 2912, "remark": null,
      "statedDayCny": 291.2,
      "projectMeta": { "startDate": "2026-05-07", "budgetCny": 20000, "targetDeliveryDate": null,
                       "totalEpisodes": null, "doneEpisodes": null } }
  ],
  "statedProjectTotals": { "聊斋": 12651.9 },
  "errors": []
}
```

`statedProjectTotals` 取每个项目所有行里该列的最大值（同一项目的该列在表里应一致；不一致时取最大并把项目名写进 `errors` 之外的 `notes` 数组提醒）。`statedDayCny` 只用于 dry-run 的逐行对账，不进库。

### 12.3 接口 `POST /api/admin/compute-ledger/import`

仅 admin（§10.1 骨架）。请求体 zod：

```ts
{ mode: 'dry-run' | 'commit',
  carryForward: 'none' | 'stated-total',        // 方案 A / C 传 'none'，B 传 'stated-total'
  acknowledgeOverlap?: boolean,                  // 见 §12.5
  expectedHash?: string,                         // commit 必填：必须等于上一次 dry-run 返回的 reportHash
  payload: <§12.2 的 JSON> }                     // 行数 ≤ 20000，请求体 ≤ 2 MB
```

两种模式共用同一个计划函数 `buildImportPlan(ctx, payload, options)`（纯逻辑 + 只读查询），`commit` 在它之上写库，这样 dry-run 报告和实际写入不会分叉。

`buildImportPlan` 的步骤：

1. **逐行校验**：`isValidDateKey`、不晚于今天（上海）、`apiTokens` 与 `jimengPoints` 为 ≥ 0 的数（token 取整）、项目名和提交人 trim 后非空。不合格 → `errors[{ rowNo, reason }]`。**只要有 `errors` 就拒绝 commit**（400，把 `errors` 带回去）；dry-run 照常返回报告。
2. **空行**：`apiTokens == 0 && jimengPoints == 0` 的行不生成条目，记入 `summary.emptyRows`（xlsx 里有 1 行：6-22 大明仙师 马俊）。
3. **项目匹配**（按 `normalizeProjectName`；`" 猫、浴缸和早上八点"` 会被归一并写一条 warning）：
   - 先找本工作区**未归档**、`nameKey` 相同的 `LedgerProject` → 复用；
   - 否则在本工作区**未删除**的 `Work` 里按归一化名字找：恰好 1 个且尚未被别的 `LedgerProject` 关联 → 新建 `LedgerProject` 并关联 `workId`（这样历史导入的项目自动拿到平台自动记账）；≥ 2 个 → 歧义，新建外部项目并 warning；0 个 → 新建外部项目。
   - 元数据：只填**当前为空**的字段，**绝不覆盖**管理员已改过的值。`category` 用 `normalizeCategory(categoryRaw)`（多个不同值取第一个并 warning，映射不到的置空并 warning）；`budgetCny`、`startDate`、`targetDeliveryDate`、`totalEpisodes`、`doneEpisodes` 取该项目所有行的第一个非空值，同项目内有冲突的值取第一个并 warning。
4. **提交人匹配**：在本工作区账号里（`id = ownerId` 或其子账号；与 `requireActiveWorkspaceUser` 同口径，实现前先读 `src/lib/collaboration/access.ts:107` 附近确定「本工作区账号」怎么查）按 `NFKC + trim` 后的名字精确匹配；恰好 1 个 → `actorUserId`（停用账号也允许，是历史）；0 个或 ≥ 2 个 → `actorUserId = null`，`actorLabel = 原名字`，并写进 `actors[]` 的未匹配清单让管理员看到。**不做模糊匹配。**
5. **生成条目**（`source = 'import'`）：`apiTokens > 0` → `kind = api_token`，`quantity = apiTokens`，`rate = 46`；`jimengPoints > 0` → `kind = jimeng_points`，`quantity = jimengPoints`，`rate = 0.1`。**导入一律用 46 / 0.1，不读 `LedgerSetting`**（表里的 `当天算力总消耗` 就是按这两个单价算的，用当前设置会让历史金额跟着汇率变）。`amountCny` 走同一个 `computeEntryAmountMicros`。`remark` 只写在该行的第一条条目上。
6. **幂等键**：`importKey = 'imp1:' + sha1(ownerId|dateKey|nameKey|actorKey|kind)`（`actorKey` 即 §10.2 第 5 点的 `u:…` / `l:…`），长度 45，在 `@unique` 的 191 以内。同一份 payload 里键重复 → `errors`（xlsx 的 136 行里没有重复；有的话让用户先合并）。库里已存在同键 → 计入 `summary.alreadyImported` 并跳过，所以**重复导同一份文件是安全的**。
7. **期初结转**（仅 `carryForward = 'stated-total'`）：每个项目 `carry = statedProjectTotals[项目] − Σ本次该项目导入条目金额`；`carry > 0.05` 才生成一条 `other_cny`，`quantity = round(carry, 2)`，`dateKey = '2020-01-01'`，`actorUserId = null`，`actorLabel = '期初结转'`，`remark = '[期初结转] 表格「项目算力总消耗」¥X − 导入日报行之和 ¥Y'`，`importKey = 'imp1:carry:' + sha1(ownerId|nameKey)`。`carry ≤ 0.05`（含负数，如 `六一` 表里 ¥283.40 vs 行和 ¥283.42）不写，也不报警——表里的项目累计列看起来只保留了 1 位小数。
8. **重叠检测**：见 §12.5。
9. **报告**与 `reportHash`：`reportHash = sha256(JSON.stringify({ 条目键与金额的有序列表, 项目匹配结果, options }))`。commit 必须带回同一个 hash，否则 409 `CONFLICT`（说明数据或选项在 dry-run 之后变了，请重新 dry-run），保证「看到的」就是「写入的」。

dry-run 响应（commit 的响应多一个 `batchId`，且 `mode: 'commit'`）：

```ts
type ImportReport = {
  mode: 'dry-run' | 'commit'; reportHash: string; batchId?: string
  summary: { rows: number; emptyRows: number; entriesToCreate: number; alreadyImported: number
             projectsNew: number; projectsMatched: number; projectsLinkedToWork: number
             actorsMatched: number; actorsUnmatched: number
             importedCny: number; carryForwardCny: number }
  projects: Array<{ name: string; action: 'create' | 'reuse'; linkedWork: boolean; rows: number; importedCny: number
                    statedTotalCny: number | null; carryForwardCny: number; meta: Record<string, unknown> }>
  actors: Array<{ name: string; matchedUserId: string | null; rows: number }>
  overlaps: Array<{ project: string; from: string; to: string; platformCny: number; importedCny: number }>
  warnings: string[]
  errors: Array<{ rowNo: number; reason: string }>
}
```

### 12.4 提交与回滚

- **commit**：先 `syncPlatformFacts`，再 `buildImportPlan`，校验 `expectedHash`，然后按「项目 → 条目」顺序写：项目逐个 `create` / 补字段；条目 `createMany({ data, skipDuplicates: true })`，每批 200 条；失败时已写入的批次保留（靠 `importKey` 幂等，重跑即可续上），响应里带 `batchId` 和已写入数量。`importBatchId = 'imp-' + 上海时间 yyyymmddHHMMSS + '-' + 4 位随机`。`logInfo('[LedgerAudit] import.commit', { operator, batchId, entries, importedCny, carryForwardCny })`。
- **回滚** `POST /api/admin/compute-ledger/import/rollback`，body `{ batchId }`（admin）：一个事务里 `ledgerEntry.updateMany({ where: { importBatchId: batchId, voidedAt: null }, data: { voidedAt: now, voidedById: ctx.actorId, importKey: null } })`。把 `importKey` 置空是为了让同一份文件之后能重新导入（`@unique` 列允许多个 NULL）。导入时新建的 `LedgerProject` **不删除**（本方案不提供删除），报告里列出来，需要的话管理员手动归档。把这条路由加入 §10.1 的路由表，并计入 §14.4 的路由目录。
- 「手填记录」面板（§11.4）按 `source=import` 筛选，并支持按 `batchId` 筛选，方便核对一个批次。

### 12.5 与平台自动记账的重叠

导入的行关联到了有平台数据的项目时，表里的 `API token` 有可能**就是**用户在平台里生成产生的（那样平台已经自动记了一份，再导入就是重复），也可能是在平台之外调用 API 花的（不重复）。程序判断不了，所以只报告，让人决定：

- dry-run 先 `syncPlatformFacts`，对每个关联了 Work 的项目，找出「导入行的日期范围内平台也有 `LedgerDailyFact`」的部分，进 `overlaps[]`：`{ project, from, to, platformCny, importedCny }`。
- 有 `overlaps` 时，**commit 必须带 `acknowledgeOverlap: true`**，否则 409，文案「导入数据与平台自动记账的时间范围重叠，请确认表格里的 token 不是在平台内调用产生的」。
- 前端的导入确认框把 `overlaps` 逐项列出来，并附一句 §16 Q7 的提问。

### 12.6 导入界面

放在「设置」面板最下面「历史导入」折叠区（仅 admin，P4 才做）：选择 JSON 文件（`<input type="file" accept=".json">`，前端 `FileReader` 读入后原样当 `payload` 发；不要在前端解析 xlsx）、`carryForward` 三选一（对应 A/B/C：A/C 都传 `none`，C 就是根本不点导入）、`开始 dry-run` → 渲染 `ImportReport`（汇总数字、项目表、未匹配提交人表、重叠表、warnings / errors 列表）→ `确认导入`（仅当 `errors` 为空；有 `overlaps` 时要勾选确认）→ 成功后显示 `batchId` 和「撤销本次导入」按钮。

### 12.7 agent 自己怎么验证（不碰真实数据）

- 在 `tests/fixtures/compute-ledger/sample-rows.json` 放一份**合成** payload（约 12 行，用假名字 / 假项目名，**不要把真实的 xlsx 或 21 个真实姓名提交进仓库**），覆盖：`短片,短片` 去重、`" 前导空格项目"`、仅 token 行、仅即梦行、token + 即梦行、全 0 空行、同一天同人两个项目、`2020` 之前的非法日期、重复键、未匹配的提交人、与某个 Work 同名的项目。
- 单测（`tests/unit/compute-ledger/import-plan.test.ts`）用内存数据驱动 `buildImportPlan`（把「查询」抽成注入的函数，纯逻辑可测）：断言 `summary`、`importKey` 稳定、`reportHash` 对同输入相同对不同选项不同、`carry ≤ 0.05` 不生成。
- 真实 xlsx 的端到端干跑留给用户：agent 把转换器和 dry-run 的使用说明写进最终回复，由用户在自己环境里对着 §附录 A 的数字核对。

## 13 边界情形与处理

| # | 情形 | 处理 |
|---|---|---|
| 1 | 同一工作区里两个同名 Work | 各自一个 `LedgerProject`，界面 `名称 · #前 6 位 id`（`duplicateName`）；导入匹配到 ≥ 2 个同名 Work 时不猜，建外部项目并 warning |
| 2 | Work 改名 | 已关联的 `LedgerProject` 跟随（§8.4a）；历史条目、快照不受影响，因为它们挂的是 `ledgerProjectId` 而不是名字 |
| 3 | Work 进回收站 | `workState = 'recycled'`，花费照常计入；15 天后 `purgeProject` 先快照再删（§8.4），之后 `workState = 'purged'`，数字不变 |
| 4 | 一个 Work 下有多个 `Project`（作品） | 各自独立 purge、各自快照；`LedgerDailyFact` 按 `workId` 汇总，所以同一项目下多个作品的花费自然合并 |
| 5 | 账号被停用 / 被物理删除 | 无外键，账本不级联；名字取 `User.name`，查不到回退到快照的 `actorLabel`；停用账号不能被代录，历史照常显示 |
| 6 | 归档项目 | 数字照计入全部合计，只是默认不显示；`includeArchived=1` 显示；不提供删除 |
| 7 | 跨月 / 跨年的周 | 周标签 `6.29-7.5`、`12.28-1.3`；周键是周一的日期；周项目合计按「周」聚合，不因跨月拆开 |
| 8 | 三日段与月末 | 按月内日号切（§7.3）；31 号单独成段；2 月按月末截断 |
| 9 | 时区边界 | 全部用上海日：`2026-05-31T16:30:00Z` 是上海 6 月 1 日；`2026-05-31T15:59:59Z` 仍是 5 月 31 日。SQL 与 JS 两条路径都要有这个用例（§14.2 #5）。上海没有夏令时，固定 +8 |
| 10 | 同一天同一人同一项目多条手填 | 允许；日报视图合并成一个 cell，备注去重后用 `；` 拼接 |
| 11 | 管理员负数校准条目 | 只允许 `other_cny`、必须带备注；累计可以变成负数，界面用红字照实显示，不拦截 |
| 12 | 平台里已经被删掉的错误 `UsageCost` | 快照 `GREATEST` 不会变小（R3，有意为之）；要纠正就加一条负数校准条目，并在 §11.5 的设置页说明里写这一点 |
| 13 | `UsageCost` 迟到入账 | 懒同步回看 2 天（§8.1）；更早的补记只有 `ledger:backfill --from` 能吸收 |
| 14 | 平台价格 / `MARKUP` 以后调整 | `UsageCost.cost` 已按当时价落库；账本沿用，不重算历史（D2） |
| 15 | 两个管理员同时打开页面 | 同步有 `syncLockedUntil` 互斥 + 60 秒节流，抢不到锁的请求直接读旧快照；`ensureLedgerProjects` 撞唯一键（`P2002`）重读一次 |
| 16 | 跨工作区 | 所有查询都带 `workspaceOwnerId`；成员路由里项目必须 `project.workspaceOwnerId === ctx.ownerId`，否则 404（不是 403，避免泄露存在性） |
| 17 | 计费模式不是 ENFORCE | 平台自动部分为空，页面顶部警告（§11.6）；手填不受影响 |
| 18 | 无项目归属的消耗（资产库 / 工具箱 / 转绘） | 记不到（§3.5、§4.2），页脚说明一句「不含资产库、工具箱等无项目归属的消耗」 |
| 19 | **外部 token 与平台调用双重计算** | 手填的 `API token` 只应记平台之外的花费；弹窗灰字提示（§11.7）；导入时检测重叠（§12.5）。账本本身无法去重，这是人为口径，**不要**写自动去重逻辑 |
| 20 | 大量数据 | 一个 (项目, 日, 人, apiType) 一行事实；31 项目 × 50 天 × 3 人 × 4 类型约 2 万行，overview 全用 `groupBy`，不拉全表 |
| 21 | 未来要回退本功能 | 账本表没有被任何既有表引用，删掉新表和新代码即可，不影响其它功能 |

## 14 测试与验证

### 14.1 单元测试（`tests/unit/compute-ledger/`，纯函数，不要 Docker）

| 文件 | 必须覆盖 |
|---|---|
| `calc.test.ts` | §7.3 的 `triBucket` / `weekStartKey` / `weekLabel` 全部表格用例；`isValidDateKey` 拒绝 `2026-02-30`、`2026-13-01`、`2026-5-7`；`computeEntryAmountMicros`：`12,799,434 token × 46 = 588.773964 元`，加 `583 积分 × 0.1 = 58.3 元`，`toCents` 后 = `647.07`（与 xlsx 一致）；`0.1 + 0.2` 经微元相加 = `0.3` 精确；`budgetState`：`0.7999 → ok`、`0.8 → warn`、`0.9999 → warn`、`1 → over`、预算为 `null` / `0` → `none`；`elapsedDays`（含进行中 / 已完成 / 无开工日）；`costPerMinute`；`completionRatio` 夹在 `[0,1]`；`normalizeProjectName(' 猫、浴缸和早上八点')` 去掉空格；`normalizeCategory('短片,短片') → 'short'`、`'甲方Demo,甲方Demo' → 'client_demo'`、未知值 → `null` |
| `aggregate.test.ts` | `LedgerCell[]` 合并：同一人在 facts（`u:<id>`）和 entries（`u:<id>`）里 key 一致才合并；未匹配提交人（`l:<名字>`）单独成人；`day / week / tri` 三个视图的分组与排序；`footer.totalCny` 是整个筛选结果而非当前页；作废条目不计入 |
| `csv.test.ts` | BOM + CRLF；备注 `=cmd\|' /C calc'!A0` 导出后以 `'=cmd` 开头，`+1`、`-1`、`@x`、`\t`、`\r` 开头同理；含逗号、双引号、换行能被标准 CSV 解析器还原；负数**金额**（number 类型）不被加 `'` |
| `import-plan.test.ts` | §12.7 的合成 fixture：`summary` 数字、`importKey` 稳定、`reportHash` 随选项变化、`carry ≤ 0.05` 不生成、键重复 → `errors`、`errors` 非空时 commit 拒绝 |
| `purge-hook.test.ts` | `snapshotProjectCostsBeforePurge`：Prisma `P2021`（表不存在）→ 只 `logWarn`，resolve；其它错误 → reject（`purgeProject` 因此失败并重试）；查不到作品 → 直接返回 |
| 追加到 `tests/unit/auth/account-permissions.test.ts` | `requiredPermissionsForApiPath` 对成员路径 `POST /api/compute-ledger/entries` → `['read']`；`POST /api/admin/compute-ledger/projects` → `['admin']`。**GET 的返回值以现状为准，不断言**，管理员路由靠路由内部的角色检查把关 |

### 14.2 集成测试（`tests/integration/compute-ledger/`，需要 Docker）

仓库的集成测试由 `tests/setup/global-setup.ts` 在 `BILLING_TEST_BOOTSTRAP=1` 时用 `docker-compose.test.yml` 起 MySQL + Redis 并 `prisma db push`。**如果 agent 所在环境没有 Docker，就不要硬跑**：只交付测试文件，在最终回复里明确写「集成测试未执行」，不得声称通过。

账本表没有外键指向用户，`resetBillingState()`（`tests/helpers/db-reset.ts`）不会清它们，所以每个测试的 `beforeEach` 里要自己按「facts、entries → projects → settings」的顺序 `deleteMany`（`LedgerDailyFact` / `LedgerEntry` 对 `LedgerProject` 是 `Restrict`，顺序反了会报错）。造数据用 `tests/helpers/billing-fixtures.ts` 的 `createTestUser` / `createTestProject`（后者会同时建 `Work` 和 `Project`，`Work.workspaceOwnerId = userId`）。`process.env.BILLING_MODE = 'ENFORCE'`。

| # | 用例 | 断言 |
|---|---|---|
| 1 | 同步基本正确 + 幂等 | 造若干 `UsageCost`（不同日、不同 apiType、不同操作者）→ `syncPlatformFacts` → `ledger_daily_facts` 按 (日, 人, apiType) 的 `SUM(cost)` 与源表同口径一致；再跑一次，数字不变（不翻倍） |
| 2 | `GREATEST`：删除不减账 | 同步后 `prisma.project.delete`（级联删掉 `UsageCost`）→ 再同步（含回看窗口）→ facts 不变、overview 总额不变 |
| 3 | 内部记录排除 | 一行 `action` 含 `isInternalUsageCostRecord` 判为内部的标记（**从 `internal-record-visibility.ts` 里读出真实正则再造数据，不要凭印象**），一行 `action` 含 `agent` 字样但不满足单词边界；断言：facts 总额 == Σ(所有行中 `!isInternalUsageCostRecord` 的 `cost`)，两行分别落在预期的一边 |
| 4 | 操作者还原 | `userId = 管理员` 且 `metadata = {"quotaUserId":"<成员>"}` → 归成员；`userId = 成员` 且无 `quotaUserId` → 归成员；`metadata = {"quotaUserId":null}` → 回落到 `userId`；`metadata = 'not json'`（非法 JSON）→ 查询不报错，归 `userId` |
| 5 | 上海日边界 | `createdAt = 2026-05-31T16:30:00Z` → `dateKey = 2026-06-01`；`2026-05-31T15:59:59Z` → `2026-05-31` |
| 6 | 删除前快照 | `snapshotProjectCostsBeforePurge(projectId)` → `project.delete` → facts 保留；overview 里该项目 `workState` 在 Work 被删后为 `purged`，`totalCny` 不变 |
| 7 | overview 合并 | facts + 手填 entries + 一条已作废 entry：`totalCny` 精确等于微元之和；作废的不计；归档项目仍在 `totals` 里 |
| 8 | 路由契约 `tests/integration/api/contract/compute-ledger-routes.test.ts` | 成员访问任一 `/api/admin/compute-ledger/*` → 403；`super_admin` → 403；成员 POST 自己的条目成功；成员请求体里塞别人的 `actorUserId` → 被忽略，条目归自己；成员记 15 天前的日期 → 400；金额字段 / `rate` 字段被忽略（服务端重算）；跨工作区的 `ledgerProjectId` → 404；成员作废别人的条目 → 403 / 404 |

### 14.3 命令（逐条跑，贴结果）

```
npx prisma validate
npx prisma generate
npx tsc --noEmit
npx vitest run tests/unit/compute-ledger tests/unit/auth/account-permissions.test.ts tests/unit/frameos tests/unit/css-viewport-units.test.ts
npm run check:api-handler
npm run check:logs
npm run check:log-semantic
npm run check:test-coverage-guards
npm run check:locale-navigation
npm run test:ledger          # 见下；需要 Docker，没有就如实报告「未执行」
```

`package.json` 加（R2 已授权）：`"test:ledger": "cross-env BILLING_TEST_BOOTSTRAP=1 vitest run tests/integration/compute-ledger tests/integration/api/contract/compute-ledger-routes.test.ts"`（照 `test:billing:integration` 的写法）。

注意：这台 Mac 出现过磁盘写满后 `node_modules` 被系统换出的情况，那时 `tsc` 会「静默 exit 0」且几乎没有输出（记忆 `reference_dataless_files`）。如果 `npx tsc --noEmit` 在一两秒内就结束且没有任何输出，先读一下 `node_modules/typescript/lib/tsc.js` 把它读回本地再重跑，别把空输出当成通过。

### 14.4 路由目录与守卫（漏了会让 `check:test-coverage-guards` 失败）

`scripts/guards/test-route-coverage-guard.mjs` 要求 `src/app/api` 下**每个** `route.ts` 都出现在 `tests/contracts/route-catalog.ts` 的 `ROUTE_FILES` 里（多了少了都报错）。本方案新增 14 个，按字母序插入：

```
src/app/api/admin/compute-ledger/entries/route.ts
src/app/api/admin/compute-ledger/import/rollback/route.ts
src/app/api/admin/compute-ledger/import/route.ts
src/app/api/admin/compute-ledger/overview/route.ts
src/app/api/admin/compute-ledger/projects/[id]/route.ts
src/app/api/admin/compute-ledger/projects/route.ts
src/app/api/admin/compute-ledger/report/route.ts
src/app/api/admin/compute-ledger/settings/route.ts
src/app/api/admin/compute-ledger/sync/route.ts
src/app/api/admin/compute-ledger/work-candidates/route.ts
src/app/api/compute-ledger/entries/[id]/route.ts
src/app/api/compute-ledger/entries/route.ts
src/app/api/compute-ledger/me/route.ts
src/app/api/compute-ledger/project-options/route.ts
```

行为矩阵（`route-behavior-matrix.ts`）是从目录自动派生的，这些路由会落到 `infra-routes` 组，对应的测试文件已经存在，不用改。`check:changed-test-impact` 要求改了 `src/app/api/**` 就必须同时有 `tests/integration/api/contract/` 下的测试改动，§14.2 #8 那个新文件刚好满足。**路由按批次落地**：每批只加当批的路由到目录里，别一次性把 14 条都先写进去，否则中间批次的守卫会因为「目录里有、磁盘上没有」报 stale。

## 15 分批实现（每批都能单独上线，R14）

| 批 | 内容 | 验收 |
|---|---|---|
| **P1 平台自动记账 + 管理员算力表** | `schema.prisma` 四个 model + 迁移（只在本地 dev 库执行）；`calc.ts` + `aggregate.ts` + 单测；`sync.ts`（`syncPlatformFacts` / 两遍法 / `upsertFacts` / `ensureLedgerProjects` / `snapshotProjectCostsBeforePurge`）+ `recycle-bin.ts` 一行；`scripts/ledger-backfill.ts` + `package.json`；`GET overview` + `POST sync` 两个路由；`account-management/ledger/page.tsx` + `FosComputeLedgerClient` + `LedgerOverviewTable` + 汇总卡 + 横幅；`TeamManagementTabs` 第三标签；CSS；路由目录；§14.2 #1–#7 | 本地 dev 库造数据后：算力表总额 == 同口径 `SELECT SUM(cost)`；删掉一个作品再刷新，数字不变；`ledger:backfill --dry-run` 与写入后的数字对得上；无 Docker 时 #1–#7 如实标「未执行」 |
| **P2 手填 + 成员 + 项目元数据** | `entries.ts` / `projects.ts` / `settings.ts`；admin 的 `entries` / `projects` / `projects/[id]` / `work-candidates` / `settings` 路由；成员的 `me`（可先只返回条目） / `project-options` / `entries` / `entries/[id]` 路由；`permissions.ts` 一行 + 单测；`RecordEntryDialog`、`LedgerEntriesPanel`、`LedgerSettingsPanel`、`LedgerProjectDrawer`；`compute-ledger/page.tsx` + `FosMyLedgerClient`；`FosShell` 成员入口；§14.2 #8 | 成员能记一笔并在自己的页面看到；管理员在算力表里看到数字增加；成员看不到别人的数据、预算；越权用例全部 403 / 404 |
| **P3 报表与导出** | `GET report`（day / week / tri）+ `LedgerReportTable` + 分段控件的三个标签；`csv.ts` + 全部 CSV 导出；`GET me` 补齐日报形态；「系统建议值」：项目抽屉里，对已关联 Work 的项目只读显示「系统里该作品有 N 个剧集」（从 `NovelPromotionEpisode` 经 `Project → NovelPromotionProject` 数，**先读 `schema.prisma` 确认关系再写**），点「采用」才填入总集数，**绝不自动写库**（D3） | 周 / 三日的口径与附录 A 的 聊斋 数字一致；CSV 注入单测通过；Excel 能直接打开且中文不乱码 |
| **P4 历史导入** | `scripts/ledger-xlsx-to-json.py`；`import` / `import/rollback` 路由；`buildImportPlan` + 单测 + 合成 fixture；设置页「历史导入」折叠区 | 合成 fixture 的 dry-run 数字与单测一致；重复提交同一份 → `alreadyImported` 等于条目数；回滚后再次导入成功；**真实数据的 dry-run 与 commit 等用户选 A / B / C（§16 Q1）** |

每批结束时 agent 的交付说明必须包含：改了哪些文件（与 R2 逐项对照）、§14.3 每条命令的真实输出摘要、哪些没执行及原因。

## 16 需要用户拍板的事 / agent 必须停下来问的事

### 16.1 用户决策（按重要性排序；没有答复前一律按「默认」执行）

| # | 问题 | 默认（无答复时） |
|---|---|---|
| Q1 | **xlsx 是部分导出**（§1.3、§12.1）：能否重新导出完整表（A）？还是接受「导入 136 行 + 期初结转」（B）？还是不导历史（C）？ | 只做到 dry-run，不提交 |
| Q2 | **¥46 / 百万 token** 是哪个模型 / 哪家上游的价？对所有人所有 token 都适用吗？（§1.2，我只做了公式吻合的核对，价格来源没有验证） | 作为可配置汇率，默认 46 |
| Q3 | 线上环境是否真的在跑 `BILLING_MODE=ENFORCE`？不是的话「平台自动」一栏永远是空的（§3.4） | 页面顶部给警告，不阻断 |
| Q4 | **表格里的 token 有多少是在平台里生成产生的？** 如果是，历史导入会和平台自动记账重复（§12.5） | 重叠时 commit 需要勾选确认 |
| Q5 | 平台侧口径用 `UsageCost.cost`（目录定价 × `MARKUP=1.0`）还是要对齐上游真实发票价？（D2） | 用 `UsageCost.cost`，差额用负数校准条目修正 |
| Q6 | 「完成情况 / 总集数 / 已完成集数」的口径：手填，还是以后从系统读？「一集」在平台里到底以什么为准？（D3） | 手填；P3 只给只读的建议值 |
| Q7 | 权限：全表只给管理员看（超管、项目组长都不行）？成员能自助记账、只能看自己的？成员补记限制 14 天？（D4、D5、`MEMBER_BACKDATE_DAYS`） | 按 D4 / D5，14 天 |
| Q8 | 预算超支是只做提醒（黄 ≥ 80%、红 ≥ 100%），还是需要在平台里拦截生成？ | 只提醒，**不拦截**（不碰计费） |
| Q9 | 迁移、回填脚本、部署在哪个环境、什么时候做？agent 只会在**本地 dev 库**跑（R12） | 不部署 |

### 16.2 agent 遇到下面任何一种情况，停下来问，不要自己决定

- 需要修改 R2 之外的任何既有文件（尤其 `src/lib/billing/*`、工作监督的文件、`reconcile.ts`）。
- `prisma migrate diff` 的输出里出现对既有表的 `ALTER` / `DROP`。
- 需要新增任何依赖。
- 需要对非本地 DB（测试机 / 备案机）执行迁移、回填、导入、部署。
- 需要读取或复制 `.env.local`、`api_config.yaml`、`.pem`。
- 无关目录的既有测试失败（先报告，不要顺手修）。
- 真实 xlsx / 真实姓名要进仓库。

## 17 环境备注

- 仓库里的 `AGENTS.md`（10 月 16 日）写着 `45.76.215.9` 与 `118.196.6.130` 已退役、只有 `14.103.65.61` 在用；而 11 月 14 日的记忆和用户的口头说法都把 `45.76.215.9` 当作测试机。两者冲突，**我没有核实哪个是现状**，所以本文不假设任何一台机器可用于验证，所有验证默认在本地 dev 库完成，需要上测试机时再问用户。
- 本方案不依赖任何线上改动：不动容器、不动生产库、不动 `/data`；生产只有 `14.103.65.61`，并且禁止使用 `lanmiao-prod` 别名。

## 附录 A 验收数字（全部由 xlsx 的 136 行重新计算，2026-11-20）

**说明**：导入后的金额是按 `46 / 0.1` 对原始 token 与积分重新计算的，不是照抄表里「当天算力总消耗」，所以与表里的列之和差 ¥0.02（源表逐行四舍五入到分，最大单行残差 ≤ 0.006）。验收一律用下面的「公式复算」列，容差 ±¥0.02 / 项目、±¥0.05 / 总额。

### A.1 总体

| 指标 | 值 |
|---|---|
| 日期范围 | 2026-05-07 ～ 2026-06-22 |
| 行数 | 136（其中 1 行全 0：6-22 大明仙师 马俊，不生成条目） |
| 条目数 | 137（133 条 `api_token` + 4 条 `jimeng_points`） |
| 项目数 / 提交人数 | 31 / 21 |
| 项目 × 周 / 项目 × 三日段 | 67 / 73 |
| 三日段标签种类 | 15 |
| 提交人 × 日（同一人同一天） | 133 组，其中 3 组同一天填了多个项目 |
| 行级金额之和（公式复算） | **¥24,138.16**（表里当天列之和 ¥24,138.18） |
| 设了预算的项目 | 10 个；21 个没设 |
| 表里「项目算力总消耗」31 项之和 | ¥82,643.90（只供方案 B 用，不用于验收行级数字） |
| 方案 B 的期初结转合计（差额 > ¥0.05 的项目） | 约 ¥58,505.7（24 个项目；`冰火龙祭`、`禁忌痴缠`、`六一`、`猫、浴缸和早上八点`、`魔法女皇复仇`、`沙尘暴`、`周杰伦测试` 7 个项目的差额在 ±¥0.05 以内或为负，属于 0.1 元舍入，不写） |

即梦积分的 4 行（也是 `jimeng_points` 仅有的 4 条）：

| 日期 | 项目 | 提交人 | token | 积分 | 当天元 |
|---|---|---|---|---|---|
| 2026-05-07 | 聊斋 | 宋国傲 | 0 | 2,912 | 291.20 |
| 2026-05-11 | 聊斋 | 宋国傲 | 12,799,434 | 583 | 647.07 |
| 2026-05-16 | 样片 | 武晓乐 | 0 | 1,764 | 176.40 |
| 2026-05-19 | 样片 | 武晓乐 | 521,100 | 1,442 | 168.17 |

### A.2 每个项目（按公式复算金额降序）

仅「行数」「公式复算」「预算」「使用率」「等级」用于验收；「表里写的项目累计」只是对照（方案 B 的来源，且看起来只保留 1 位小数）。

| 项目 | 行数 | 公式复算（元） | 表里当天列之和（元） | 表里写的项目累计（元） | 预算（元） | 使用率（按行级） | 等级 |
|---|---|---|---|---|---|---|---|
| 布鲁与魔卡精灵 | 15 | 3106.44 | 3106.45 | 13,715.90 | 40000 | 7.77% | ok |
| 婚介 | 14 | 3075.96 | 3075.97 | 9,946.10 | 10000 | 30.76% | ok |
| 赛博朋克 | 17 | 3005.18 | 3005.21 | 11,065.70 | 18000 | 16.70% | ok |
| 聊斋 | 11 | 2782.87 | 2782.86 | 12,651.90 | 20000 | 13.91% | ok |
| 布鲁萌探队 | 18 | 2437.21 | 2437.19 | 10,895.00 | 36000 | 6.77% | ok |
| 梦里 | 9 | 2192.30 | 2192.29 | 6,718.50 | 15000 | 14.62% | ok |
| 大明仙师：带着老朱揍孙子！ | 10 | 1918.55 | 1918.57 | 8,685.00 | 13000 | 14.76% | ok |
| 绝色嫡女 | 3 | 595.54 | 595.53 | 896.80 | 600 | 99.26% | warn |
| 禁忌痴缠 | 2 | 439.96 | 439.96 | 440.00 | 未设 | — | — |
| 悬疑 | 2 | 421.20 | 421.21 | 520.40 | 未设 | — | — |
| 张博阳组试岗 | 1 | 355.00 | 355.00 | 410.70 | 未设 | — | — |
| 样片 | 2 | 344.57 | 344.57 | 384.50 | 未设 | — | — |
| 天福祝寿 | 3 | 309.18 | 309.17 | 441.00 | 500 | 61.84% | ok |
| 两世嫁衣 | 1 | 293.19 | 293.19 | 498.60 | 未设 | — | — |
| 六一 | 1 | 283.42 | 283.42 | 283.40 | 未设 | — | — |
| 魔法女皇复仇 | 1 | 276.10 | 276.10 | 276.10 | 未设 | — | — |
| 冰火龙祭 | 1 | 275.06 | 275.06 | 275.10 | 未设 | — | — |
| 小虎果果 | 4 | 271.38 | 271.37 | 1,487.00 | 未设 | — | — |
| 动画测试 | 4 | 264.60 | 264.60 | 313.50 | 未设 | — | — |
| 重生少年 | 1 | 263.39 | 263.39 | 661.50 | 400 | 65.85% | ok |
| 猫、浴缸和早上八点 | 1 | 242.19 | 242.19 | 242.20 | 未设 | — | — |
| 周杰伦测试 | 2 | 226.62 | 226.62 | 226.60 | 未设 | — | — |
| 洛客奇缘—寻龙记 | 1 | 206.54 | 206.54 | 332.20 | 未设 | — | — |
| 寡嫂 | 1 | 138.52 | 138.52 | 249.50 | 未设 | — | — |
| 许靖替父出征 | 1 | 104.66 | 104.66 | 265.20 | 未设 | — | — |
| 字字动画测试 | 4 | 100.65 | 100.66 | 335.00 | 未设 | — | — |
| 父亲节 | 1 | 60.11 | 60.11 | 124.60 | 未设 | — | — |
| 麦芽试稿 | 1 | 45.47 | 45.47 | 72.80 | 未设 | — | — |
| 高考 | 2 | 36.89 | 36.89 | 148.70 | 未设 | — | — |
| 50,000 Deal with the Devil | 1 | 36.67 | 36.67 | 51.70 | 未设 | — | — |
| 沙尘暴 | 1 | 28.74 | 28.74 | 28.70 | 未设 | — | — |

提示：`猫、浴缸和早上八点` 在原表里带前导空格，归一化后才是同一个名字；`50,000 Deal with the Devil` 项目名里有逗号，CSV 导出要正确加引号。按「表里写的项目累计」，`绝色嫡女`（896.80 / 600）与 `重生少年`（661.50 / 400）已超支，`婚介`（99.5%）、`天福祝寿`（88.2%）处于预警——方案 B 选中后，这四个项目的等级会与上表不同（§12.1）。

### A.3 `聊斋` 的下钻（用来验证周 / 个人汇总）

| 维度 | 值（公式复算，元） |
|---|---|
| 提交人 | 宋国傲 1,252.13；仇殿华 1,078.68；孙晨曦 452.06（三者之和 2,782.87） |
| 周（周一起算） | 5.4–5.10：936.36；5.11–5.17：1,275.93；5.18–5.24：474.47；5.25–5.31：96.10（四周之和 2,782.86） |
| 三日段 | `2026-05-07 至 2026-05-09`：291.20；`2026-05-10 至 2026-05-12`：1,921.09；`2026-05-16 至 2026-05-18`：474.47；`2026-05-25 至 2026-05-27`：96.10 |

（四舍五入到分后的显示值之间允许有 ¥0.01 的合计差；服务端用微元求和，只在最后一步取整，测试请对微元求和后的结果断言，不要对显示值再加。）

### A.4 逐项验收清单

1. 转换器对该 xlsx 输出 136 行、0 个 `errors`、31 个 `statedProjectTotals`。
2. dry-run（`carryForward: 'none'`）：`summary.rows = 136`、`emptyRows = 1`、`entriesToCreate = 137`、`importedCny = 24138.16 ± 0.05`；`warnings` 包含前导空格项目名 1 条（`猫、浴缸和早上八点`）；`短片,短片`（2 行）、`甲方Demo,甲方Demo`（4 行）去重后只剩一个值，**不**产生警告，但 `category` 必须分别是 `short`、`client_demo`。
3. dry-run（`carryForward: 'stated-total'`）：`carryForwardCny ≈ 58505.7`（24 个项目各写一条，逐项取整到分后相加），其余 7 个项目（见 A.1）不产生结转条目。
4. 提交后：A.2 每个项目的累计等于「公式复算」列（±¥0.02）；`聊斋` 与 A.3 一致；周、三日段的项目数分别为 67、73。
5. 再导入一次同一份文件：`alreadyImported = 137`、`entriesToCreate = 0`。
6. 回滚该批次后：总额回到导入前；再导入一次成功。
7. 21 个提交人中，在本工作区匹配不到账号的，`actors[]` 里逐个列出，且这些条目的 `actorLabel` 保留原名。
8. 平台自动记账与手填合并后，`聊斋` 在项目抽屉 / 展开行里的「个人明细」之和等于该项目累计。

