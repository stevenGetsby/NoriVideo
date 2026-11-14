# LanmiaoTV 体验修复与计费规则调整 · 方案 v2.1 · 2026-11-14

> 用途：交给实现方（kimi3.1）的任务书。本文件只有设计和实现细节；写这份文件时没有改任何代码。
> v2 变更：按用户对 v1 五个待定项的答复重写。v1 的任务 B / C / D / 待定决策已作废，以本文为准；任务 A 原样保留；新增 P0 计费问题（§2 任务 E）。
> v2.1 变更：按用户对计费的补充答复，改写任务 E：
> - 每个成员有两种积分方式：「分配积分」或「无限积分」。两种方式下，成员点的每次生成都记在成员自己的账上。
> - 「无限积分」的成员积分不够时，自动从管理账号转入差额，再从成员账上扣。
> - 现有成员和新成员默认都是「无限积分」。
>
> 改动位置：§1、§2.3、E1-2、E1-4（作废）、§2.5（新增 E2-3 积分方式字段、E2-4 自动补足，原 E2-3～E2-6 顺延为 E2-5～E2-8）、§2.6、§9、§10；新增「全部功能改动一览」「执行规则」，以及 §11 表单、§12 接口、§13 权限、§14 每批完成标准。
> 证据来源：
> - 测试机 `http://nori.45-76-215-9.sslip.io`（2026-11-14 14:12 构建，等同当前工作区），headless Chrome + WebKit 实测；截图和脚本在 git-ignored 的 `test-results/ux-audit/`。
> - 计费部分逐行核对了代码，行号见各条。
>
> 测试机上留下的测试数据（测试管理员名下）：项目「UX审计项目0635」/作品「UX画布0635」、影游「UX影游0635」。其它团队（zhanghongbo、duhongbo）的数据不要动。
> 所有设计决策都已定（§1）。实现方按「执行规则」自主完成开发、测试、测试机部署和验收，不需要再问用户；只有上生产要等用户放行（R6）。E2 不需要约定切换时间：成员默认「无限积分」，上线那一刻没有人会被拦。

## 全部功能改动一览

| 问题 | 改完后用户看到的 | 任务（章节） | 批次（§9） |
|---|---|---|---|
| 1 界面和标题重叠 | 作品工作台头部的标题单行显示，过长时省略，悬停看全名，不再竖排压住下面的内容；影游章节画布的首次提示卡不再被右上角工具挡住；「我的项目」侧栏收起后，标题左侧不再留空白 | A1–A3（§3） | 1b |
| 2 无限画布和影游画布分开 | 两个独立入口，各自只列自己的项目；影游画布 = 无限画布的全部功能 + 剧情层；无限画布里不出现剧情节点和剧情连线；影游章节有自己的地址，旧链接自动跳转；「制作画布」改名「章节画布」；影游里不能直接新建普通作品；章节按顺序排列 | M1（§5）→ B1–B8（§4） | 3 |
| 2 补充：作品封面 | 点作品封面时，用画布方式建的作品进画布，用工作台方式建的进工作台；卡片上的快捷入口显示另一个去处 | F（§7） | 3 |
| 3 工作监督 | 留在每个团队管理员自己的界面：侧栏的「子账号管理」和「工作监督」合并成一个「团队管理」入口，页内两个标签「成员与积分｜工作监督」；权限和统计口径不变 | C（§6） | 1a |
| 计费：个人点击个人付 | 谁点生成就记在谁的账上。每个成员可以设「无限积分」（默认：自己积分不够时，自动从管理账号补足差额）或「分配积分」（只用分配给他的积分）。管理账号可以单个或批量分配、收回积分，能看每个成员的流水和「近90天代付」。成员只看到自己的余额和记录 | E1（§2.4）→ M2 + E2（§2.5） | 1a、2 |
| 4 体验问题 | 面包屑显示「未归属项目」、新建的空影游一打开就报红、影游总览的封面只有一个字母等 9 条 | D1–D9（§8） | 见 §8 各条 |

- 上线顺序见 §9，验收见 §10，表单见 §11，接口见 §12，权限见 §13，每批完成标准见 §14。

---

## 执行规则（实现方照此自主完成，不需要再问用户）

**R1 范围与顺序**
- 只做本文列出的改动，按 §9 的批次顺序做。
- 每批的流程：
  1. 改代码；
  2. 跑本批的测试（§10）；
  3. 部署测试机（R5）；
  4. 按 §10 验收；
  5. 提交，并写部署记录（R7）；
  6. 通知用户可以上生产（R6）。
- 每批的完成标准见 §14。
- 并行关系：
  - 1a、1b、1c 可以并行；
  - 批次 2 在 1a 之后；
  - 批次 3 在 1a 之后，可以和批次 2 并行开发，但两者不要同一天上生产。

**R2 本文和代码对不上时，按下面的顺序自己判断，不要停下来问**
1. 行号对不上：以锚点（函数名、文案、testid）为准。
2. 锚点也找不到，或代码结构已经变了：按这一条要达到的效果，改在最接近的位置。效果就是该条写的「改为」「设计」或验收里描述的现象。
3. 本文前后说法不一致时，按这个优先级：§1 决策 > 本节执行规则 > 各任务正文 > §11 表单 > §10 验收里的例子。
4. 本文没写到的细节，按这个优先级选：
   1. 不改变扣费金额和付款人；
   2. 旧数据照常能读、能打开；
   3. 改动最小；
   4. 沿用相邻代码的写法和文案风格。
5. 每一处偏差都写进本批提交说明的「偏差」段：原文怎么写、实际怎么做、为什么。
6. 和本次无关的已有问题（tsc 基线的 12 行错误、本来就失败的测试）不修，在提交说明里记一句。
7. 同一条验收连续修 3 次仍不通过：
   - 在部署记录里标「未通过」，写清现象和已经试过的办法；
   - 继续做不依赖它的批次；
   - 这一批不上生产。

**R3 工作区里别人的改动**
- 工作区里已有大量未提交的改动（转绘、素材库、画布等），不属于本文。不要 revert、stash 或格式化它们。
- 提交时只暂存本批的改动。如果某个文件里混有别人未提交的改动：
  - 用 `git diff <文件>` 导出补丁，删掉无关的 hunk，再 `git apply --cached` 暂存；
  - 实在拆不开，就整个文件提交，并在「偏差」段列出混进来的改动。
- 测试机部署的是整个工作区，包括别人的未提交改动。这是现状，不用处理。

**R4 测试机和测试账号**
- 测试机 `root@45.76.215.9`，站点 `http://nori.45-76-215-9.sslip.io`。
  - SSH 密码由用户在启动任务时放进环境变量 `SSHPASS`；命令一律用 `sshpass -e ssh …` / `sshpass -e scp …`。
  - 密码不写进任何文件、日志或提交。
- 测试账号是「测试管理员」（admin），以及它名下的「测试组长」「测试成员」。不知道密码就自己重置，不用问：
  1. 在 git-ignored 的 `.runtime/test-server-deploy/` 新建 `reset-test-password.mjs`：
     ```js
     import bcrypt from 'bcryptjs'
     import mysql from 'mysql2/promise'
     const name = process.argv[2]
     const pw = process.env.NEW_PW
     if (!name || !pw || pw.length < 8) throw new Error('用法：NEW_PW=新密码 node reset-test-password.mjs 账号名')
     const conn = await mysql.createConnection(process.env.DATABASE_URL)
     const [result] = await conn.query(
       'UPDATE user SET password = ?, passwordChangeRequired = 0, sessionVersion = sessionVersion + 1 WHERE name = ?',
       [await bcrypt.hash(pw, 12), name],
     )
     console.log('updated', result.affectedRows)
     await conn.end()
     ```
  2. 生成新密码：`NEW_PW=$(openssl rand -base64 18)`，只放在当前 shell 变量里。
  3. 上传到 `/opt/norivideo-test/app/`，然后执行：
     ```bash
     sshpass -e ssh root@45.76.215.9 "cd /opt/norivideo-test/app && NEW_PW='$NEW_PW' /opt/node22/bin/node --env-file=../.env reset-test-password.mjs 测试管理员"
     ```
  4. 每次部署都会清空 `app/`，需要时重新上传这个脚本。
- 只操作测试管理员名下的数据。zhanghongbo、duhongbo 等其它团队的数据不要动。
- headless 登录：
  - 走 NextAuth 接口：先 `GET /api/auth/csrf`，再 `POST /api/auth/callback/credentials`，写法照 `.runtime/staff-activity-e2e.mjs`；
  - 不要填登录表单，它可能在 hydration 之前就提交了。
- 页面有 1.2 倍的 CSS zoom：`getBoundingClientRect` 量出的尺寸要先除以 1.2，再和 32/28/40px 比。

**R5 部署测试机**
```bash
# 1. 从工作区同步一份干净的源码（目标必须是绝对路径，必须带 --delete）
rsync -a --delete --exclude /node_modules --exclude /.next --exclude /test-results --exclude /.git \
  --exclude /.runtime --exclude /data --exclude /tests --exclude '.env*' \
  --exclude '* 2.*' --exclude '* 3.*' --exclude '* 2' --exclude '* 3' ./ /tmp/nori-deploy-src/
# 2. 打包。不加这两个参数，macOS 会混入 AppleDouble 文件，next build 会失败
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf /tmp/source.tar.gz -C /tmp/nori-deploy-src .
# 3. 上传，后台构建（约 7 分钟：清空 app/、npm ci、next build、prisma db push）
sshpass -e scp /tmp/source.tar.gz .runtime/test-server-deploy/remote-build.sh root@45.76.215.9:/opt/norivideo-test/
sshpass -e ssh root@45.76.215.9 'cd /opt/norivideo-test && setsid bash remote-build.sh > build.log 2>&1 < /dev/null &'
# 4. 轮询：出现 build-done 就重启；出现 build-failed 就看 build.log
sshpass -e ssh root@45.76.215.9 'cd /opt/norivideo-test && ls build-done build-failed 2>/dev/null; tail -3 build.log'
sshpass -e ssh root@45.76.215.9 'systemctl restart norivideo-test-web norivideo-test-worker norivideo-test-watchdog norivideo-test-board'
```
- 必须排除 `.next`：本机的 `.next` 是一个软链接，打进包里会让构建报 `ENOENT mkdir app/.next`。
- 不要改 `remote-build.sh`。

**R6 上生产（唯一需要用户的一步）**
- 什么时候问：测试机验收通过、部署记录写好之后，告诉用户「批次 X 已在测试机验收通过，可以上生产」，附上部署记录的路径。用户回复同意后才动生产。
- 一次同意覆盖这一批在生产上的全部操作，期间不用再问：
  - 确认备份；
  - 部署；
  - 本批的 SQL（批次 3 的 M1 回填）；
  - 触发条件满足时按 §2.6 第 6 步回滚。
- 生产机：`ssh -i ~/.ssh/norivideo.pem root@14.103.65.61`。不要用 `lanmiao-prod` 别名，它指向已退役的机器。
- 备份：
  - 部署前只读查看 `/data/backups/mysql/last-success.json`，时间必须是当天；
  - 不是当天，就先执行 `systemctl start norivideo-db-backup.service`，等它成功；
  - `/data` 下的任何文件都不许删除。
- 发布方式：
  - 把最近一次的发布目录 `.runtime/20261112-kuaizi-health-release/` 复制成 `.runtime/<日期>-<批次名>-release/`，按里面的 `prepare.mjs` 和 `deploy.sh prepare|load|switch` 流程走。`deploy.sh load` 的参数顺序是 `<source 指纹> <artifact sha256>`。
  - 打包同样要用 `COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata`。
  - `switch` 耗时较长，SSH 可能断开：用 `setsid` 在后台跑，再轮询完成标记。
  - 改表结构的批次（2、3）：
    - 照 `.runtime/interactive-story-release/` 的做法，把 `prisma/` 和新生成的 `node_modules/.prisma/client` 打进 artifacts，并在 `Artifact.Dockerfile` 里 COPY；
    - `switch` 对 `migrate diff` 的检查改为只允许本批预期的语句：
      - 批次 2：`user` 表加 `pointMode`；
      - 批次 3：`works` 表加 `productLine`，建索引 `works_workspaceOwnerId_productLine_idx`，`projects` 表加 `creationMode`；
    - 出现其它语句（尤其是 `DROP`）就中止发布。
  - 不改表结构的批次（1a、1b、1c）：照最近一次发布，断言 diff 为空。
  - 每次部署完删掉 `/opt/norivideo/build`。

**R7 提交与记录**
- 提交信息照仓库现有风格写（`feat: …` / `fix: …` / `docs: …`），正文写做了什么、为什么；有偏差就加「偏差」段。
- 一批一个提交。批次 2 是两个：先 M2，再 E2。
- 不要提交：`.runtime/`、`test-results/`、任何凭据、文件名以「 2」「 3」结尾的重复文件。
- 部署记录：
  - 每批一个文件 `docs/deployments/beian-<主题>-<日期>.md`，格式照现有的记录；
  - 测试机验收后先写「测试机」一节：部署时间、每条验收的结果（通过 / 未通过 + 原因）、截图路径（放在 `test-results/` 下）；
  - 上生产后在同一个文件里补「生产」一节；
  - 部署记录单独用一个 `docs:` 提交。

**R8 只在这三种时候联系用户**
1. 某一批测试机验收通过，可以上生产（R6）；
2. 生产上线完成，或者按 §2.6 回滚了；
3. 全部批次完成。

---

## 0. 约定

### 0.1 术语

| 界面叫法 | 代码 / 表 | 说明 |
|---|---|---|
| 项目 | `Work` / `works` | 「我的项目」里的一张卡片，下面挂多个作品 |
| 作品 | `Project` / `projects` | 有工作台（workflow）和画布（`Canvas`） |
| 影游 | `Work` + 1:1 `InteractiveStory` | v2 起用 `works.productLine = 'story'` 标记（§5） |
| 章节 | 影游下的 `Project` 和它的 `Canvas` | 只能由 `insertChapter` 创建 |
| 管理账号 | `role = 'admin'` 的 `User` | 团队管理员，即子账号 `workspaceOwnerId` 指向的账号 |
| 子账号 / 成员 | `workspaceOwnerId = 管理账号 id` 的 `User` | |
| 数据归属人（owner） | `session.user.id` | 被 `api-auth.ts:151` 改写过：子账号登录时，这里是管理账号 id |
| 点击者（actor） | `session.user.actorId` | 真正登录并点按钮的人 |
| 积分方式 | `user.pointMode`（E2-3 新增） | 只对子账号有意义：`'unlimited'` 无限积分（默认），或 `'allocated'` 分配积分 |

### 0.2 硬约束

**定位**
- 行号基于 2026-11-14 的工作区。每处同时给了可以 grep 的锚点（函数名或文案）。行号对不上时，以锚点为准。
- 不要修改文件名以「 2」「 3」结尾的文件。它们是 Finder 产生的重复文件，例如 `MaterialPickerDialog 3.tsx`，不参与构建。

**环境与数据**
- 先部署测试机验收。
- 生产环境的部署、执行 SQL、改表结构，只在用户放行后做（R6）。
- 生产机的连接和发布方式见 R6；不要使用 `lanmiao-prod` 这个 ssh 别名，它指向已退役的机器。
- 生产机 `/data` 下的任何文件都不许删除，线上 MySQL 数据目录在那里。
- 测试机只用于测试，只操作测试管理员名下的数据。
- 凭据（密码等）不要写进任何文件、日志或提交。
- 浏览器验证一律 headless：不在用户机器上开可见窗口，也不长时间挂着重型 dev server。

**界面与文案**
- 控件尺寸：
  - 工具栏、标签 32px（`fos-btn`）；
  - 表格行内的密集操作 28px（`fos-btn-sm`）；
  - 弹窗主按钮 40px（`fos-btn-lg`）。
- 文案一律用本文「」里的原文。

**数据与提交**
- 历史数据不迁移：计费历史和旧作品保持原样，靠查询和展示做兼容。
- 每个批次（§9）单独成一个提交。批次 2 拆成 M2、E2 两个提交，E2 必须能单独回滚。

---

## 1. 决策汇总

| # | 议题 | 用户答复（2026-11-14） | 本文落点 |
|---|---|---|---|
| 1 | 工作监督放哪 | 留在每个团队管理员自己的界面 | §6 任务 C：和子账号管理合并成「团队管理」，分两个标签 |
| 2 | 计费（新增） | 个人点击个人付。每个成员可以是「分配积分」，也可以是「无限积分」，但只要是他点的生成，都记在他自己的账上 | §2 任务 E（P0），分 E1 准备、E2 切换两步 |
| 3 | 影游画布与无限画布 | 影游画布是无限画布的升级版，包含无限画布的全部功能 | §4 任务 B：同一个编辑器，用 `mode` 参数区分；影游 = 无限画布全部功能 + 剧情层 |
| 4 | 类型字段 | 可以给项目表加类型字段 | §5 M1：`works.productLine` 和 `projects.creationMode` |
| 5 | 作品封面点击去哪 | 按创建方式分别进画布或工作台 | §7 任务 F |
| 6 | 「无限积分」的成员积分不够时 | 自动从管理账号转入差额，再从成员账上扣；管理账号也不够时才停止生成，不欠账 | E2-4 |
| 7 | 默认积分方式 | 默认「无限积分」：现有成员和新建成员都是 | E2-3（`user.pointMode` 默认值） |

- 字段名用 `productLine`，不用 v1 写的 `kind`。原因：前端作品列表的 DTO 已经有 `kind: 'project' | 'work'`（见 `src/components/frameos/works/types.ts:175` 和 `:258` 的 `source.kind`），再叫 `kind` 会混。
- v1 的「D2 影游里允许哪些媒体节点」随决策 3 作废：影游画布允许无限画布的全部节点。
- v1 的「任务 C 移到平台后台」随决策 1 作废。

---

## 2. 任务 E · 谁点生成谁付费（P0）

### 2.1 现象（用户提供）
- 员工账号（冯东彬 / 马俊 / 孙晨曦等 26 人）在各自的作品里点生成。
- 积分实际扣在管理账号 caoshuang 名下，90 天减少 15,319 积分。
- 员工自己账号的消耗记录全是 0。

### 2.2 根因（已核对代码）

1. **身份被改写**（`src/lib/api-auth.ts:146-152`，在 `validateSessionUser` 内）：
   - 146：真实登录者放进 `session.user.actorId`；
   - 151：`session.user.id = session.user.workspaceOwnerId`；
   - 152：`setAccountActorContext(user.id, …)` 把点击者写进请求级 AsyncLocalStorage（ALS）。

   结果：所有走 `requireAuth` / `requireUserAuth` 的接口，拿到的 `session.user.id` 都是管理账号。

2. **扣款只看传入的 userId**：
   - 同步计费：`src/lib/billing/service.ts:514` `freezeBalance(params.userId, …)`；
   - 异步任务：`service.ts:1022` `freezeBalance(task.userId, …)`；
   - `toolbox/generate`（`src/app/api/frameos/toolbox/generate/route.ts:562/933/1247` 调 `submitTask`）和流式文本（`service.ts:847` 的 `prepareStreamingTextBilling` 调 `prepareTaskBilling`）都汇到上面两处。

   传进来的 userId 都是管理账号。

3. **点击者处处可得，但只用于每日额度和归属统计**：
   - 请求内：`getGenerationQuotaUserId(walletUserId)`（`src/lib/account/request-context.ts:35-38`）从 ALS 取点击者。
   - 任务内：`src/lib/task/submitter.ts:142` 用 `buildTrustedTaskQuotaMeta`（request-context.ts:41-47）把点击者写进 `payload.meta.quotaUserId`。它会先删掉浏览器传来的值，再写服务端的值。
   - worker 内：`withTaskQuotaContext`（request-context.ts:50-58）恢复点击者，调用方是 `src/lib/workers/shared.ts:363` 的 `withTaskLifecycle`。
   - 现在的用途只有三处：
     - 每日额度：`src/lib/billing/daily-limit.ts:236`；
     - 冻结元数据：`src/lib/billing/ledger.ts:141-144`；
     - 扣款流水：`ledger.ts:298-303` 经 `src/lib/billing/reporting.ts:85` 写进 `billingMeta.quotaUserId`。

4. **共享钱包是刻意设计，和业务规则相反**：
   - `src/lib/account/billing-identity.ts:11-21` 规定子账号的钱包 = 管理账号；
   - `src/app/api/admin/accounts/[userId]/credits/route.ts:165-168` 直接拒绝「分配」；
   - `daily-limit.ts:173-175` 的注释写着 “Never change which account is debited”；
   - 界面文案是「共享积分」「共享可用积分」「历史个人积分」。

   反倒是 `docs/account-management.md:47-48` 写的是“每个账号独立保存积分”“右上角只显示实际登录账号的数值”。

5. **员工显示 0**：成员统计按行的 `userId` 分组或过滤，涉及：
   - `src/lib/platform-services/model-type-usage.ts:134-143`；
   - `src/app/api/admin/accounts/route.ts:143-144`；
   - `src/lib/workspace/service-records.ts:255-271`。

   而这些扣款行的 `userId` 是管理账号，点击者只记在 `quotaUserId` 里。

**另外发现（D9，P1）**：子账号查看自己的消费记录和流水时，接口按 `session.user.id`（= 管理账号）查询，例如 `src/app/api/user/transactions/route.ts:52`。所以子账号能看到整个团队的流水，还能从 `balanceAfter` 看到管理账号的余额。E1-3 一并修复。

### 2.3 原则

- **不改 `session.user.id` 的含义**：它代表数据归属（作品、素材都挂在管理账号下）。项目隔离（`api-auth.ts:154-159`）和大量数据查询都依赖它。
- **只在计费咽喉点解析付款人**：付款人 = 点击者（来自请求 ALS 或任务 payload 里的 `quotaUserId`）。取不到点击者时，退回数据归属人。
- **自定义价格不改**：`loadUserCustomPricing`（service.ts:592/688/719/745/979/1087）继续按管理账号读。
- **历史扣款不迁移**：切换前的成员生成仍记在管理账号流水里，展示时标「管理账号代付」。
- **每个成员两种积分方式**（用户 2026-11-14 决定）。两种方式下，成员点的每次生成（冻结、扣款、消费记录）都记在成员自己的账上：
  - **无限积分**（默认）：成员自己的积分不够这次冻结时，在同一个数据库事务里从管理账号转入差额，然后照常冻结、扣款。管理账号流水记「自动分配给子账号」，成员流水记「管理账号自动分配」。管理账号也不够时才拦截，不欠账。
  - **分配积分**：只用分配给他的积分，不够就拦截。
  - 管理账号自己点生成：照旧扣自己。积分方式只对子账号有意义。
- **默认无限积分**：现有成员（加字段时的默认值）和新建成员都是「无限积分」。E2 上线那一刻没有人会被拦，所以不需要约定切换时间，也不需要上线前先给成员分配积分。
- **仍分两步上线**：
  - E1 先做分配、批量分配，以及按点击者查看记录。E2 上线后成员要能看到自己的消费记录，这要靠 E1-3。
  - E2 分两个提交：先 M2（只加 `pointMode` 字段，E2-3），再 E2 的其余改动。出问题时只 revert 后一个，M2 保留（§2.6 第 6 步）。
- **「切换」指 E2 部署到生产的那一刻**。下文的「切换前 / 切换后」都以它为界；不需要另外约定时间。

### 2.4 E1 · 切换前准备（不改变扣谁的钱）

#### E1-1 恢复单个「分配」

**接口** `src/app/api/admin/accounts/[userId]/credits/route.ts`

165-168 行的 allocate 分支现在直接 `throw new ApiError('INVALID_PARAMS', …)`。改成和 169 行 reclaim 对称的调用：

```ts
return operation === 'allocate'
  ? allocateAccountPoints(operatorId, target.id, points, { operatorId, idempotencyKey, note })
  : reclaimAccountPoints(operatorId, target.id, points, { operatorId, idempotencyKey, note })
```

- `allocateAccountPoints` 已经存在（`src/lib/billing/credit-ledger.ts:347`）。
- 权限判断（158-164）和错误码映射（199-204）不动。

**界面** `src/components/frameos/FosAccountManagementClient.tsx`
- 行内操作（368-375）：在「流水」后面加「分配」，`className="fos-btn fos-btn-ghost fos-btn-sm"`，`onClick={() => openCreditOperation('allocate', account)}`。弹窗配置已经有了（`FosAccountManagementParts.tsx:339-341`）。
- 去掉「历史」字样：

  | 位置 | 原文 | 改为 |
  |---|---|---|
  | 250 | 「收回历史积分失败」 | 「收回积分失败」 |
  | 339 表头 | 「历史个人积分」 | 「个人积分」 |
  | 371「收回」的 title | 「将历史个人积分收回共享钱包」 | 「把该成员的积分收回到管理账号」 |
  | `FosAccountManagementParts.tsx` 345-347（收回弹窗标题/说明）、519（弹窗提示） | 含「历史」 | 删掉「历史」，说法统一为“收回到管理账号” |

- 333 行说明改为：「目前成员生成仍从管理账号扣积分；分配给成员的积分会在切换为“谁点生成谁扣积分”后开始使用。」

**删除拦截文案** `src/app/api/admin/accounts/[userId]/route.ts:236`（余额或冻结 > 0 时拒绝删除），改为：「该成员还有 X 积分（冻结 Y 积分），请先收回再删除。」

#### E1-2 批量分配

**新接口** `src/app/api/admin/accounts/bulk-credits/route.ts`，`POST`
- 请求体：
  ```ts
  {
    points: number          // 正整数
    userIds: string[]       // 去重后 1–100 个
    note?: string           // ≤200 字
    idempotencyKey: string  // ≤64 字符
  }
  ```
  不合法返回 400 `INVALID_PARAMS`。
- 权限：
  - `requireUserAuth()`；`operatorId` / `operatorRole` 的取法照抄 `credits/route.ts` POST 的前半段。
  - 调用者必须是管理账号。
  - 每个 userId 都必须满足 `isSubaccountRole` 且 `isDirectSubaccountOf(target, operatorId)`（同 158-164）。只要有一个不满足，整个请求 403，一个都不分配。
- 返回：`{ allocated: Array<{ userId: string; points: number; idempotent: boolean }>, operatorBalancePoints: number }`。
- 日志：`[AccountCredits] 批量分配完成`，带 operatorId、人数、每人积分、idempotencyKey。

**账本** `src/lib/billing/credit-ledger.ts`
- 抽出 `transferPointsInTx(tx, params)`：把 `transferPoints`（201-336）在事务内执行的部分搬进去，包括：
  - 扣源账号的 `updateMany … balance gte`；
  - upsert 目标账号；
  - `createMany` 两条流水。

  `transferPoints` 外层的回放、Serializable 事务、P2034 重试、P2002 回放都不变，改为调用 `transferPointsInTx`。
- `transferPointsInTx` 的入参写成：
  ```ts
  {
    operation: 'allocate' | 'reclaim' | 'auto_allocate'  // 两条流水的 type 分别是 `${operation}_out` 和 `${operation}_in`
    sourceUserId: string
    targetUserId: string
    points: number
    amountCny: number
    operatorId: string
    idempotencyKey: string | null
    note?: string | null
    freezeId?: string | null  // 写进两条流水的 freezeId 列
  }
  ```
  - `'auto_allocate'` 是给 E2-4 的自动补足预留的，E1 只用前两种；`CreditOperation` 类型和 `auditDescription` 同步加上 `'auto_allocate'`，并把 `transferPointsInTx` 导出。
  - 余额不够时，照旧抛 `CreditLedgerError('INSUFFICIENT_POINTS', …)`。这一步用的是带条件的 `updateMany`，没扣成时没有写入任何东西，所以调用方在事务里接住这个错误后，事务仍然可以继续用。
- **锁顺序（E2-4 依赖这一条）**：`transferPoints` 和下面的 `allocateAccountPointsBulk` 在事务里的第一句先锁住涉及的 `user` 行：
  ```ts
  await tx.$queryRaw(Prisma.sql`SELECT id FROM user WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`)
  ```
  - `ids` = 源账号 + 所有目标账号，去重后按字符串排序。
  - `transferPointsInTx` 自己不加锁，由调用方负责。
  - 原因：E2-4 的冻结事务会按同样的顺序锁「成员 + 管理账号」这两行，然后才动余额。所有会扣余额的路径都先按 id 顺序锁 `user` 行，就不会互相死锁。扣余额的路径一共只有三处：`freezeBalance`、`increasePendingFreezeAmount`、`transferPoints`；确认扣款和回滚只会增加余额，不用锁。
- 新增 `allocateAccountPointsBulk({ operatorId, targetUserIds, points, idempotencyKey, note })`：
  - 每个目标的幂等键是 `${idempotencyKey}:${userId}`，最长 101 字符，在流水表 `idempotencyKey` 的 VarChar(128) 以内。
  - 先查哪些键已经入账（查法照 `transferPoints` 开头的回放逻辑）。这些目标标 `idempotent: true`，不再扣。
  - 剩下的目标放在**一个** Serializable 事务里，逐个调用 `transferPointsInTx`：
    - 事务超时 30_000ms；
    - P2034 重试 2 次，和 `transferPoints` 一致；
    - 任何一个失败，整笔回滚。
  - 事务开始时先读管理账号余额。不够 `points × 待分配人数` 时直接抛余额不足，文案「可用积分不足：需要 X 积分，当前可用 Y 积分。」，错误码沿用单个分配的映射。

**界面**（`FosAccountManagementClient.tsx` + `FosAccountManagementParts.tsx`）
- 成员表加勾选列；表头全选只选状态正常的子账号。
- 工具栏加「批量分配（N）」，32px `fos-btn`，N = 0 时禁用。
- 新增 `BulkAllocateDialog`：
  - 输入「每人分配积分」（正整数）。
  - 列出所选成员的「当前积分」「近90天代付」（数据来自 E1-3）。
  - 显示「合计」（= 每人 × N）、「当前可用」、「分配后剩余」。剩余为负时标红，并禁用主按钮。
  - 主按钮「确认分配」，`fos-btn-lg`。
  - `idempotencyKey` 在弹窗打开时用 `crypto.randomUUID()` 生成一次；重复点击、失败重试都用同一个键。
  - 成功后刷新列表并关闭；余额不足时，在弹窗里显示接口返回的文案。

#### E1-3 记录按点击者可见（同时修复 D9）

**新建** `src/lib/billing/actor-scope.ts`：

```ts
export type RecordScope =
  | { kind: 'team'; ownerId: string; accountIds: string[] }
  | { kind: 'self'; ownerId: string; actorId: string }

export async function resolveRecordScope(user: { id: string; actorId?: string | null }): Promise<RecordScope>
export function usageCostWhere(scope: RecordScope): Prisma.UsageCostWhereInput
export function transactionWhere(scope: RecordScope): Prisma.BalanceTransactionWhereInput
export function taskWhere(scope: RecordScope): Prisma.TaskWhereInput
export function isManagerPaid(row: { userId: string }, scope: RecordScope): boolean
```

**`resolveRecordScope` 的判断**
- `ownerId = user.id`，`actorId = user.actorId ?? user.id`。
- 两者相等 → `team`：管理账号看本人 + 全部子账号。
  - `accountIds` 取自 `prisma.user.findMany({ where: { OR: [{ id: ownerId }, { workspaceOwnerId: ownerId }] }, select: { id: true } })`。
  - **不加状态过滤**：停用成员的历史也算进团队。
- 不相等 → `self`：子账号只看自己点的。

**过滤条件**
- 令 `TAG = '"quotaUserId":"' + actorId + '"'`。
- `billingMeta` 和 `usageCost.metadata` 都是 `JSON.stringify` 写的，键值之间没有空格，所以可以按字符串匹配。
- `actorId` 来自服务端 session，不是用户输入。

| 构造器 | team | self |
|---|---|---|
| `usageCostWhere` | `{ userId: { in: accountIds } }` | `{ OR: [{ userId: actorId }, { userId: ownerId, metadata: { contains: TAG } }] }` |
| `transactionWhere` | `{ userId: ownerId }` | `{ OR: [{ userId: actorId }, { userId: ownerId, type: 'consume', billingMeta: { contains: TAG } }] }` |
| `taskWhere` | `{ userId: ownerId }` | `{ userId: ownerId, payload: { path: '$.meta.quotaUserId', equals: actorId } }` |

- 早于 `quotaUserId` 功能的老任务没有这个字段，成员看不到。可以接受。
- self 范围里 `userId === ownerId` 的行就是切换前的代付。返回时：
  - 加 `paidBy: 'manager'`；
  - `balanceAfter` 置为 `null`，不向成员暴露管理账号余额；
  - 前端在这些行显示标签「管理账号代付」。

**接入点**

1. `src/lib/workspace/service-records.ts`：
   - `readTaskRows`（123-141）用 `taskWhere`；
   - `readUsageCosts`（143-149）用 `usageCostWhere`；
   - `buildTransactions`（635-687）用 `transactionWhere`；
   - `buildFilterableReport`（218 起）在 self 时：
     - accounts 只有点击者本人；
     - `serviceUsageRecord` 按 `userId = actorId` 查（`src/lib/platform-services/usage.ts:47-48` 写入的本来就是点击者）；
     - 作品筛选项只取本人记录里出现过的作品；
     - 作品名仍按 ownerId 查。
   - `buildServiceRecordsOverview`（710-727）：
     - 余额用 `getBalance(resolveBillingPrincipals(session.user).walletUserId)`。E1 时是共享钱包，E2 改完 billing-identity 后自动变成本人。
     - self 时「累计消耗」改为 `transactionWhere` 范围内 consume 的合计，不再调用 `getVisibleUserTotalSpent(ownerId)`。
2. `src/app/api/user/transactions/route.ts:52`：
   - `where = { AND: [transactionWhere(scope), 原有的 type / 日期过滤] }`；
   - 返回行按上面的规则加 `paidBy`、处理 `balanceAfter`。
3. `src/app/api/user/costs/route.ts:15-62`：
   - `getUserCostSummary`（`src/lib/billing/reporting.ts:216`）改为接收 `where: Prisma.UsageCostWhereInput`，路由传 `usageCostWhere(scope)`；
   - 作品名查询继续按 ownerId；
   - 隐藏作品过滤（`findHiddenProjectIds`）不变。
4. 管理账号查看某个成员的流水（`credits/route.ts` 的 GET，52 行起；80-83 行现在是 `findMany({ where: { userId: target.id }, take: 50 })`）：
   - 目标是子账号（`target.workspaceOwnerId` 不为空）时，改为 `transactionWhere({ kind: 'self', ownerId: target.workspaceOwnerId, actorId: target.id })`，仍 `take: 50`，代付行同样加标签。`managedAccountSelect` 里没有 `workspaceOwnerId` 就补上；
   - 目标不是子账号时（管理账号看自己，或平台管理员看某个管理账号），保持原来的 `{ userId: target.id }`，不加代付标签。否则 ownerId 和 actorId 相同，每一行都会被当成代付。
5. `buildModelUsageByAccount`（`model-type-usage.ts:134-143`）：分组键改为「`metadata.quotaUserId` 在团队账号集合里就用它，否则用 `row.userId`」。这样 `/api/admin/accounts`（route.ts:143-144、162）就能按成员显示用量。
6. `/api/admin/accounts`：
   - 每个子账号加字段 `managerPaid90dPoints`（近 90 天由管理账号代付的积分）。
   - 用一次 `$queryRaw`（参数化）按 quotaUserId 分组算出：写法同 §2.7 第一条，带 `JSON_VALID` 保护，限定 `bt.userId = 管理账号id`。
   - 成员表加一列「近90天代付」。

管理账号自己的视图仍然是全团队，不变。

#### E1-4 切换预告横幅（v2.1 作废，不要做）
- 成员默认「无限积分」后，E2 上线时不需要管理账号提前分配积分，预告横幅没有用处了。
- 规则说明放在团队管理页成员列表上方的说明文字里（E1-1 的 333 行，E2-6 再改一次）。

#### E1-5 测试
- `tests/unit/frameos/account-management-platform.test.ts`：
  - 133/167/224 附近对共享钱包文案的断言，按新文案改；
  - 加「分配」按钮和批量分配入口的断言。
- `grep -rn "allocate" tests/`：把“分配被拒绝”的断言改成分配成功。
- 新建 `tests/unit/billing/actor-scope.test.ts`：三个 where 构造器在 team / self 下的结果，以及 `isManagerPaid`。
- `tests/unit/workspace/filterable-service-report.test.ts`：补 self 范围用例。成员只看到本人行和代付行，代付行的 `balanceAfter` 为 null。
- 批量分配补以下用例：
  - 余额不足时整笔不扣；
  - 混入非直属子账号时整笔 403；
  - 同一个 idempotencyKey 重放返回 `idempotent: true`，且不重复扣；
  - userIds 里的重复项会被去重。
- 锁顺序（E2-4 依赖）：单个分配、收回、批量分配的事务里，第一句是按 id 排序的 `user` 行锁。用例断言执行的 SQL 含 `FOR UPDATE`，且 id 是有序的。

### 2.5 E2 · 切换为谁点谁付

#### E2-1 改名
- `getGenerationQuotaUserId` → `resolveGenerationPayerId`，语义不变：ALS 里的 `workspaceOwnerId` 等于传入的钱包 id 且有 `actorId` 时，返回 `actorId`；否则返回传入值。
- 需要改的位置：
  - 定义：`request-context.ts:35`；
  - 调用：`request-context.ts:44`、`ledger.ts:10/141`、`service.ts:39/411`、`daily-limit.ts:7/236`。
- 没有 ALS store 时（`accountPermissionStorage.getStore()` 为空），用 `@/lib/logging/core` 的 warn 级日志打一条 `[Billing] payer resolved without actor context`，带 walletUserId。用于上线后监控有没有绕过 apiHandler 的计费路径。
- 持久化的字段名 `quotaUserId` 不改：历史数据、报表、SQL 都在用。

#### E2-2 计费咽喉点（下表是全部要改的地方）

| 位置 | 现在 | 改为 |
|---|---|---|
| `generation-gate.ts:13` `getBalance(userId)` | 查管理账号余额 | 先 `const payerId = resolveGenerationPayerId(userId)`，再 `getSpendableBalance(payerId)`（E2-4）。用 `spendableCny` 判断 `canStartGeneration`；17 行文案按积分方式分三种（E2-6） |
| `generation-gate.ts:25` `assertDailyLimit(userId)` | — | 不改，`daily-limit.ts:236` 内部已经按点击者算 |
| `service.ts:411` 同步计费幂等键 | — | 只改函数名（键里已同时包含 owner 和 actor） |
| `service.ts:428` `requireGenerationCredit(params.userId)` | — | 不改，闸门内部解析付款人 |
| `service.ts:465` `recordShadowUsage(params.userId, …)` | 影子记账记在管理账号 | 在 `withSyncBillingCore`（420）开头 `const payerId = resolveGenerationPayerId(params.userId)`，这里传 `payerId` |
| `service.ts:514` `freezeBalance(params.userId, …)` | 冻结管理账号 | `freezeBalance(payerId, …)` |
| `service.ts:535` `getBalance(params.userId)` | — | `getBalance(payerId)` |
| `service.ts:543` 和 `:1181` 的 `ensureFreezeCoverage({ freezeId, userId, … })` | — | 去掉 `userId` 参数。函数内部（232-256）在 `rollbackFreeze` 之前按 `freezeId` 读出冻结记录的 `userId`，254 行查这个账号的余额 |
| `service.ts:1022` `freezeBalance(task.userId, …)`（`prepareTaskBilling`） | — | `const payerId = resolveGenerationPayerId(task.userId)`，冻结 `payerId` |
| `service.ts:1040` `getBalance(task.userId)` | — | `getBalance(payerId)` |
| `service.ts:1136` `recordShadowUsage(task.userId, …)`（`settleTaskBilling`） | — | `recordShadowUsage(resolveGenerationPayerId(task.userId), …)`；worker 内由 `withTaskQuotaContext` 提供点击者 |

**不改的地方及原因**
- `freezeBalance`（`ledger.ts`）里 quotaUserId 的逻辑不改；E2-4 只在其中加自动补足。传入付款人后，141 行解析出的 quotaUserId 就等于付款人，144 行不再写 `quotaUserId`。所以**切换后的扣款行不带 quotaUserId**，每日额度和工作监督不会重复计数。
- 确认扣款和回滚都按冻结记录的 `userId` 走，切换前已冻结的在途任务照常结算到管理账号。
- `submitter.ts`（142/195/266）不改。
- `prepareStreamingTextBilling`（847）调的是 `prepareTaskBilling`，随 1022 一起生效。`toolbox/generate` 走 `submitTask`，同样生效。
- `loadUserCustomPricing` 继续按管理账号读。
- 付款人可信的依据：
  - `payload.meta.quotaUserId` 只由 `submitter.ts:142` 的 `buildTrustedTaskQuotaMeta` 写入，它会先删掉浏览器传来的值；
  - 任务只由 `createTask`（`src/lib/task/service.ts:204`）创建，而它只被 `submitter.ts:174` 调用。

#### E2-3 积分方式字段（M2）

**表结构**（M2 是单独一个提交，只包含下面两个文件，排在 E2 其余改动之前）
- `prisma/schema.prisma` 的 `model User`，在 830 行 `dailyPointLimit Int?` 下面加：
  ```prisma
  /// 子账号积分方式：unlimited 不足时自动从管理账号补足；allocated 只用分配的积分。
  pointMode                     String                    @default("unlimited") @db.VarChar(16)
  ```
- 迁移文件 `prisma/migrations/20261114130000_add_user_point_mode/migration.sql`：
  ```sql
  ALTER TABLE `user` ADD COLUMN `pointMode` VARCHAR(16) NOT NULL DEFAULT 'unlimited';
  ```
  - 现有账号靠默认值全部成为「无限积分」，不需要回填（决策 7）。管理账号也会带上这个值，但不起作用。
  - 测试机和生产的发布脚本都会在构建后跑 `prisma db push --skip-generate`（`.runtime/test-server-deploy/remote-build.sh:18`，生产见各 release 目录的 `deploy.sh`），新列随部署加上。生产部署按 R6 和 §2.6。

**纯函数** 新建 `src/lib/billing/point-mode.ts`。不要 import prisma，前端也会引用：
```ts
export type PointMode = 'unlimited' | 'allocated'
export const DEFAULT_POINT_MODE: PointMode = 'unlimited'
// 读库里的值：只有 'allocated' 算分配积分，null 和未知值一律按无限积分
export function normalizePointMode(value: unknown): PointMode {
  return value === 'allocated' ? 'allocated' : 'unlimited'
}
// 读请求体：不合法返回 null，由调用方报 400
export function parsePointMode(value: unknown): PointMode | null {
  return value === 'unlimited' || value === 'allocated' ? value : null
}
```

**账号接口**
- `src/lib/account/management.ts`：
  - `managedAccountSelect`（11-27）加 `pointMode: true`；
  - `serializeManagedAccount`（33-58）加 `pointMode: isManagementRole(role) ? null : normalizePointMode(account.pointMode)`。
- 新建账号 `src/app/api/admin/accounts/route.ts`：
  - 250 行 `readDailyPointLimit` 之后加：
    ```ts
    const pointMode = body.pointMode === undefined ? DEFAULT_POINT_MODE : parsePointMode(body.pointMode)
    if (!pointMode) throw new ApiError('INVALID_PARAMS', { message: '无效的积分方式。' })
    ```
  - 261-275 的 `tx.user.create` 的 data 加 `...(accountType === 'subaccount' ? { pointMode } : {})`。管理账号不写，用默认值。
  - 289-298 的日志加 `pointMode`。
- 编辑账号 `src/app/api/admin/accounts/[userId]/route.ts`（PATCH）：
  - 117 行后加：
    ```ts
    const pointModeProvided = body.pointMode !== undefined
    const pointMode = pointModeProvided ? parsePointMode(body.pointMode) : undefined
    ```
  - 120-122 的项目组长检查之后加两条，都是 400 `INVALID_PARAMS`：
    - `pointModeProvided && isManagementAccount` →「积分方式仅适用于子账号。」；
    - `pointModeProvided && !pointMode` →「无效的积分方式。」。
  - 127-135 的“没有可更新的账号字段”判断加 `&& !pointModeProvided`。
  - 141-147 的 update data 加 `...(pointModeProvided ? { pointMode } : {})`。
  - 152-163 的日志加 `changedPointMode: pointModeProvided` 和 `pointMode`。
  - 改积分方式立即生效：下一次冻结在事务的锁里读到新值（E2-4）。已经冻结的不受影响。

**界面**
- `src/components/frameos/FosAccountManagementParts.tsx`：
  - `AccountDialog` 的 `AccountDraft`（61-72）加 `pointMode?: PointMode`。设为可选是因为平台后台 `PlatformAdminAccountsClient.tsx` 也用这个弹窗，它的草稿没有这个字段，弹窗就不显示这一项。
  - 278 行「每日用量模式」那个 `<div className="mt-5 block">` 前面插入一块，条件 `draft.accountType === 'subaccount' && draft.pointMode !== undefined`：
    ```tsx
    const POINT_MODE_OPTIONS = [
      { value: 'unlimited', title: '无限积分', desc: '自己的积分不够时，自动从管理账号补足差额' },
      { value: 'allocated', title: '分配积分', desc: '只用分配给他的积分，用完即停止生成' },
    ] as const

    <div className="mt-5 block">
      <span id="account-point-mode-label" className="mb-2 block text-[11px] font-semibold text-white/60">积分方式</span>
      <div role="radiogroup" aria-labelledby="account-point-mode-label" className="grid grid-cols-2 gap-2">
        {POINT_MODE_OPTIONS.map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={draft.pointMode === option.value}
            data-testid={`account-point-mode-${option.value}`}
            onClick={() => onDraft({ ...draft, pointMode: option.value })}
            className={`rounded-[10px] border p-3 text-left ${draft.pointMode === option.value ? 'border-violet-400/35 bg-violet-400/[.09]' : 'border-white/[.07] bg-white/[.025]'}`}>
            <span className="block text-[12px] font-semibold">{option.title}</span>
            <span className="mt-1 block text-[10px] leading-4 text-white/45">{option.desc}</span>
          </button>
        ))}
      </div>
      <span className="mt-1.5 block text-[10px] leading-4 text-white/35">两种方式下，成员的每次生成都记在成员自己的账上。</span>
      {showZeroPointWarning ? (
        <span role="alert" className="mt-1.5 block text-[10px] leading-4 text-amber-200">该成员当前积分为 0，改为“分配积分”后将无法生成，请保存后给他分配积分。</span>
      ) : null}
    </div>
    ```
    - 卡片样式和同一弹窗里「账号类型」的选择卡片一致（`FosAccountManagementParts.tsx:194`）。那组卡片不是 `role="radio"` 的写法，不用改它；这里按上面的 ARIA 写。
    - 左右方向键在两张卡片间切换（`onKeyDown`），和原生单选一致。
    - `showZeroPointWarning`：只在编辑时出现。`AccountDialog` 新增两个可选 prop `initialPointMode?: PointMode` 和 `currentPoints?: number | null`，`FosAccountManagementClient` 打开编辑时传入被编辑账号的 `pointMode ?? 'unlimited'` 和 `credits?.points ?? null`。条件为 `initialPointMode === 'unlimited' && draft.pointMode === 'allocated' && (currentPoints ?? 0) <= 0`。这只是提醒，不拦保存。
  - 309 行的新建提示：建子账号（`draft.accountType === 'subaccount'`）时改为「新账号积分默认为 0，积分方式默认“无限积分”。之后可以随时分配或收回积分，所有变动都会记录到账本。」；建管理账号时保持原文。
- `src/components/frameos/FosAccountManagementClient.tsx`：
  - `ManagedAccount`（34-51）加 `pointMode: PointMode | null`；
  - `AccountDraft`（59-69）加 `pointMode: PointMode`（这里是必填）；
  - `NEW_ACCOUNT_DRAFT`（71-81）加 `pointMode: 'unlimited'`；
  - `openEdit` 的 `setDraft`（170-180）加 `pointMode: account.pointMode ?? 'unlimited'`；
  - `submit` 的请求体（195-201）加 `pointMode: draft.pointMode`；
  - 成员行 357 行 `<Credits credits={account.credits} />`：和一个标签一起包进 `<span className="flex flex-col gap-1">`，标签放在积分下面：
    - `pointMode === 'allocated'`：「分配积分」，`border-white/15 bg-white/[.04] text-white/60`；
    - 其它：「无限积分」，`border-emerald-400/25 bg-emerald-400/[.08] text-emerald-200`；
    - 公共样式照 352 行的身份标签：`w-fit rounded-full border px-2 py-1 text-[10px] font-semibold`。
- `PlatformAdminAccountsClient.tsx` 不改。
- 前端一律 `import type { PointMode } from '@/lib/billing/point-mode'`。

#### E2-4 无限积分：不够时自动从管理账号补足

**规则**
- 只有付款人是子账号、且积分方式是「无限积分」时，才有补足来源，就是他的 `workspaceOwnerId`。
- 冻结或补冻时，付款人自己的余额够，就直接冻结，不碰管理账号。
- 不够时，在**同一个数据库事务**里：
  1. 从管理账号转入差额（= 本次要冻结的数 − 成员当前余额）；
  2. 再从成员账上冻结。

  管理账号也不够差额时，什么都不写，按余额不足拦截。
- 补足只在冻结和补冻时发生。确认扣款和回滚仍按冻结记录走：
  - 实际花费少于冻结额时，多出的部分退回成员余额；
  - 生成失败回滚时，冻结额退回成员余额；
  - 这些零头留在成员名下，下次生成先用；管理账号可以随时「收回」。
- 管理账号自己点生成：不是子账号，没有补足来源，照旧扣自己。
- 补足流水的字段：
  - `operatorId` 写成员 id（是成员的点击触发的）；
  - `idempotencyKey` 为 null：一次冻结只补一次，冻结记录本身有幂等键；
  - `freezeId` 写本次冻结的 id，方便对账。

**代码**（全部在 `src/lib/billing/ledger.ts`）

新增两个导出：

```ts
export type FundingSource = {
  isMember: boolean
  pointMode: PointMode | null   // 不是子账号时为 null
  ownerUserId: string | null    // 子账号的管理账号；不是子账号时为 null
}

export async function resolveFundingSource(userId: string): Promise<FundingSource> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, workspaceOwnerId: true, pointMode: true },
  })
  if (!user || isManagementRole(normalizeAccountRole(user.role)) || !user.workspaceOwnerId || user.workspaceOwnerId === userId) {
    return { isMember: false, pointMode: null, ownerUserId: null }
  }
  return { isMember: true, pointMode: normalizePointMode(user.pointMode), ownerUserId: user.workspaceOwnerId }
}

// 闸门和余额接口用：无限积分的成员可用 = 自己 + 管理账号（管理账号为负按 0 算）
export async function getSpendableBalance(userId: string) {
  const [own, funding] = await Promise.all([getBalance(userId), resolveFundingSource(userId)])
  let spendableCny = own.balance
  if (funding.pointMode === 'unlimited' && funding.ownerUserId) {
    const owner = await getBalance(funding.ownerUserId)
    spendableCny = normalizeMoney(own.balance + Math.max(owner.balance, 0))
  }
  return { own, spendableCny, ...funding }
}
```

- “是不是子账号”的判断和 `api-auth.ts:147`、`billing-identity.ts:14-16` 一致：管理角色不算；`workspaceOwnerId` 为空或等于自己也不算。
- 新增 import：`isManagementRole`、`normalizeAccountRole`（`@/lib/account/permissions`），`normalizePointMode`、`PointMode`（`./point-mode`），`transferPointsInTx`、`CreditLedgerError`（`./credit-ledger`），`cnyToPoints`（`./credit-policy`）。`credit-ledger.ts` 不引用 `ledger.ts`，不会循环引用。

再加两个不导出的 helper：

```ts
// 事务第一句：按 id 顺序锁住付款人、quota 账号和管理账号的 user 行，在锁内读积分方式，返回本次可用的补足来源
async function lockPayerRows(tx: Prisma.TransactionClient, payerId: string, funding: FundingSource, extraIds: string[] = []) {
  const ids = Array.from(new Set([payerId, ...extraIds, ...(funding.ownerUserId ? [funding.ownerUserId] : [])])).sort()
  const rows = await tx.$queryRaw<Array<{ id: string; pointMode: string | null; workspaceOwnerId: string | null }>>(
    Prisma.sql`SELECT id, pointMode, workspaceOwnerId FROM user WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
  )
  const payer = rows.find((row) => row.id === payerId)
  if (!funding.ownerUserId || payer?.workspaceOwnerId !== funding.ownerUserId) return null
  return normalizePointMode(payer.pointMode) === 'unlimited' ? funding.ownerUserId : null
}

// 在已加锁的事务里冻结 amount；不够且有补足来源时，先转入差额再冻结
async function reserveWithAutoFund(tx: Prisma.TransactionClient, input: {
  userId: string
  amount: number            // 已经 normalizeMoney
  fundingUserId: string | null
  freezeId: string
}): Promise<boolean> {
  const need = normalizeMoney(GENERATION_CREDIT_FLOOR + input.amount)
  const reserve = () => tx.userBalance.updateMany({
    where: { userId: input.userId, balance: { gte: need } },
    data: { balance: { decrement: input.amount }, frozenAmount: { increment: input.amount } },
  })
  if ((await reserve()).count === 1) return true
  if (!input.fundingUserId) return false

  const [row] = await tx.$queryRaw<Array<{ balance: Prisma.Decimal }>>(
    Prisma.sql`SELECT balance FROM user_balances WHERE userId = ${input.userId} FOR UPDATE`,
  )
  const shortfall = Math.max(normalizeMoney(need - toMoneyNumber(row?.balance ?? 0)), 0.000001)
  try {
    await transferPointsInTx(tx, {
      operation: 'auto_allocate',
      sourceUserId: input.fundingUserId,
      targetUserId: input.userId,
      points: cnyToPoints(shortfall),
      amountCny: shortfall,
      operatorId: input.userId,
      idempotencyKey: null,
      note: null,
      freezeId: input.freezeId,
    })
  } catch (error) {
    if (error instanceof CreditLedgerError && error.code === 'INSUFFICIENT_POINTS') return false
    throw error
  }
  if ((await reserve()).count === 1) return true
  throw new BillingOperationError('BILLING_AUTO_FUND_FAILED', 'Auto top-up did not cover the reservation', {
    userId: input.userId,
    freezeId: input.freezeId,
  })
}
```

- 差额必须用 `SELECT … FOR UPDATE` 读。这是加锁读，读到的是最新提交的余额。不要用 `tx.userBalance.findUnique`：MySQL 可重复读下它读的是事务快照，可能比实际余额低（期间别的任务结算退回了零头），算出的差额就偏大。
- `shortfall` 至少 0.000001（金额精度 6 位），防止舍入后为 0。
- 补足的积分 = `cnyToPoints(shortfall)`，最多 4 位小数，和「收回」允许的精度一致。不要取整到整数积分：取整会多转，还会在管理账号刚好够差额时误判为不够。
- `transferPointsInTx` 余额不足时抛 `CreditLedgerError('INSUFFICIENT_POINTS')`。那一步是带条件的 `updateMany`，没扣成时什么都没写，事务可以继续用（E1-2）。
- 在 `src/lib/billing/errors.ts` 的 `BillingOperationErrorCode`（53 行起）加 `'BILLING_AUTO_FUND_FAILED'`。
  - 在锁内，转入差额后第二次冻结不应该失败；万一失败，抛这个错，整笔回滚，连刚转入的差额一起撤销，不会留下“转了钱却没冻结”的半截状态。
  - `freezeBalance` 的 catch（210 行）会原样抛出 `BillingOperationError`。

**`freezeBalance` 的改法**（103-229）
1. 141 行之后（事务外）加 `const funding = await resolveFundingSource(userId)`。
2. 152-153 行的加锁换成 `const fundingUserId = await lockPayerRows(tx, userId, funding, [quotaUserId])`。它仍是事务里的第一句，原来锁的 `[userId, quotaUserId]` 都还在。
3. 171-186 换成下面三句；188 行原来生成 `freezeId` 的那句删掉，因为已挪到这里：
   ```ts
   const freezeId = `freeze_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
   if (!await reserveWithAutoFund(tx, { userId, amount: normalizedAmount, fundingUserId, freezeId })) {
     return null
   }
   ```
4. 189-203 的 `balanceFreeze.create` 不变，用上面的 `freezeId`。
- 子账号不论哪种积分方式都会锁管理账号那一行。这和现在一样（现在锁的是 `[管理账号, 点击者]`），并发度不变。积分方式在锁内读，管理账号同时修改积分方式也不会出现读到一半的情况：PATCH 要写成员的 `user` 行，会等这把锁。

**`increasePendingFreezeAmount` 的改法**（376-444）
1. 388 行 `try {` 之后、`prisma.$transaction` 之前，先读冻结记录的付款人：
   ```ts
   const head = await prisma.balanceFreeze.findUnique({ where: { id: freezeId }, select: { userId: true } })
   if (!head) throw new BillingOperationError('BILLING_INVALID_FREEZE', 'Invalid freeze record', { freezeId })
   const funding = await resolveFundingSource(head.userId)
   ```
2. 事务第一句改为 `const fundingUserId = await lockPayerRows(tx, head.userId, funding)`，然后才是 390 行读冻结记录。
3. 404-416 换成：
   ```ts
   if (!await reserveWithAutoFund(tx, { userId: freeze.userId, amount: normalizedDelta, fundingUserId, freezeId })) {
     return false
   }
   ```
4. 418-430 不变。
- 切换前冻结在管理账号上的在途任务：`head.userId` 是管理账号，没有补足来源，行为和现在一样。

**流水示例**：成员余额 0，生成一张 5 积分的图，管理账号余额 1000。

| 时刻 | 账号 | 流水类型（界面显示） | 积分变动 | 变动后余额 |
|---|---|---|---|---|
| 冻结 | 管理账号 | `auto_allocate_out`「自动分配给子账号」 | −5 | 995 |
| 冻结 | 成员 | `auto_allocate_in`「管理账号自动分配」 | +5 | 5 |
| 冻结 | 成员 | 冻结不写流水：余额 5 → 0，冻结 0 → 5 | | |
| 完成 | 成员 | `consume`「服务消耗」 | −5 | 0 |

- 成员余额 3、本次 5：自动分配 2，成员余额变成 5，冻结后为 0。
- 实际只花了 4：确认时退回 1，成员余额 1，下次生成先用这 1。
- 管理账号只有 1、成员 0、本次 5：不写任何流水，返回余额不足，文案见 E2-6 的「无限积分」那一种。

#### E2-5 余额显示改为本人
- `billing-identity.ts:11-21` `resolveBillingPrincipals`：
  - 返回 `{ walletUserId: actorUserId, actorUserId, ownerUserId, isMember }`；
  - `ownerUserId` 用原来算 walletUserId 的逻辑；
  - `isMember = actorUserId !== ownerUserId`；
  - 删除 `walletScope`。
- `src/app/api/user/balance/route.ts`：
  - 26 行改为 `const { walletUserId, actorUserId } = resolveBillingPrincipals(session.user)`，`walletUserId` 现在就是本人。
  - 28 行 `getBalance(walletUserId)` 换成 `getSpendableBalance(walletUserId)`（E2-4）。`balance`、`frozenAmount`、`balancePoints` 等原有字段都取返回值里的 `own`（本人余额）。
  - 删掉 36 行 `walletScope`，新增三个字段：
    - `isMember`：取 `getSpendableBalance` 返回的 `isMember`；
    - `pointMode`：子账号为 `'unlimited'` 或 `'allocated'`，管理账号为 `null`；
    - `creditAvailable: canStartGeneration(spendableCny)`。
  - 53 行改为 `generationAllowed: creditAvailable && !dailyUsage.exceeded`。
  - **不要**返回 `spendableCny` 或管理账号余额。成员不应看到管理账号有多少积分，`creditAvailable` 只是一个布尔值。
- `src/hooks/common/useAccountBalance.ts`：
  - 66-74 的 payload 类型加 `isMember?: unknown; pointMode?: unknown; creditAvailable?: unknown`。
  - 新增 state：`const [credit, setCredit] = useState<{ isMember: boolean; pointMode: PointMode | null; creditAvailable: boolean } | null>(null)`。
    - 在 refreshBalance 里 `setDailyUsage` 旁边写入；
    - `pointMode` 只接受 `'unlimited'` 和 `'allocated'`，其它为 null；`creditAvailable` 只有 `=== true` 才算 true；
    - 90-94 的重置里加 `setCredit(null)`。
  - 123 行 `walletScope` 换成三个返回值：
    - `isMember: (ready ? credit?.isMember : undefined) ?? principals?.isMember ?? false`；
    - `pointMode: ready ? credit?.pointMode ?? null : null`；
    - `creditAvailable: ready ? credit?.creditAvailable ?? null : null`。
  - 127 行去掉 `points > 0`，改为 `generationAllowed: ready && generationAllowed === true && !currentDailyUsage?.exceeded`。无限积分的成员自己余额经常是 0，但仍可以生成，能不能生成以服务端为准。
  - 131 行最后一段 `points <= 0 ? '积分不足，无法生成' : null`，换成 `credit?.creditAvailable === false ? <积分不足原因> : null`。原因按身份分三种：
    - 无限积分的成员：「管理账号积分不足，请联系管理账号充值」；
    - 分配积分的成员：「积分已用完，请联系管理账号分配积分」；
    - 管理账号：「积分不足，无法生成」（原文）。
  - 132 行 `generationDisabledLabel` 不变。
- `src/lib/account/generation-wallet.ts:8-19` `getGenerationWalletPoints`：改完 `resolveBillingPrincipals` 后，这里的条件永远成立，只走 `account.balance`。直接简化为读 `account.balance`，删掉另一个分支和其中的 prisma 查询。三个调用方都 select 了 `balance`：`api-auth.ts:93`、`src/lib/auth.ts:66/170`。
- `src/components/frameos/FosShell.tsx` 的 `BalancePill`（81-125，调用处 149/170）：
  - props 的 `walletScope` 换成 `isMember: boolean; pointMode: PointMode | null; creditAvailable: boolean | null`。149 行从 `useAccountBalance()` 取这三个，170 行传进去。
  - 令 `unlimitedMember = isMember && pointMode === 'unlimited'`，`short = creditAvailable === false`。
  - 108 行标签：`unlimitedMember ? '我的积分（无限）' : '我的积分'`。
  - 109、117 行的红色条件 `points <= 0` 改为 `short`。无限积分的成员余额为 0 是常态，不标红。
  - 116 行改「可用积分」。
  - 118 行说明保留前缀「¥1 = 100 积分 · 」，后半句按身份：
    - 管理账号：「积分不足会停止全部生成服务」；
    - 无限积分的成员：「无限积分：自己的积分不够时，自动从管理账号补足」；
    - 分配积分的成员：「积分由管理账号分配，不足时请联系管理账号」。
- 测试夹具里的 `walletScope` 一并改：
  - `tests/browser/canvas-ui-regression.fixture.tsx:17`；
  - `tests/unit/auth/billing-identity.test.ts:8/11`；
  - `tests/unit/user-api/billing-routes-internal-agent.test.ts:528`。

#### E2-6 文案

**余额不足提示**
- `src/lib/billing/errors.ts` 的 `InsufficientBalanceError`（3-15）：构造函数加第三个可选参数 `options?: { memberPointMode?: PointMode | null }`，文案按付款人选：

  | 付款人 | 余额 ≤ 下限 | 余额 > 下限，但不够本次 |
  |---|---|---|
  | 管理账号（不传或 null） | 原文「积分已达到生成下限（当前 X 积分），请补充积分后再生成」 | 原文「积分不足，本次需要 X 积分，当前剩余 Y 积分」 |
  | 分配积分的成员 | 「积分已用完（当前 X 积分），请联系管理账号给你分配积分」 | 原文后面接「。请联系管理账号给你分配积分」 |
  | 无限积分的成员 | 「管理账号积分不足，无法自动补足本次所需的 X 积分，请联系管理账号充值」 | 同左 |

  - 数字格式沿用原来的 `cnyToPoints(...).toFixed(2)`。无限积分那一行的 X 是本次需要的积分（`required`）。
  - `available` 字段仍是付款人本人的余额。
- 调用处（都在 `service.ts`）：
  - 535-536 行改为：
    ```ts
    const balance = await getBalance(payerId)
    throw new InsufficientBalanceError(quotedCost, balance.balance, { memberPointMode: (await resolveFundingSource(payerId)).pointMode })
    ```
  - 1039-1040 行同理，用 `prepareTaskBilling` 里的 `payerId`；
  - `ensureFreezeCoverage`（232-256）：按 E2-2 先读出冻结记录的 `userId`，再用 `resolveFundingSource(这个 userId)` 取积分方式传入。
- `generation-gate.ts`（12-21）：用 `getSpendableBalance(payerId)` 的结果。`!canStartGeneration(spendableCny)` 时按付款人给文案，`available` 填本人余额的积分：
  - 管理账号：原文「积分不足（当前 X 积分），所有生成服务已暂停」；
  - 分配积分的成员：「积分已用完（当前 X 积分），请联系管理账号给你分配积分」；
  - 无限积分的成员：「管理账号积分不足，暂时无法生成，请联系管理账号充值」。

**团队管理页**（`FosAccountManagementClient.tsx`）
- 统计块（302-310）：
  - 304「共享可用积分」→「我的可用积分」；
  - 新增一格「成员可用积分合计」，前端把 `subaccounts` 的 `credits.points` 加总。
- 333 行说明改为：「成员点生成，积分记在成员自己的账上。“无限积分”的成员积分不够时，自动从你的账号补足差额；“分配积分”的成员只用分配给他的积分。每日额度 0 禁止生成，unlimited 不限每日用量。」
- 行内操作顺序：流水 / 分配 / 收回 / 设置额度 / 编辑 / 删除。
- 「近90天代付」列（E1-3 的 `managerPaid90dPoints`）的查询改成两部分相加：
  - 切换前：管理账号钱包里带 quotaUserId 的 `consume`（E1-3 原写法）；
  - 切换后：管理账号钱包里的 `auto_allocate_out`，按 `relatedId`（= 成员 id）归属。

  用 `Prisma.sql` 参数化，`since` = 现在减 90 天：
  ```sql
  SELECT t.actorId, ROUND(SUM(t.amount) * 100, 4) AS points
  FROM (
    SELECT CASE WHEN JSON_VALID(bt.billingMeta) THEN JSON_UNQUOTE(JSON_EXTRACT(bt.billingMeta, '$.quotaUserId')) END AS actorId,
           ABS(bt.amount) AS amount
    FROM balance_transactions bt
    WHERE bt.userId = ${managerId} AND bt.type = 'consume' AND bt.createdAt >= ${since}
    UNION ALL
    SELECT bt.relatedId AS actorId, ABS(bt.amount) AS amount
    FROM balance_transactions bt
    WHERE bt.userId = ${managerId} AND bt.type = 'auto_allocate_out' AND bt.createdAt >= ${since}
  ) t
  WHERE t.actorId IS NOT NULL
  GROUP BY t.actorId
  ```
  列头加 `title`：「近 90 天管理账号为该成员承担的积分：切换前直接从管理账号扣的生成，加上切换后自动补足给该成员的积分。」

**积分流水弹窗**
- `FosAccountManagementParts.tsx` 的 `CREDIT_TRANSACTION_LABELS`（351-359）加三项：
  - `consume: '服务消耗'`：现在缺这一项，界面直接显示英文 type；
  - `auto_allocate_out: '自动分配给子账号'`；
  - `auto_allocate_in: '管理账号自动分配'`。
- 流水接口 `credits/route.ts` 的 GET（52-120）：
  - 对 `allocate_out`、`allocate_in`、`reclaim_out`、`reclaim_in`、`auto_allocate_out`、`auto_allocate_in` 这六种行，按 `relatedId` 用一次 `prisma.user.findMany` 查出 `name`；
  - 每行返回 `counterpartName: string | null`。
- 弹窗在类型名后面显示「 · 对方名字」，例如「自动分配给子账号 · 冯东彬」。平台后台查看管理账号的流水时，靠它分清是给哪个成员的。

**文档与注释**
- `docs/account-management.md`：在 47-50 的「账号积分」一节补一条：「生成扣点击者本人的积分：管理账号点击扣管理账号，成员点击扣成员。成员有两种积分方式：“无限积分”（默认）在成员积分不够时，自动从管理账号转入差额，流水记“自动分配给子账号”和“管理账号自动分配”；“分配积分”只用分配给他的积分。切换前成员的生成记录仍在管理账号流水里，标“管理账号代付”。」
- `daily-limit.ts:173-175` 的注释改为说明现状：
  - 切换前的行留在管理账号钱包，并带 quotaUserId，这里把它们归到成员；
  - 切换后的行在成员自己的钱包，不带 quotaUserId；
  - 自动补足的 `auto_allocate_*` 不是 `consume`，不计入每日用量。

#### E2-7 不用改，但要用测试锁住
- 每日额度（`daily-limit.ts:176-211`）和工作监督统计（`src/lib/account/activity-stats.ts:209-226`：209-217 按成员 userId 汇总本人钱包，218-226 取管理账号钱包里带 quotaUserId 的行；`266-274` 合并两者）：切换前的行靠 quotaUserId 归属，切换后的行直接按 userId 计。即使在同一天跨越切换，每一行也只算一次。
- 自动补足的 `auto_allocate_out` / `auto_allocate_in` 不是 `consume`。每日额度（`daily-limit.ts:150/186`）、工作监督（`activity-stats.ts:213/221`）、累计消耗（`reporting.ts:148/248`）都只取 `consume`，所以补足不会被算成用量，一次生成只计一次，就是成员钱包里那条 `consume`。
- `src/lib/workers/handlers/llm-proxy.ts:7` 的 `LLM_PROXY_ROUTES = {}` 是空的，目前没有计费路径。P3 备注：以后加路由必须走 `submitTask` 或 `withSyncBilling*`。

#### E2-8 测试

**要翻转或调整的旧断言**
- `tests/unit/auth/billing-identity.test.ts:5-8`：钱包改为本人。
- `tests/unit/billing/quota-attribution.test.ts:21`。
- `tests/unit/user-api/billing-routes-internal-agent.test.ts:506/518/541`。
- `tests/unit/auth/account-session-policy.test.ts`：125 保持，162 翻转。
- `tests/integration/billing/submitter.integration.test.ts:65`：加断言 freeze.userId = 点击者。
- 以下按新行为调整：
  - `tests/unit/billing/daily-limit.test.ts`；
  - `tests/unit/billing/daily-limit-freeze.test.ts`；
  - `tests/browser/admin-daily-limit.browser.mjs`；
  - `tests/integration/api/specific/admin-activity-route.test.ts`。
- `grep -rln "walletScope\|generationAllowed" tests/`：
  - mock 的 `/api/user/balance` 返回值按 E2-5 补上 `isMember`、`pointMode`、`creditAvailable`；
  - 依赖“余额为 0 时前端禁用生成”的断言，改为由 `generationAllowed` 决定。

**新增用例**（放 `tests/integration/billing/payer-switch.integration.test.ts`）

下面「无限成员」「分配成员」指成员的积分方式，管理账号记为 A。

基本扣款：
1. 同步计费，无限成员余额足够：冻结和扣款都在成员，A 余额不变，没有 `auto_allocate_*` 流水。
2. 异步任务（submitTask → worker 结算）：同上。
3. 链式任务：worker 里再提交的子任务，仍扣最初的点击者。
4. A 自己点击：照旧扣 A，没有 `auto_allocate_*`。

自动补足：

5. 无限成员余额 0、A 有 1000，生成 5 积分：
   - A −5（`auto_allocate_out`，`freezeId` 等于本次冻结的 id）；
   - 成员 +5（`auto_allocate_in`）后冻结；
   - 结算后成员 `consume` −5，余额 0。
6. 部分不足：无限成员余额 3，本次 5 → 只转 2。
7. 两边都不够：无限成员 0、A 2、本次 5 → `INSUFFICIENT_BALANCE`，文案是「无限积分」那一种；没有新增流水和冻结，两边余额不变。
8. 分配成员余额 0：`INSUFFICIENT_BALANCE`，文案带「请联系管理账号给你分配积分」；A 没被扣，没有 `auto_allocate_*`。
9. 补冻：无限成员实际费用高于报价，自己余额不够补冻（`ensureFreezeCoverage` → `increasePendingFreezeAmount`）→ 从 A 补足差额后补冻成功。
10. 失败回滚：无限成员的生成失败 → 冻结额退回成员余额，不退给 A；两条 `auto_allocate_*` 流水保留。
11. 实际花费低于报价：多出的部分退回成员余额；下一次生成如果够，先用它，不再产生 `auto_allocate_*`。

并发（三条都断言守恒：团队内所有账号 `balance + frozenAmount` 之和，加上期间 `consume` 的合计，前后相等）：

12. 同一个 A 下两名无限成员同时生成，A 只够一次 → 一成一败，A 余额不为负。
13. 无限成员生成的同时，A 给这名成员分配或收回积分 → 都在超时内完成，没有死锁（MySQL 1213 / Prisma P2034）。
14. 无限成员生成的同时，A 自己也在生成 → 没有死锁，A 余额不为负。

切换前后与统计：

15. 改积分方式：A 把无限成员改成分配 → 下一次（余额 0）被拦，文案是「分配积分」那一种；改回无限 → 可以生成。
16. 跨切换日的每日额度：同一天里切换前的代付行和切换后的本人行，合计计入成员当日用量，不重不漏；`auto_allocate_*` 不计入。
17. 切换前已冻结的在途任务：按冻结记录结算到 A；超额补冻失败时，报错里显示的是 A 的余额，不触发自动补足。
18. 工作监督：切换后成员的一次生成只计一次。
19. 浏览器伪造 `payload.meta.quotaUserId`：被 submitter 剥离，扣款仍落在真实点击者身上。

接口：

20. 账号接口：
    - 新建子账号不传 `pointMode` → `'unlimited'`；
    - 传 `'bogus'` → 400「无效的积分方式。」；
    - PATCH 管理账号带 `pointMode` → 400「积分方式仅适用于子账号。」；
    - PATCH 只带 `pointMode` → 200。
21. 余额接口：
    - 无限成员余额 0、A 有积分 → `creditAvailable: true`、`generationAllowed: true`、`balancePoints: 0`，返回体里没有 A 的余额；
    - A 余额也为 0 → `creditAvailable: false`、`generationAllowed: false`。

**其它新增测试**
- `tests/unit/billing/point-mode.test.ts`：
  - `normalizePointMode`：null 和未知值 → `'unlimited'`，`'allocated'` → `'allocated'`；
  - `parsePointMode`：未知值 → null。
- 余额 hook：在 `tests/browser/canvas-ui-regression.browser.mjs` 补两个场景（它 mock 了 `/api/user/balance`，夹具是 `canvas-ui-regression.fixture.tsx`）：
  - 无限成员 `balancePoints: 0` + `generationAllowed: true` → 可以生成，余额不标红；
  - 分配成员 `creditAvailable: false` → 原因文案是「积分已用完，请联系管理账号分配积分」。

**边界情况（不用修）**
- 切换前生成的幂等键如果在切换后被重放，`ledger.ts:120-123` 会报 “Idempotency key belongs to another wallet”，这次请求失败。
- 用户重新点一次会生成新的键，就能成功。
- 所以上线时选低峰，尽量等队列清空。

### 2.6 上线步骤
不需要约定切换时间，也不需要上线前给成员分配积分：成员默认「无限积分」，E2 上线后，成员积分不够时自动从管理账号补足，没有人会因为切换被拦。

1. E1 部署测试机，按 §10 验收；上生产按 R6。
2. M2 + E2 部署测试机：
   - 跑完 E2-8 的全部测试，包括并发（12-14）和失败回滚（10）；
   - 按 §10「计费验收」的 E2 部分逐条做一遍；
   - 演练一次第 6 步的回滚：用 M2 那个提交的代码（不含 E2）打包部署测试机，确认发布正常、`pointMode` 列还在、子账号生成又扣回管理账号；然后用 E2 的代码再部署回来。不要为了演练在 main 上提交 revert。
3. 上生产（R6 放行后执行，下面各项不用再问）：
   - 确认生产库当天的备份已经完成（做法见 R6）；
   - 选低峰时段部署 M2 + E2。发布脚本里的 `prisma db push` 会给 `user` 表加上 `pointMode` 列，现有账号全部取默认值「无限积分」。
4. 部署后马上检查：用一个余额为 0 的「无限积分」子账号生成一张最便宜的图，确认：
   - 管理账号流水多一行「自动分配给子账号」，成员流水多一行「管理账号自动分配」，两行积分相等；
   - 成员流水里有这次的 `consume`（「服务消耗」），成员自己的消费记录里能看到；
   - 管理账号余额只减少了「自动分配给子账号」那一行的积分（等于本次冻结额；固定价格的图就是图的价格），没有别的扣款；
   - 工作监督和每日额度里，这次生成只计一次。
5. 观察 24 小时：
   - warn `[Billing] payer resolved without actor context` 的次数，应接近 0；
   - 子账号的 `INSUFFICIENT_BALANCE`：只应出现在「分配积分」的成员，或管理账号自己积分不足时；
   - `BILLING_AUTO_FUND_FAILED` 和死锁（MySQL 1213 / Prisma `P2034`）应为 0。
   - 出现任何一条（或第 4 步任何一项对不上），立即按第 6 步回滚。R6 的放行已经包含回滚，不用再问。回滚后把现象和日志写进部署记录，再告诉用户。
6. 回滚：只 revert E2 的提交并重新部署（已由 R6 的放行授权），扣款就回到管理账号。
   - **M2 保留，不要 revert**：发布脚本的 `prisma db push` 不带 `--accept-data-loss`（`.runtime/test-server-deploy/remote-build.sh:18`）。去掉字段就要删列，发布会因为数据丢失警告而失败。回滚后的代码不读这一列，留着没有影响。
   - 已补足或分配到成员名下的积分留在成员名下；需要的话，管理账号用「收回」拿回来。
   - 回滚后，流水里的 `auto_allocate_*` 行没有中文标签，直接显示英文类型名，可以接受。

### 2.7 只读 SQL（可选；上线不依赖，不要在生产上主动跑）

v2.1 起上线不再依赖这些 SQL：成员默认无限积分，不需要先分配。需要给管理账号看历史代付时再用。

单个管理账号的代付明细。actorId 为 NULL 的行是管理账号自己点的：

```sql
SELECT t.actorId, u.name, ROUND(SUM(ABS(t.amount)) * 100, 2) AS points, COUNT(*) AS charges
FROM (SELECT bt.amount, CASE WHEN JSON_VALID(bt.billingMeta) THEN JSON_UNQUOTE(JSON_EXTRACT(bt.billingMeta, '$.quotaUserId')) END AS actorId
      FROM balance_transactions bt
      WHERE bt.userId = '<管理账号 id>' AND bt.type = 'consume' AND bt.createdAt >= NOW() - INTERVAL 90 DAY) t
LEFT JOIN `user` u ON u.id = t.actorId
GROUP BY t.actorId, u.name ORDER BY points DESC;
```

所有管理账号的代付总览：

```sql
SELECT m.id AS managerId, m.name AS managerName, COUNT(DISTINCT t.actorId) AS members,
       ROUND(SUM(ABS(t.amount)) * 100, 2) AS points, COUNT(*) AS charges
FROM (SELECT bt.userId, bt.amount, CASE WHEN JSON_VALID(bt.billingMeta)
        THEN JSON_UNQUOTE(JSON_EXTRACT(bt.billingMeta, '$.quotaUserId')) END AS actorId
      FROM balance_transactions bt
      WHERE bt.type = 'consume' AND bt.createdAt >= NOW() - INTERVAL 90 DAY) t
JOIN `user` m ON m.id = t.userId
WHERE t.actorId IS NOT NULL AND t.actorId <> t.userId
GROUP BY m.id, m.name ORDER BY points DESC;
```

---

## 3. 任务 A · 标题被挤压 / 重叠（问题 1）（与 v1 相同）

### A1 作品工作台头部：标题被挤成竖排（已复现，P1）
- 现象：从「我的项目」点作品进入 `/workflow/:id/workbench-premium2`，头部一行是「‹ 返回我的项目」+ 作品标题 + 协作任务/无限画布/作品设置/作品操作。视口 1100 时标题折成两行，1024 时 h1 宽度 = 0，标题一字一行竖排，头部从 68px 撑到 246px，压到下面的「作品工作台」区域。作品名越长，越早触发（作品名上限 40 字，1280 宽也会出问题）。截图：`test-results/ux-audit/wb/full-wb-1024.png`。
- 根因：`src/styles/frameos-replica.css:1151-1159`
  - `.fos-stage-actions { min-width: max-content }` 加上 `shrink-0`，`.fos-back-btn { flex: none }`，结果只有 h1 能收缩；
  - `.fos-stage-context > h1 { min-width: 0; white-space: normal; overflow-wrap: anywhere }` 允许它被压到 0 宽、逐字换行。
- 结构：`src/components/frameos/FosProjectHeader.tsx:61-110`。
- 设计：
  1. `.fos-stage-header` 改成三列 grid：`grid-template-columns: auto minmax(0, 1fr) auto`，并加 `container-type: inline-size`。
  2. 标题单行：`white-space: nowrap; overflow: hidden; text-overflow: ellipsis`，最小宽度 `min-width: 8em`。h1 加 `title={完整标题}`。删掉 `overflow-wrap: anywhere`。
  3. 「所属项目」chip（`fos-stage-parent-project`）和 meta 标签在空间不够时先隐藏（container query）。
  4. 操作按钮按容器宽度分档（CSS px；注意工作区 CSS zoom 1.2，视口 1024 ≈ 853 CSS px）：
     - ≥ 960：保持现状，带文字；
     - 720–959：协作任务 / 无限画布 / 作品设置 只显示图标（32px 方形 `fos-btn`，带 `aria-label` + tooltip），「作品操作」保留文字；
     - < 720：只留主按钮「无限画布」+「更多」菜单，菜单里放 协作任务 / 作品设置 / 编辑作品 / 删除作品。
  5. 控件尺寸遵守 32px 规范（不要用 `fos-btn-sm`）。
- 验收：视口 1024 / 1100 / 1280 / 1440，作品名分别取 6 字和 40 字：h1 只占一行，头部高度 ≤ 68px，头部内任意两个控件的矩形不相交，长标题以省略号结尾，鼠标悬停能看到全名。加一个 browser 测试（参考 `tests/browser/` 现有写法）。

### A2 影游章节画布：首次提示卡被右上角工具挡住（已复现，P1）
- 现象：新建影游后进入第 1 章画布，右上角的「三步搭起一段互动剧情」提示卡被画布的 ≡ 菜单和撤销/重做按钮压住，标题只露出「三步搭起一段互动剧」。截图：`test-results/ux-audit/chrome/story-1280.png`。
- 根因：`src/features/canvas/story/story-canvas.css:684` `.nori-story-tips { top: 64px; right: 14px; z-index: 30 }`；而 `.nori-canvas-chrome`（`src/features/canvas/canvas.css:2103`）是 `top: 0; height: 102px; z-index: 2100`，右侧 `.nori-canvas-chrome-actions` 正好落在提示卡顶部。
- 设计：在 canvas.css 定义 `--nori-canvas-chrome-h: 102px`（小屏规则 `canvas.css:3842` 同步改），提示卡改为 `top: calc(var(--nori-canvas-chrome-h) + 12px); right: 24px`，和 chrome 的右边距对齐。不要靠调 z-index 解决（那样卡片会盖住菜单）。
- 验收：1024–1920 宽度下 `.nori-story-tips` 与 `.nori-canvas-chrome-actions` 的矩形不相交；拖动节点时提示卡照旧隐藏（`story-canvas.css:376`）。

### A3 顺手清理（P3）
- 「我的项目」侧栏收起后，标题左边多出 56px 空白：收起按钮已经移到左边缘中间，`frameos-replica.css:1380`、`1395-1396` 的 `padding-left: 56px` 已经没用了，删掉。
- `.work-cover-orbit`（`frameos-replica.css:1455`）的装饰圆环比封面高出 82px，现在只是靠 `overflow: hidden` 裁掉。给 `.work-cover` 加 `contain: paint`，以后封面加 hover 位移或 transform 时它也不会画到项目标题上。

> 注：在「我的项目」列表页本身（`/projects`）用 Chrome + WebKit 测了 1440/1366/1280/1100/1024/900/800 七种宽度，侧栏展开/收起、选中项目 `?work_id=` 都试过，都没复现重叠。如果用户说的是别的位置，需要用户补一张截图。

---

## 4. 任务 B · 影游画布 = 无限画布 + 剧情能力（问题 2）

### 原则
- **同一个编辑器**（`CanvasWorkspace` / `CanvasGraph`），由必填参数 `mode: 'canvas' | 'story'` 决定模式，不再自动探测。
- **影游模式** = 无限画布的全部功能 + 剧情层：
  - 无限画布部分：全部节点、菜单、整理、同步作品、作品资产、历史、撤销重做；
  - 剧情层：剧情节点、剧情连线、剧情覆盖层、按剧情整理。
- **无限画布模式**没有任何剧情能力。
- **哪些分开、哪些共用**：
  - 两条产品线在入口、列表、路由、面包屑、侧栏高亮上分开；
  - 底层共用：ReactFlow 内核、autosave 和 ops 接口、素材库。
- **旧数据照常可用**：旧的章节链接自动跳转，已有节点照常渲染，旧影游照常试玩。

### 现状（耦合点）
1. **同一路由、同一编辑器，影游模式靠自动探测**：`CanvasGraph.tsx:1250` 的 `useStoryCanvas(projectId)` 会请求 `GET /api/interactive?projectId=`（`src/features/canvas/story/StoryCanvasContext.tsx:69`），所属项目有 `InteractiveStory` 就进影游模式。
2. **列表混在一起**：`listWorks`（`src/lib/works/service.ts:133-176`）不区分影游。影游会出现在「我的项目」和无限画布入口页的「可用作品」里。
3. **剧情连线外溢**：剧情节点粘贴到普通画布后，会悄悄启用剧情连线（`story-connection.ts:63-101`，`batch-node-connection.ts:4,37-38,103-105`）。
4. **导航错位**：
   - 章节画布的侧栏高亮「无限画布」（`FosCanvasHubClient.tsx:261` 写死了 `activeKey="canvas"`）；
   - 「‹」回到 `/projects`；
   - 作品下拉能切到任意无限画布作品。
5. **「制作画布」名不副实**：影游总览里的「制作画布」其实就是跳到 `/canvas/...`。
6. **普通作品混进影游**：往影游所属的项目里新建普通作品，会被 `reconcileStoryChapters`（`src/lib/interactive/config.ts:414-428`）自动追加成章节。
7. **章节无序**：`findInteractiveStoryByProject`（`src/lib/interactive/service.ts:254-273`）查章节时没有排序。

### B1 改读类型字段（依赖 M1）
- `listInteractiveStories`（`src/lib/interactive/service.ts:178-198`）：180 行的 `interactiveStory: { isNot: null }` 改为 `productLine: 'story'`。
- `findInteractiveStoryByProject`（254-273）：
  - 用 `work.productLine === 'story'` 判断，不再靠有没有 InteractiveStory 推断；
  - 章节按 `InteractiveStory.config.chapters[].order` 排序，排序方式同 `reconcileStoryChapters`。
- `src/lib/works/service.ts:379-386` 移动作品时的影游判断，改为读 `productLine`。

### B2 列表按产品线过滤
- `listWorks`（`src/lib/works/service.ts:133-176`）：
  - 加参数 `productLine: 'canvas' | 'story' | 'all'`，默认 `'canvas'`；
  - count 和 findMany 都用 `{ AND: [accessWhere, productLine === 'all' ? {} : { productLine }] }`。
- `GET /api/works`：
  - 读 `?productLine=`，不传就是 canvas；值不在三者之内，返回 400 `INVALID_PARAMS`；
  - 返回的 DTO 加 `productLine` 字段；
  - 前端 `fetchAllWorks` 透传这个参数。
- 调用方：
  - 用默认值 canvas，调用不用改，只需确认数据走的是 `/api/works`：
    - 「我的项目」`src/components/frameos/FosProjectsClient.tsx`；
    - 无限画布入口页 `FosCanvasHubClient.tsx` 的「可用作品」（206-227）；
    - 无限画布 `CanvasChrome` 的项目 / 作品下拉。
  - 传 `all`：
    - 协作任务 `src/components/frameos/FosAssignmentsClient.tsx`：影游卡片加「影游」标签；
    - 回收站（UI 在 `FosProjectsClient.tsx`，接口在 `src/app/api/works/recycle-bin/`）：影游加「影游」标签。

### B3 章节独立路由

**新页面** `src/app/[locale]/interactive/[workId]/chapters/[projectId]/[[...canvas]]/page.tsx`（服务端组件）
1. `const session = await requireUserAuth()`。如果 `isErrorResponse(session)`，`redirect(`/${locale}/auth/signin`)`。
2. 查章节：
   ```ts
   prisma.project.findFirst({
     where: { AND: [projectReadScopeWhere(...), { id: projectId, workId }] },
     select: {
       id: true,
       name: true,
       work: { select: { id: true, name: true, productLine: true } },
       canvases: { select: { id: true }, orderBy: { createdAt: 'asc' } },
     },
   })
   ```
   `projectReadScopeWhere` 在 `src/lib/collaboration/access.ts:60-67`，入参照现有调用处传；它已经包含 `deletedAt: null`。
3. 查不到，或者 `work.productLine !== 'story'`，就 `notFound()`。
4. canvasId 取路由里的 `canvas[0]`。它不属于这个章节时，用第一个画布。
5. 渲染新组件 `StoryChapterCanvasClient`。

**新组件** `src/components/frameos/StoryChapterCanvasClient.tsx`
- 外框 `FosShell activeKey="interactive" canvasShell`。
- 顶栏标题「{影游名} · {章名}」。
- 内容：
  ```tsx
  <CanvasWorkspace
    mode="story"
    projectId={projectId}
    canvasId={canvasId}
    canvasRouteBase={`/interactive/${workId}/chapters/${projectId}`}
    canvasHomeHref={`/interactive/${workId}`}
  />
  ```
- 不传 `projectOptions` / `onSelectProject` / `createProjectHref`。

**旧链接跳转**（用 `next/navigation` 的 `redirect`，路径带 `/${locale}` 前缀）
- 新增服务端函数 `findStoryChapterRoute(session, projectId): Promise<{ workId: string; projectId: string } | null>`，放在 `src/lib/interactive/service.ts`，查询条件同上。
- `src/app/[locale]/canvas/[[...segments]]/page.tsx`：有 projectId 时调用 `findStoryChapterRoute`；是章节就跳到 `chapterHref(workId, projectId, canvasId)`。
- `src/app/[locale]/workflow/[projectId]/workbench-premium2/[[...segments]]/page.tsx`：只在 `resolveView` 得到画布视图（`canvas` 或 `canvas/<id>`）时同样处理。工作台的其它视图不跳。

**链接函数**：新建纯函数文件 `src/lib/interactive/routes.ts`，提供 `chapterHref(workId, projectId, canvasId?)`。它返回 `/interactive/${workId}/chapters/${projectId}`，有 canvasId 时再追加 `/${canvasId}`。

**改链接**（原来怎么处理 locale，现在照旧）
- `src/features/interactive/StoryWorksCanvas.tsx:174`；
- `src/features/interactive/StoryChapterNode.tsx:121`；
- `src/features/interactive/StoryProductionCanvas.tsx:26`、`:143`。

改完全局再搜一次 `/canvas/`，确认影游相关组件里没有遗漏（例如新建影游后的跳转）。

### B4 模式参数
- `src/features/canvas/CanvasWorkspace.tsx`（props 在 21-39）新增必填的 `mode: 'canvas' | 'story'`，透传给 `CanvasGraph`（231-236）。
- 三个挂载点：
  - `FosCanvasHubClient.tsx:264-275`：`mode="canvas"`；
  - `FosWorkflowClient.tsx:78-85`：`mode="canvas"`；
  - `StoryChapterCanvasClient`：`mode="story"`。
- `useStoryCanvas`（`StoryCanvasContext.tsx:69`）：
  - 加第三个参数 `enabled`，`CanvasGraph.tsx:1250` 传 `mode === 'story'`；
  - 不启用时不发请求，story 为 null。普通画布因此少一次 `/api/interactive?projectId=` 请求。
- `StoryCanvasProvider`、`StoryCanvasOverlay`（`CanvasGraph.tsx:4152`、`4522`）只在 story 模式挂载。`useStoryCanvasContext`（117-118）本来就允许为 null，其它读取方不用改。
- story 模式下接口没返回影游（数据异常）：画布区域显示「这个章节不属于任何影游」，和一个按钮「返回影游画布」（跳 `/interactive`）。

### B5 编辑器外框
- 由 `storyCanvas.story` 组装 `storyNavigation = { workId, workName, chapters: [{ projectId, name, order }], currentProjectId }`：
  - 字段来源见 `StoryCanvasInfo`（`StoryCanvasContext.tsx:29-37`）；
  - 经 `CanvasWorkspace` 传给 `src/features/canvas/components/CanvasChrome.tsx` 和 `src/features/canvas/components/EmptyCanvasChrome.tsx`。
- story 模式的面包屑：`‹ 影游画布 / {影游名} / {第 N 章 · 章名 ▾}`。
  - 「‹」和「{影游名}」跳 `/interactive/${workId}`；
  - 「影游画布」跳 `/interactive`；
  - 章节下拉按 config 顺序列出本影游的章节，点击后用 `chapterHref` 跳转。
- 面包屑只替换项目 / 作品下拉。以下全部保留（v1 说隐藏，v2 取消）：画布下拉、同步作品、作品资产、历史、撤销 / 重做、保存状态。
- canvas 模式不变。

### B6 节点和连线

**canvas 模式**（不允许剧情能力）
- 添加面板（`CanvasGraph.tsx:4426`、`CanvasToolRail.tsx:64`）和右键菜单里不出现剧情节点。
- 粘贴、复制、克隆（`src/features/canvas/clipboard.ts`、`src/features/canvas/clone-node-data.ts`）：
  - 过滤掉 `isStoryNodeType` 为真的节点，以及连到它们的边；
  - 发生过滤时 toast「剧情节点只能用在影游画布」。
- 连线：
  - 连接校验拒绝任何一端是剧情节点的连线，toast「剧情节点只能在影游画布里连线」；
  - `resolveStoryConnection`（`story-connection.ts:63-101`）和 `batch-node-connection.ts`（4、37-38、103-105）里的剧情分支，只在 story 模式执行。
- `MEDIA_WIRE_MENU_ITEMS`（`CanvasGraph.tsx:370`）里的 `story_scene` 只在 story 模式出现。
- 旧数据里已有的剧情节点照常渲染：`nodeTypes` 注册表（`CanvasGraph.tsx:235-257`）保持完整。

**story 模式**（无限画布全集 + 剧情）
- 添加面板 = 无限画布的全部节点 + 剧情节点。
- 整理：
  - `CanvasGraph.tsx:4428` 的 `canOrganize` 改为 `!readOnly`，去掉其中和影游有关的条件；
  - 整理菜单第一项是「按剧情走向」，复用影游现有的剧情排布；后面接无限画布的标准整理方式；
  - 每次整理都能撤销；右键菜单里的整理入口同样处理。
- 影游互动节点 `story_interaction` 已经在 `STORY_NODE_TYPES`（`src/lib/interactive/types.ts:7-15`）里，`isStoryNodeType`（`src/lib/interactive/compile.ts:52-54`）对它返回 true，所以上面 canvas 模式的过滤和连线拦截会自动拦住它，不用另外加判断。挂载连线（边的 role 是 `STORY_MOUNT_ROLE = 'STORY_MOUNT'`，`types.ts:22`；连接点 id 是 `STORY_MOUNT_HANDLE = 'mount'`，`types.ts:26`）也属于剧情连线，canvas 模式一并拒绝。以后新增剧情节点类型，必须加进 `STORY_NODE_TYPES`。

### B7 改名
- 「制作画布」→「章节画布」，位置：
  - `StoryWorksCanvas.tsx:175, 253, 257, 264`；
  - `SequencePreview.tsx:96`；
  - `StoryLayerNav.tsx:11`；
  - `StoryProductionCanvas.tsx:39, 93, 106, 144`。
- 改完用 `grep -rn "制作画布" src` 确认已清零。
- 路由名和组件名不改。

### B8 禁止往影游里直接建作品
- 在 `POST /api/projects`（`src/app/api/projects/route.ts`）688 行 `tx.project.create` 之前检查：如果 workId 对应项目的 `productLine === 'story'`，返回 409 `CONFLICT`「影游章节请在影游画布里新建」。
- 只有 `insertChapter` 能往影游里建作品。
- `reconcileStoryChapters` 保留，用来兼容旧数据。

### B 验收
1. 新建的影游只出现在「影游画布」，不出现在「我的项目」和无限画布入口页。反过来，新建的普通项目也不会出现在影游里。
2. 章节画布里：
   - 侧栏高亮「影游画布」；
   - 面包屑如 B5，「‹」回影游总览；
   - 章节下拉只有本影游的章节，顺序和总览一致。
3. 功能对齐：在章节画布里，无限画布添加面板里的每种节点都能添加；能生成一张图；整理、同步作品、作品资产、历史、撤销重做都能用，表现和无限画布一致。
4. 普通画布里：
   - 添加面板没有剧情节点；
   - 粘贴剧情节点会被过滤并提示；
   - network 里没有 `/api/interactive?projectId=` 请求。
5. 旧链接 `/canvas/{章节id}/{canvasId}`、`/workflow/{章节id}/workbench-premium2/canvas` 都 307 到章节路由；旧影游照常打开、照常试玩。
6. 用 `POST /api/projects` 往影游里建作品，返回 409。

**测试**
- 要更新：
  - `tests/unit/frameos/works-service.test.ts`；
  - `tests/unit/interactive/service.test.ts`；
  - `tests/unit/frameos/canvas-hierarchy-and-management.test.ts`；
  - `tests/unit/frameos/assignments-replica-contract.test.ts`；
  - `tests/browser/interactive-layers.fixture.tsx`。
- 要新增：
  - `chapterHref`；
  - `listWorks` 的三种 productLine；
  - B8 的 409；
  - B6 的粘贴过滤和连线拦截，用例里要有一个 `story_interaction` 节点和一条挂载（mount）连线。

---

## 5. M1 · 类型字段（B、F 的前置）

### 表结构（`prisma/schema.prisma`）
- `model Work`（419-439）加：
  - `productLine String @default("canvas") @db.VarChar(16)`，取值 `'canvas' | 'story'`；
  - `@@index([workspaceOwnerId, productLine])`。
- `model Project` 加 `creationMode String @default("workflow") @db.VarChar(16)`，取值 `'workflow' | 'canvas'`。
- TS 类型放在新文件 `src/lib/works/product-line.ts`：
  ```ts
  export type WorkProductLine = 'canvas' | 'story'
  export type ProjectCreationMode = 'workflow' | 'canvas'
  ```

### 迁移文件
`prisma/migrations/20261114120000_add_work_product_line_and_project_creation_mode/migration.sql`：

```sql
ALTER TABLE `works` ADD COLUMN `productLine` VARCHAR(16) NOT NULL DEFAULT 'canvas';
CREATE INDEX `works_workspaceOwnerId_productLine_idx` ON `works`(`workspaceOwnerId`, `productLine`);
ALTER TABLE `projects` ADD COLUMN `creationMode` VARCHAR(16) NOT NULL DEFAULT 'workflow';
```

### 写入点
- `createInteractiveStory`（`src/lib/interactive/service.ts:234-242` 的 `work.create`）：写 `productLine: 'story'`。
- `insertChapter`（206-209 的 `project.create`）：写 `creationMode: 'canvas'`。
- `src/app/api/projects/route.ts:688-698` 的 `tx.project.create`：写入 629-636 已解析出的创建方式，只允许 `'canvas'` 和 `'workflow'`。
- 其它创建路径用默认值。

### 回填
新建目录 `scripts/sql/`，以及文件 `scripts/sql/20261114-backfill-product-line-creation-mode.sql`：

```sql
UPDATE works w JOIN interactive_stories s ON s.workId = w.id SET w.productLine = 'story' WHERE w.productLine <> 'story';
UPDATE projects p JOIN works w ON w.id = p.workId SET p.creationMode = 'canvas' WHERE w.productLine = 'story' AND p.creationMode <> 'canvas';
UPDATE projects p
JOIN (SELECT projectId, MIN(createdAt) AS firstCanvasAt FROM canvases GROUP BY projectId) c ON c.projectId = p.id
LEFT JOIN novel_promotion_projects npp ON npp.projectId = p.id
SET p.creationMode = 'canvas'
WHERE p.creationMode = 'workflow'
  AND TIMESTAMPDIFF(SECOND, p.createdAt, c.firstCanvasAt) BETWEEN 0 AND 10
  AND NOT EXISTS (SELECT 1 FROM novel_promotion_episodes e WHERE e.novelPromotionProjectId = npp.id);
```

第三条的判断依据：
- 用画布方式新建作品时，`projects/route.ts:820-829` 会在同一个事务里建「主画布」（`createBlankCanvas` 为真时），所以第一个画布在作品创建后几秒内就出现。
- 工作台方式的作品是后来才打开画布的，时间差大得多。
- 另外，有剧集的作品一定是工作台方式，所以排除掉。

**先跑 dry-run，把数量和样本记进部署记录，然后直接执行回填，不用等确认。** 回填的 UPDATE 都带条件，重复执行是安全的；第三条即使判断错了，也只影响点封面时进哪里，F 的快捷入口仍能到另一处。

```sql
SELECT COUNT(*) FROM works w JOIN interactive_stories s ON s.workId = w.id;
SELECT COUNT(*) FROM projects p JOIN interactive_stories s ON s.workId = p.workId;
SELECT p.id, p.name, p.createdAt, c.firstCanvasAt
FROM projects p
JOIN (SELECT projectId, MIN(createdAt) AS firstCanvasAt FROM canvases GROUP BY projectId) c ON c.projectId = p.id
LEFT JOIN novel_promotion_projects npp ON npp.projectId = p.id
WHERE p.creationMode = 'workflow'
  AND NOT EXISTS (SELECT 1 FROM interactive_stories s WHERE s.workId = p.workId)
  AND TIMESTAMPDIFF(SECOND, p.createdAt, c.firstCanvasAt) BETWEEN 0 AND 10
  AND NOT EXISTS (SELECT 1 FROM novel_promotion_episodes e WHERE e.novelPromotionProjectId = npp.id)
LIMIT 20;
```

第三条再跑一次 `SELECT COUNT(*)` 版本，得到总数。

### 执行
- **测试机**：
  1. 测试机的构建脚本会在构建后跑 `npx prisma db push --skip-generate`，新列自动加上。
  2. 然后先跑 dry-run，再执行一次 `npx prisma db execute --file scripts/sql/20261114-backfill-product-line-creation-mode.sql --schema prisma/schema.prisma`。
  3. 不要改 `remote-build.sh`。
- **生产**：包含在批次 3 的 R6 放行里。先确认当天的备份（R6），再跑 dry-run 并记进部署记录，然后执行回填。
- **顺序**：M1 上线并回填完成后，才能部署读这两个字段的 B 和 F。

---

## 6. 任务 C · 团队管理（工作监督留在管理账号自己的界面）（问题 3）

**侧栏只留一个入口**
- `src/components/frameos/FosShell.tsx`：
  - 底部链接（357-368）：361「子账号管理」→「团队管理」，href 仍是 `/account-management`；删掉 364-368 的「工作监督」；
  - 29 行：key 联合类型里删掉 `'activity'`；
  - 504 行：`canAccess` 去掉 activity 分支；
  - 511 行提示改为「仅管理账号可以进入团队管理。」
- `src/components/frameos/FrameWorkbenchShell.tsx`：92 行标签改「团队管理」；删掉 93 行（activity）和 19 行的 `'activity'`。

**两页之间用标签切换**
- 新建 `src/components/frameos/TeamManagementTabs.tsx`：
  - 两个标签：「成员与积分」（`/account-management`）｜「工作监督」（`/account-management/activity`）；
  - 用和侧栏一样的 Link，当前页加 `aria-current="page"`；
  - 高 32px；
  - 两页都放在 h1 下面。
- h1 统一为「团队管理」：
  - `FosAccountManagementClient.tsx:294`「子账号管理」→「团队管理」；
  - `src/components/frameos/FosStaffActivityClient.tsx:189`「工作监督」→「团队管理」。
- `FosStaffActivityClient.tsx:184`：`activeKey="activity"` → `"accounts"`。

**不变的部分**：路由、接口、权限、数据范围都不变。仍是管理账号看自己的直属子账号；Phase 1 定下的“只展示统计，不打分、不排行”原则也不变。

**文档**：`docs/account-management.md:42` 的「子账号管理」改为「团队管理」。

**测试**
- `tests/unit/frameos/account-management-platform.test.ts:54-55` 的侧栏断言按新标签改。
- 新增断言：侧栏只有一个「团队管理」入口；两页都有标签条。
- `tests/integration/api/specific/admin-activity-route.test.ts` 不用动。

**派工**：和 E1 放在同一个实现批次，因为两者都改 `FosAccountManagementClient.tsx`。

---

## 7. 任务 F · 作品封面按创建方式进入（依赖 M1、D1）

- `src/lib/works/service.ts:101`：`workProjectSelect` 加 `creationMode: true`。
- `src/components/frameos/works/types.ts`：
  - `WorkProject` 加 `creationMode: 'workflow' | 'canvas'`；
  - 归一化（168-177）写 `creationMode: raw.creationMode === 'canvas' ? 'canvas' : 'workflow'`，没有这个字段时按 workflow 处理。
- `src/components/frameos/FosWorkPanels.tsx`：
  - 定义 `canvasHref = /workflow/${id}/workbench-premium2/canvas`，`entryHref = creationMode === 'canvas' ? canvasHref : workbenchHref`（`workbenchHref` 在 195 行）；
  - 封面链接（223-224，`works-project-main`）和运行中遮罩的「进入作品」（219）都改用 `entryHref`；
  - 卡片上的快捷入口（250-252，`project-card-canvas-entry`）：
    - 画布方式的作品显示「工作台」，链到 `workbenchHref`，testid 为 `project-card-workbench-entry`；
    - 工作台方式的作品保持「进入画布」；
  - 菜单里的入口（293）不变。
- 影游章节不会出现在这里，B2 已经过滤掉了。
- 为什么依赖 D1：F 会让更多人走 `/workflow/:id/workbench-premium2/canvas` 进画布，这条路由的面包屑问题要先修。
- 验收：
  - 画布方式建的作品，点封面直接进画布；
  - 工作台方式的作品，点封面进工作台；
  - 快捷入口显示另一个去处；
  - 回填过的旧作品按回填结果走。

---

## 8. 任务 D · 其它问题（v2 更新）（问题 4）

| # | 级别 | 问题 | 处理 |
|---|---|---|---|
| D1 | P1 | 同一个作品走 `/workflow/:id/workbench-premium2/canvas` 打开，面包屑显示「未归属项目」；走 `/canvas/:id/:canvasId` 打开则显示正确的项目 | 两个疑点都修，不用先定位是哪一个：① 作品数据接口返回非 2xx 时会回退到 `loadFallbackProject`（`src/components/frameos/useFosProject.ts:250-255`），它只带名称和 canDelete，没有所属项目 → 回退查询也取 `work { id, name }`；② 快照（同文件 317-330）会缓存空的所属项目 → 所属项目为空时不写快照。再加一条 headless 测试：同一个作品从两条路由打开，面包屑都显示正确的项目名 |
| D2 | P1 | 章节画布侧栏高亮「无限画布」、返回去「我的项目」 | 归入 B（B3、B5） |
| D3 | P1 | 章节画布的提示卡被右上角工具挡住 | A2 |
| D4 | P2 | 作品封面总是进工作台 | F |
| D5 | P2 | 新建的空影游一打开就显示红色「N 个问题」 | 空章节、新建状态改成中性的「下一步」清单（灰色或品牌色）；用户写了内容或点过试玩/发布之后才用红色。相关文件：`src/lib/interactive/validate.ts`、`StoryOverviewSide.tsx`、`StoryCanvasOverlay` 底栏。和 B 同批 |
| D6 | P3 | 影游总览头部的封面位置只有一个字母 | `StoryOverview.tsx` 头部改用生成色块做占位封面（做法同 `WorkCover`）。和 B 同批 |
| D7 | P3 | 「我的项目」侧栏收起后标题左侧有 56px 空白 | A3 |
| D8 | 观察 | `/api/user/balance` 首次进入时出现过一次 502 | 没有复现；再出现就查 `journalctl -u norivideo-test-web` |
| D9 | P1 | 子账号能看到全团队的流水和管理账号余额 | E1-3 |

---

## 9. 分批

| 批次 | 内容 | 前置条件 | 上线 |
|---|---|---|---|
| 1a | E1 + C | 无 | 测试机验收通过后按 R6 上生产 |
| 1b | A1–A3 | 无 | 同上 |
| 1c | D1 | 无 | 同上 |
| 2 | M2 → E2（两个提交） | E1 已上生产 | 按 §2.6 |
| 3 | M1 → B（含 D5、D6）→ F | M1 回填完成后才部署 B、F | 测试机验收通过后按 R6 上生产 |

- 1a、1b、1c 互不依赖，可以并行。
- 批次 2：
  - 先提交 M2，只包含 `prisma/schema.prisma` 和 `prisma/migrations/20261114130000_add_user_point_mode/migration.sql`；
  - 再提交 E2，包含 E2-1～E2-8 的其余全部改动（包括 E2-3 里的 `point-mode.ts`、账号接口和弹窗）；
  - 两个提交一起部署。回滚时只 revert E2，M2 保留（§2.6 第 6 步）。
- E2 和 B 可以并行开发，但不要同一天上生产，出了问题才好判断是哪边引起的。

---

## 10. 验证

### 本机测试环境
本机 `node_modules` 可能被 macOS 驱逐成占位文件。这时 tsc 会在 0.1 秒内静默 exit 0，其它工具报 `Invalid package config`。所以在干净镜像里跑测试：

**建镜像**
- 同步代码（目标必须是绝对路径，必须带 `--delete`）：
  ```bash
  rsync -a --delete --exclude /node_modules --exclude /.next --exclude /test-results --exclude /.git --exclude /.runtime --exclude /data ./ /tmp/nori-work-<任务名>/
  ```
- 镜像的 `node_modules` 软链到 `/private/tmp/nori-work/node_modules`。没有这份 node_modules 时，在 `/private/tmp/nori-work` 里执行：
  ```bash
  npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/npm-cache-nori
  npx prisma generate
  ```

**跑检查**
- tsc：`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`。基线是 12 行错误，全部来自「 2」重复文件，exit 2。没有新增错误才算通过。
- vitest：`node ./node_modules/vitest/vitest.mjs run <files>`，输出写进日志再 grep。非 localhost 请求需要设置 `ALLOW_TEST_NETWORK=1`。
- browser 测试：
  1. 先 `node scripts/build-browser-fixtures.mjs <fixture>`；
  2. 再 `NORI_BROWSER_TOOLS_DIR=~/.npm/_npx/e41f203b7505f1fb timeout -s KILL 240 node tests/browser/<name>.browser.mjs > log 2>&1`；
  3. 不要把 Playwright 的输出 pipe 给 head/tail，会卡住。

### 视觉与部署
- 视觉验收全部 headless，可以复用 `test-results/ux-audit/` 下的脚本：
  - `overlap.mjs`：标题重叠扫描；
  - `wb2.mjs`：工作台头部量尺寸；
  - `flow.mjs`：新建项目 → 画布 → 影游的端到端流程；
  - `webkit.mjs`：WebKit 渲染。

  脚本用的 playwright-core 在 `~/.npm/_npx/e41f203b7505f1fb`，WebKit 已经装好。
- 测试机部署见 R5，测试账号和密码重置见 R4。

### 计费验收（测试机）
用测试管理员（下称 A）和它名下两个子账号，名字里带「UX计费测试」；没有就新建。

- **E1**：
  - 单个分配 100 积分，再批量给 2 人各分配 10 积分；两边各有一条流水，金额对得上；
  - 用同一个键重放，不会重复扣；
  - 收回正常；
  - 子账号登录后，消费记录里只有本人的行和「管理账号代付」行，看不到管理账号余额。
- **E2**：
  - 准备：两个子账号分别命名「UX计费测试-无限」（积分方式「无限积分」）和「UX计费测试-分配」（「分配积分」），积分都收回到 0。记下 A 的余额。下面每一步都对照 A 和成员两边的流水。每次都生成一张最便宜的图。
  1. 无限成员（余额 0）生成：
     - A 的流水多一行「自动分配给子账号 · UX计费测试-无限」，成员流水多一行「管理账号自动分配 · A 的名字」，两行积分相等；
     - 成员流水里有这次的「服务消耗」，成员登录后在自己的消费记录里能看到；
     - A 的余额只减少了自动分配那一行的积分，没有别的扣款；
     - 成员页面的余额胶囊显示「我的积分（无限）」，余额 0 时不标红，生成按钮可用；
     - 成员的 `/api/user/balance` 返回体里没有 A 的余额，只有 `creditAvailable: true`。
  2. 分配成员（余额 0）生成：
     - 被拦，提示里有「请联系管理账号给你分配积分」；A 的余额和流水都没变；
     - A 给他分配 10 积分后，他能生成，扣的是他自己的积分，没有自动分配行。
  3. 管理账号也不够（必须在第 2 步之后做）：
     - A 用「分配」把自己的积分转给分配成员（分配只能是整数，超过单次上限就分几次），直到 A 的余额低于一张图的价格；
     - 无限成员再生成：提示「管理账号积分不足，无法自动补足本次所需的 X 积分，请联系管理账号充值」；A 和成员都没有新流水，也没有冻结；
     - 做完用「收回」把积分全部还给 A（收回可以带 4 位小数）。
     - A 余额正好为 0 时按钮不可用的情况，由 E2-8 第 21 条和余额 hook 的浏览器场景覆盖，这里不用凑 0。
  4. 团队管理页：
     - 成员行显示积分方式标签：「无限积分」绿色，「分配积分」灰色；
     - 先把无限成员的积分收回到 0，再在「编辑」里改成「分配积分」：他下一次生成立即被拦（页面刷新后按钮状态也跟着变）；改回「无限积分」后又能生成；
     - 「近90天代付」包含第 1 步的自动补足；列头悬停能看到说明。
  5. 工作监督和每日额度：以上每次成功的生成都只计一次，`auto_allocate_*` 不计入。
  6. A 自己生成：照旧扣 A，没有自动分配行。

---

## 11. 表单设计

### 11.0 通用规则
只用于本文新增或改动的表单，其它表单不动。

- **宽度**：沿用现有三档。
  - 积分操作弹窗 `max-w-[500px]`（`CreditOperationDialog`，`FosAccountManagementParts.tsx:479`）；
  - 账号弹窗和新增的批量分配弹窗 `max-w-[700px]`（`AccountDialog`，168 行）；
  - 流水弹窗 `max-w-[780px]`（`CreditLedgerDialog`，409 行）。
- **布局**：
  - 标签在输入框上方；说明文字和字段错误在输入框下方。
  - 字段错误用 `text-[10px] text-red-300`。
  - 提交失败的错误放在主按钮上方，照 318 行的 `role="alert"` 红框写法。
- **校验**：
  - 失焦时校验当前字段；
  - 点主按钮时校验全部字段，有错就把焦点移到第一个出错的字段，不发请求；
  - 前端校验只为提示，以服务端校验为准。
- **提交中**：主按钮显示「处理中…」并禁用；Esc 和点遮罩都不关闭弹窗。成功后关闭弹窗，刷新列表。
- **服务端错误**：
  - 400 和 409：显示接口返回的文案；能对应到字段的放在字段下面；
  - 403：「没有权限执行这个操作。」；
  - 5xx 或网络错误：「网络异常，请重试。」，保留已填内容。
- **幂等键**（单个分配、收回、批量分配）：
  - 弹窗打开时 `crypto.randomUUID()` 生成一次；
  - 失败重试沿用同一个键；关闭弹窗后作废；
  - 如果现在单个分配和收回是每次提交新生成键，改成这个做法。
- **数字**：显示用 `toLocaleString('zh-CN', { maximumFractionDigits: 4 })`，和 505 行一致。
- **键盘**：
  - Enter 提交，备注输入框里除外；
  - Esc 关闭；
  - 打开时焦点在第一个输入框。

### 11.1 账号弹窗（`AccountDialog`）
- 只新增「积分方式」一项，写法见 E2-3：
  - 两张单选卡片，只对子账号显示；
  - 新建时默认「无限积分」，编辑时预选当前值；
  - 从「无限积分」改为「分配积分」且成员积分 ≤ 0 时，显示琥珀色提醒，不拦保存。
- 其它字段不变。保存后，成员行的积分方式标签立即更新。

### 11.2 分配积分（`CreditOperationDialog`，`operation = 'allocate'`）
- **先修一个现有 bug**：
  - `FosAccountManagementClient.tsx:404` 把成员自己的积分 `creditTarget.credits.points` 当作 `sourceBalancePoints` 传进去，所以分配时显示的「可用」和「全部」都是成员的积分。
  - 改为：allocate 时传管理账号自己的可用积分 `workspace?.manager.credits.points`（304 行统计卡用的同一个值）；reclaim 时仍传成员的积分。
- 从上到下：
  1. 说明：「积分将从你的账号转入该成员，成员生成时先用这部分积分。」
  2. 「你的可用积分 X 积分」，右侧「全部」按钮：填 `Math.floor(X)`，因为分配只能是整数。
  3. 「分配积分」输入框：`inputMode="numeric"`，placeholder「请输入正整数积分」。
  4. 预览（输入合法时才显示）：「分配后你剩余 R 积分；该成员 A → B 积分」。
  5. 备注（可选），照现有。
  6. 主按钮「确认分配」。
- 校验：
  - 正整数，不超过 2,000,000,000（现有上限）；
  - 不超过你的可用积分，否则提示「超过你的可用积分（X）」，主按钮禁用。

### 11.3 收回积分（`operation = 'reclaim'`）
- 标题「收回积分」。
- 说明：「把该成员的可用积分收回到你的账号。冻结中（正在生成）的积分不能收回。」
- 「该成员可用积分 X 积分」，右侧「全部」按钮填 X。
- 519 行的小字改为：「“全部”按成员当前可用积分填写，可保留 4 位小数，不留零头。」
- 校验：
  - 大于 0，最多 4 位小数；
  - 不超过 X，否则提示「超过该成员的可用积分（X）」。
- 预览：「收回后该成员剩余 R 积分」。

### 11.4 批量分配（`BulkAllocateDialog`，E1-2）
```
┌ 批量分配积分 ─────────────────────────────────── × ┐
│ 每人分配积分 [            ] 积分                     │
│ ┌ 成员 ───────────── 当前积分 ── 近90天代付 ───── ┐ │
│ │ 张三                    120          35     移除 │ │
│ │ 李四                      0         210     移除 │ │
│ └──────────────────────────────────────────────────┘ │
│ 合计 2 人 × 50 = 100 积分                             │
│ 你的可用积分 1,000 → 分配后剩余 900                    │
│ 备注（可选）[                                ]        │
│                               [取消]  [确认分配]      │
└──────────────────────────────────────────────────────┘
```
- **勾选**：
  - 只有状态正常的子账号可以勾选；
  - 停用的行复选框禁用，`title="已停用的账号不能分配"`；
  - 表头全选只选可以勾选的行。
- **列表**：
  - 每行可以「移除」；
  - 移除到 0 人时，主按钮禁用，并提示「请至少选择一名成员」；
  - 超过 100 人时，主按钮禁用，并提示「一次最多给 100 人分配」（接口上限）。
- **合计**：
  - 剩余为负时，「分配后剩余」标红，下方显示「可用积分不足：需要 X 积分，当前可用 Y 积分。」，主按钮禁用。
- **成功**：
  - 提示「已给 N 名成员各分配 X 积分」；
  - 返回里有 `idempotent: true` 的行时，追加「（其中 M 人之前已分配过，这次没有重复扣）」；
  - 然后关闭弹窗、清空勾选、刷新列表。
  - 页面已有成功提示组件就用它；没有就在列表上方显示一条绿色提示，4 秒后消失。
- **testid**：
  - `account-select-<userId>`、`account-select-all`；
  - `bulk-allocate-open`、`bulk-allocate-points`；
  - `bulk-allocate-row-<userId>`、`bulk-allocate-remove-<userId>`；
  - `bulk-allocate-total`、`bulk-allocate-submit`。

### 11.5 流水弹窗（`CreditLedgerDialog`）
- `balanceAfterPoints` 的类型改为 `number | null`；为 null（代付行）时显示「—」。
- `paidBy === 'manager'` 的行，在类型旁加灰色胶囊「管理账号代付」，样式照成员行的身份标签。
- 类型文案以 E2-6 为准。E2-6 没写到的，补上：
  - `consume`「服务消耗」；
  - `auto_allocate_out`「自动分配给子账号」；
  - `auto_allocate_in`「管理账号自动分配」。
- 转账类的行（`allocate_*`、`reclaim_*`、`auto_allocate_*`）在类型后加「 · 对方名字」；接口没给对方名字就不显示。

### 11.6 成员表
- 在现有列上做三处改动，其它列不动：
  - 最左加勾选列（E1-2）；
  - 「个人积分」列的积分下面加积分方式标签（E2-3）；
  - 「个人积分」后面加「近90天代付」列（E1-3），表头悬停说明按 E2-6。
- 行内操作：现有顺序不变，「分配」紧跟在「流水」后面（E1-1）。

### 11.7 新建弹窗
- `CreateProjectDialog`、`CreateStoryDialog`、影游里的「新建章节」：字段和布局都不变。
- `POST /api/projects` 返回 409（B8）时，把接口文案显示在弹窗现有的错误区，不关闭弹窗。

---

## 12. 接口契约汇总

通用规则：
- 返回体只加字段，不删字段、不改已有字段的含义。
- 前端读新字段时宽松处理：没有这个字段，就按旧行为。
- 新接口一律先 `requireUserAuth()`，日志前缀照相邻代码。

| 接口 | 改动 | 谁能调用 | 详见 |
|---|---|---|---|
| `POST /api/admin/accounts/[userId]/credits` | 恢复 `allocate`，和 `reclaim` 对称；请求体不变 | 管理账号，只对直属子账号 | E1-1 |
| `GET /api/admin/accounts/[userId]/credits` | 目标是子账号时按 self 范围查；代付行加 `paidBy: 'manager'`，`balanceAfter` 为 null | 同上 | E1-3 第 4 条 |
| `POST /api/admin/accounts/bulk-credits`（新） | 请求体和返回见 E1-2；有一个目标不合格，整单 403 | 管理账号 | E1-2 |
| `GET /api/admin/accounts` | 每个子账号加 `pointMode`、`managerPaid90dPoints` | 照现有 | E1-3、E2-3 |
| `POST /api/admin/accounts` | 可带 `pointMode`，缺省 `'unlimited'`；建管理账号时带了返回 400 | 照现有 | E2-3 |
| `PATCH /api/admin/accounts/[userId]` | 可带 `pointMode`，立即生效 | 照现有 | E2-3 |
| `DELETE /api/admin/accounts/[userId]` | 只改拦截文案 | 照现有 | E1-1 |
| `GET /api/user/balance` | 余额是点击者本人的；加 `isMember`、`pointMode`、`creditAvailable`；不返回管理账号余额 | 登录用户 | E2-5 |
| `GET /api/user/transactions`、`GET /api/user/costs` | 按 `RecordScope` 过滤：管理账号看全团队，子账号只看自己 | 登录用户 | E1-3 |
| `POST /api/projects` | 写 `creationMode`；往影游里建作品返回 409 `CONFLICT` | 照现有 | M1、B8 |
| 项目列表、章节路由 | 按产品线过滤；章节新地址，旧地址 307 跳转 | 照现有 | B2、B3 |
| 所有生成接口 | 付款人是点击者；新增错误码 `BILLING_AUTO_FUND_FAILED`；余额不足的文案按身份区分 | 照现有 | E2-2、E2-4、E2-6 |

---

## 13. 权限矩阵

现有权限一律不变。下表只列本文新增或改动的操作。

| 操作 | 平台管理员 | 管理账号（`admin`） | 子账号（项目组长、成员） |
|---|---|---|---|
| 进团队管理页（两个标签） | 照现有 | 可以，只看自己的团队 | 不可以 |
| 单个分配、收回 | 照现有 | 可以，只对直属子账号 | 不可以 |
| 批量分配 | 不可以 | 可以，只对直属子账号；有一个不合格，整单 403 | 不可以 |
| 改积分方式 | 平台后台不显示这一项 | 能编辑这个子账号的人都可以 | 不可以 |
| 看某个成员的流水 | 照现有 | 直属子账号：self 范围，带代付标签 | 不可以 |
| 看自己的消费记录和流水 | 照现有 | 全团队 | 只看自己点的，加上「管理账号代付」行；看不到管理账号余额 |
| 自动补足（系统自动发生） | — | 只从自己补给 `workspaceOwnerId` 是自己、积分方式为「无限积分」的子账号 | — |
| 工作监督 | 403（照 Phase 1） | 可以 | 403 |

---

## 14. 每批完成标准

一批满足下面全部条件才算完成：
1. §9 里这一批的条目全部做完；偏差都写进了提交说明（R2 第 5 条）。
2. tsc 没有新增错误（基线 12 行，§10）。
3. 这一批各任务「测试」小节里的测试全部通过，包括新增的。
4. 测试机部署成功；§10 里这一批的验收逐条通过，结果和截图写进部署记录。
5. 已提交（R7），并已通知用户可以上生产（R6）。

上生产之后，还要满足：
- 生产冒烟通过：打开受影响的页面，并用最便宜的模型生成一次；
- 批次 2 还要通过 §2.6 第 4、5 步；
- 部署记录补上「生产」一节。

| 批次 | 必须通过的测试 | 测试机验收 |
|---|---|---|
| 1a | E1-5、C 的测试 | §10「计费验收」E1 部分；团队管理页的两个标签能互相切换；侧栏只有一个「团队管理」入口 |
| 1b | §3 各条的验收 | `overlap.mjs`、`wb2.mjs`、`webkit.mjs` 没有重叠，尺寸合规 |
| 1c | D1 新增的 headless 测试 | 同一个作品从两条路由打开，面包屑一致 |
| 2 | E2-8 全部 | §10「计费验收」E2 部分；回滚演练（§2.6 第 2 步） |
| 3 | M1 回填 dry-run 记录，B、F 的测试 | 「B 验收」全部条目，F 的验收，`flow.mjs` 端到端
