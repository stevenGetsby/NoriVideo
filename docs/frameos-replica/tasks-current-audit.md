# NoriVideo「我的任务」当前实现审计

审计日期：2026-07-18  
审计范围：页面入口、任务列表、筛选、分页、详情、单条/批量动作、状态机、权限、任务产生、API、数据模型、测试与 FrameOS 视觉差距  
审计原则：只读检查源码与本地运行态；未调用任何任务写接口，未改数据库，未改业务代码

## 1. 结论

当前「我的任务」已经是由 `WorkflowAssignment` 驱动的真实人工协作模块，不是静态占位页。它具备：

- 作品、项目、任务类型筛选。
- 待我处理、审核中、已完成，以及按权限出现的待我审核标签。
- 每页 10 条的服务端分页、独立计数、错误/加载/空态。
- 资产、分镜、视频三类人工任务。
- 分配、重新分配、提交、重新提交、通过、驳回、标记完成、恢复进行中。
- 项目级任务管理面板和同阶段批量分配。
- 任务详情、审核备注和事件时间线。
- 工作区、项目、管理者、审核者和执行人的服务端对象级权限。

但还不能称为完整或生产级 1:1：

1. FrameOS 已确认存在的“分配 / 重新分配 / 恢复进行中”没有回到「我的任务」行内或详情操作区，只存在于项目 Header 的“协作任务”面板。
2. 批量接口允许部分成功，但项目面板把任何 HTTP 200 都提示成“已分配全部任务”，会掩盖逐条失败。
3. 状态写入没有 assignment revision 和 idempotency key；`in_progress -> in_progress` 的并发重新分配尤其可能互相覆盖。
4. 进入工作台时生成了 `from=my-assignments` 和 `from_tab`，目标工作台没有消费它们；用户也不能直接在工作台看到/提交当前 assignment。
5. 没有 assignment 级 SSE；当前依赖 15 秒轮询、窗口 focus 和 visibility 刷新。
6. `sourceTaskId` 是未接线字段，没有 Task / GraphRun 进度、错误和结果投影。
7. API 和组件测试不足：18 个 canonical/兼容任务路由没有 assignment 专项 API 合同测试，页面也没有真实 React 交互或截图回归。

准确表述应为：核心人工任务闭环可用，但管理动作 1:1、并发一致性、批量反馈、工作台闭环、实时性和验证覆盖仍未完成。

## 2. 运行时证据边界

- FrameOS 本地 App 当前位于 `#/my-assignments`，只读截图保存在临时文件 `/tmp/frameos-tasks-current.png`，未提交到仓库。
- 当前 FrameOS 账号只显示“待我处理 / 审核中 / 已完成”，当前筛选下无任务；因此本轮没有重新触发云端详情或写动作。
- FrameOS 运行时确认了：`#0d0d0d` 页面、56px 标题区、46px 筛选区、200×32px 下拉、40px 标签栏、24px 页面边距、40px 表头、242px 空表区，以及列宽 `240 / 92 / 168 / 168 / 168 / 200 / 220`。
- 本地 NoriVideo 普通工作账号页面无法在现有浏览器会话中直接截图：该会话是平台 `super_admin`，访问 3000 的工作前端会回到独立 8080 管理端。因此 Nori 视觉结论由当前 DOM/CSS 与 FrameOS 实机尺寸交叉核对，不宣称完成了同账号像素截图差分。
- 本轮未执行测试；本文的“有测试”表示仓库中存在相应测试文件，不代表本轮重新跑过。

## 3. 端到端数据流

```text
团队项目 / 剧本 / 分集 / Panel 变化
  -> syncProjectAssignmentsForProject()
  -> WorkflowAssignment + WorkflowAssignmentEvent
  -> 项目 Header「协作任务」分配负责人
  -> /my-assignments 跨项目处理
  -> 工作台编辑内容
  -> submit / resubmit
  -> reviewer approve / reject
  -> completed / rejected / reopen
```

人工任务与机器生成任务目前是两条独立链。`WorkflowAssignment.sourceTaskId` 没有被业务代码读取或写入，页面也不展示 BullMQ Task / GraphRun 的进度。

## 4. 逐文件审计：页面与组件

| 文件 | 当前职责 | 当前问题或缺口 |
| --- | --- | --- |
| `src/app/[locale]/my-assignments/page.tsx` | 5 行入口，直接渲染 `FosAssignmentsClient` | 没有服务端预取、页面 metadata 或 route-level 权限；实际登录守卫全部依赖 `FosShell` 客户端会话 |
| `src/components/frameos/FosAssignmentsClient.tsx` | 页面主状态；加载作品、计数和列表；维护筛选、标签、分页、抽屉、审核弹窗和单条动作 | URL 只保存 `tab`，不保存 work/project/stage/page；浏览器前进后退不能完整恢复；作品只取前 50；动作时用全局 `actionId` 禁用全表；无 SSE；页码不自动回退；计数失败时 `countsReady` 永远为 false，审核标签深链存在边缘态 |
| `src/components/frameos/FosAssignmentsTable.tsx` | 真实表格、动态时间列、状态/负责人/备注、操作、空态、错误、加载和分页 | 不支持选择/批量；未渲染 `canAssign` 和 `canReopen`；管理者兼任执行人时 `canSubmit` 会遮住直接 `mark-complete`；所有行按钮会被任一进行中动作一起禁用 |
| `src/components/frameos/FosAssignmentControls.tsx` | 自定义筛选下拉、状态 Chip、备注、420px 详情抽屉、审核弹窗 | 下拉没有 ArrowUp/ArrowDown/Escape/焦点循环；抽屉请求无超时、事件无分页；抽屉没有提交/审核/重开等动作；列表刷新后已打开抽屉不会自动刷新；审核输入前端最多 50 字，后端允许 4000 字；驳回原因仍为选填 |
| `src/components/frameos/assignments-view-model.ts` | 前端 DTO、标签/状态文案、时间列、工作台目的地、回跳参数、事件文案 | 资产任务永远跳到 `assets/characters`，不能定位场景/道具；生成的 `from` / `from_tab` 无消费者；服务端返回 `assigneeKind='member'`，前端类型主要写的是 `subaccount`，虽不影响当前显示但契约不一致 |
| `src/components/frameos/FosProjectAssignmentsDialog.tsx` | 项目级任务管理；阶段/状态筛选；单条分配、重新分配、完成、重开；同阶段批量分配 | 批量响应不读取 `results/okCount`，部分成功会被提示成全部成功；没有批量通过/驳回；请求无统一 15 秒超时；原生 `<select>` 和紫色渐变弹窗与任务页视觉系统不一致；没有取消分配 |
| `src/components/frameos/FosProjectHeader.tsx` | 所有项目工作台 Header 显示“协作任务”入口 | 对所有项目读者都显示入口；无管理权账号打开后只能只读，这不是越权，但入口没有预先表达只读状态 |
| `src/components/frameos/FosShell.tsx` | “我的任务”一级导航、认证、账号状态、侧栏和全局 Header | 展开导航有任务入口；折叠导航只保留画布入口，任务入口消失；`FosTitlebar()` 返回 `null`；共享 Header 中“下载桌面端”和余额弹层“立即充值”无实际动作，后者还明确标注为演示入口 |
| `src/styles/frameos-replica.css` | `fa-*` 任务页与 `fpa-*` 项目任务面板样式 | `fa-*` 主表尺寸高度接近 FrameOS；`fpa-*` 使用蓝紫渐变、14px 圆角，与 FrameOS/Nori 主任务页的扁平黑灰风格不一致；小屏只处理项目弹窗，420px 详情抽屉没有窄屏宽度收敛 |
| `src/app/api/works/route.ts` | 为作品筛选提供分页作品列表 | 任务页固定请求 `page=1&pageSize=50`，超 50 个作品时筛选项不完整 |
| `src/lib/works/service.ts` | 作品对象级读取、项目嵌套和分页 | 服务端可到 100，但任务页没有继续分页；`unassignedProjects` 当前固定返回空数组，任务页为其保留的兼容分支不会在新模型中触发 |

### 4.1 页面真实交互状态

已经接线：

- 筛选下拉、标签切换、分页、行点击详情、去完成/查看。
- 执行人提交与驳回后重新提交。
- 管理者标记完成。
- 审核者通过/驳回及备注。
- 错误重试、部分筛选信息重试、toast、Escape/遮罩关闭。

没有发现 assignment 表格内 `onClick` 为空的假按钮，也没有固定假任务行。当前“死入口”主要是：

- `canAssign`、`canReopen` 已由服务端返回，但「我的任务」表格和抽屉不消费。
- `batch-approve`、`batch-reject` 有 API，无前端调用者。
- `sourceTaskId` 有字段，无业务调用者。
- `from`、`from_tab` 有生成者，无目标工作台消费者。
- 共享 Shell 的“下载桌面端”“立即充值”是可见占位交互，不属于 assignment 状态机本身。

## 5. 状态机

定义文件：`src/lib/collaboration/assignment-policy.ts`

| 当前状态 | 动作 | 下一状态 | 服务端权限 |
| --- | --- | --- | --- |
| `unassigned` | assign | `in_progress` | assignment manager |
| `in_progress` | assign/reassign | `in_progress` | assignment manager |
| `in_progress` | submit | `pending_review`；`submitCompletesDirectly=true` 时为 `completed` | 当前 assignee |
| `in_progress` | mark-complete | `completed` | assignment manager |
| `pending_review` | assign/reassign | `in_progress` | assignment manager |
| `pending_review` | approve | `completed` | assignment reviewer |
| `pending_review` | reject | `rejected` | assignment reviewer |
| `rejected` | assign/reassign | `in_progress` | assignment manager |
| `rejected` | submit/resubmit | `pending_review` 或直接 `completed` | 当前 assignee |
| `rejected` | mark-complete | `completed` | assignment manager |
| `completed` | reopen | `in_progress` | assignment manager |

标签与状态映射：

- 待我处理：当前 assignee 的 `in_progress + rejected`。
- 审核中：当前 assignee 的 `pending_review`。
- 已完成：当前 assignee 的 `completed`。
- 待我审核：当前账号可审核项目中的 `pending_review`。
- `unassigned` 不进入任何人的个人任务页，只在项目管理面板中出现。

状态机缺口：

- 没有 `unassign`，无法恢复到 `unassigned`。
- 没有 submit withdraw。
- 没有独立 `resubmit` 事件类型；后端复用 `submit`，前端靠 `fromStatus=rejected` 翻译为“重新提交”。
- 没有 `revision`、`expectedRevision` 或 idempotency key。
- `updateMany` 只约束 `uuid + status`。多数跨状态并发能被状态变化挡住，但 `in_progress -> in_progress` 的重新分配不改变状态，两个管理员可能都成功写入，后写覆盖前写。
- `assign` / `reopen` 不清理 `lastReviewNote`；之后直接标记完成时，旧驳回意见可能以“已通过”绿色备注展示。
- assignment 创建没有真实 `created` 事件；详情抽屉用 `createdAt` 人工补一条“创建任务”。

## 6. 服务、数据模型和任务产生

### 6.1 核心服务文件

| 文件 | 当前职责 | 审计发现 |
| --- | --- | --- |
| `src/lib/collaboration/assignments.ts` | 筛选解析、列表/计数、详情、同步、候选人、单条/批量写入、事件记录 | 核心服务真实可用；项目任务列表 GET 会调用 `ensureProjectAssignments()` 写库；批量逐条串行且部分成功；无 revision/idempotency；提交时不重新验证当前账号是否仍具有阶段写权限 |
| `src/lib/collaboration/assignment-policy.ts` | 五状态、三阶段、四标签、动作允许边和下一状态 | 状态定义集中且清晰；缺 unassign/withdraw；`assign` 同时承担初次分配、换人和恢复处理 |
| `src/lib/collaboration/access.ts` | workspace actor、作品/项目读权限、assignment manager/reviewer 权限 | 服务端对象权限完整；管理账号、创建人、作品 manager、项目成员能力均可授权；同工作区但无项目读权限的详情请求返回 403 |
| `src/lib/collaboration/assignment-http.ts` | canonical/legacy 查询参数与响应适配，分发读取和写动作 | 同时支持 camelCase 与 snake_case；`count`/`counts`、canonical/legacy 多入口增加维护面；批量始终返回普通 200，前端必须检查逐条结果 |
| `src/lib/account/permissions.ts` | API 外层权限目录 | assignment API 统一只要求 `read`，再由服务层做对象动作授权；这是合理分层，但提交动作没有补充“当前阶段 write 权限”复核 |

### 6.2 Prisma 文件

| 文件 | 当前内容 | 缺口 |
| --- | --- | --- |
| `prisma/schema.prisma` | `WorkflowAssignment`、`WorkflowAssignmentEvent`、Work/ProjectMember ACL | 无 title/description/priority/dueAt/revision/submittedBy/reviewedBy；无 assignment-execution 关联表；`sourceTaskId` 未使用；删除分集会级联删除 assignment 与事件，无法保留 target-missing 历史 |
| `prisma/migrations/20260717110000_add_works_and_workflow_assignments/migration.sql` | 初始作品、成员、任务和事件表 | 初始 event actor 外键为必填，后续 migration 才放宽 |
| `prisma/migrations/20260717113000_relax_collaboration_actor_fks/migration.sql` | actor 删除后事件保留，`actorUserId` 可空 | 事件 payload 只保存 assignee ID，没有姓名/角色稳定快照；账号删除后历史展示会退化为“系统” |

### 6.3 assignment 产生与同步文件

| 文件 | 触发点 |
| --- | --- |
| `src/app/api/projects/route.ts` | 创建 team 项目时事务内创建项目级 asset assignment |
| `src/app/api/novel-promotion/[projectId]/episodes/route.ts` | 新建分集后同步 |
| `src/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route.ts` | 修改或删除分集后同步 |
| `src/app/api/novel-promotion/[projectId]/episodes/batch/route.ts` | 批量分集变更后同步 |
| `src/app/api/novel-promotion/[projectId]/panel/route.ts` | Panel 新增、修改、删除后同步 |
| `src/lib/novel-promotion/project-import-pipeline.ts` | 项目导入完成后同步 |
| `src/lib/workers/handlers/script-to-storyboard.ts` | 分镜 worker 落库后同步 |

同步规则：

- asset：team 项目始终一条项目级 matched assignment。
- storyboard：每集剧本非空或已有 clip 时 matched。
- video：每集至少有一个 storyboard panel 时 matched。
- solo 项目把当前 matched assignments 全部改为 `matched=false`。
- upsert 只更新 `episodeId + matched`，会保留旧 assignee/status；目标重新出现时旧任务可能原状态“复活”。
- `getProjectAssignmentOverview()` 仍保留同步兜底，因此一个 GET 读取接口可能产生/修改数据库记录。

## 7. 筛选、标签和分页

### 7.1 已实现

- 作品 → 项目级联筛选。
- 任务类型：资产设定、分镜设计、视频制作。
- 筛选条件同时用于列表和 counts。
- `matched=true` 同时用于列表与计数，已修复幽灵计数。
- 服务端 pageSize 限制 1–100，页面固定 10。
- 个人任务按 `updatedAt desc`；待审核按 `submittedAt asc`。
- “待我审核”根据当前筛选范围内是否存在可审核项目显示，不是固定角色标签。

### 7.2 缺口

- URL 只同步标签；work/project/stage/page 刷新丢失。
- `routeTab` 仅用于首次 state 初始化，之后浏览器前进/后退改变 query 不会反向同步 `activeTab`。
- 作品选项只取第一页 50 条，当前页 assignment 只能补回少量漏项。
- 作品请求、counts、列表是三个独立请求；没有统一快照或缓存层。
- 当前页最后一条被提交/审核移走后不会自动退回前一页。
- counts 请求失败时，页面会继续展示列表，但审核标签深链可能处于“内容仍是 pending-review、标签却不可见”的边缘状态。
- 空态只有“暂无任务 / 暂无待审核任务”，不能区分“账号确实无任务”和“当前筛选无结果”。
- 没有执行人、日期、优先级或自由文本筛选；其中后几项也没有 FrameOS 当前证据，不能算 1:1 必须项。

## 8. 单条、批量和详情

### 8.1 单条动作

- `submit`、`mark-complete`、`approve`、`reject` 在「我的任务」页有真实按钮。
- `assign`、`reassign`、`reopen` 只在项目“协作任务”面板出现。
- 表格操作时 `Boolean(actionId)` 禁用所有行，而不是只锁当前 assignment。
- 写成功后只增加 `refreshToken`，重新请求 counts 和列表；没有用写响应原子更新当前行。
- 没有 expected revision，所以冲突提示只能依赖状态已变化的通用 409。

### 8.2 批量

- 项目面板支持同阶段批量分配，前端会禁止混合阶段选择。
- 服务端最多 100 条，逐条执行，返回 `{ results, total, okCount }`，允许部分成功。
- 前端 `mutate()` 不解析批量结果；只要 HTTP 200 就显示 `已分配 N 个任务`。这是当前最明确的用户误导 bug。
- `batch-approve`、`batch-reject` canonical/legacy API 都存在，但没有任何前端调用者。
- 批量动作没有 idempotency key；网络重试可能重复生成事件。

### 8.3 详情

- 抽屉宽 420px，保留列表上下文。
- 展示任务、阶段、状态、执行人、项目、分集、分配/提交/完成/更新时间和备注。
- 详情 API 返回从创建到当前的全量事件，按 `createdAt + id` 升序。
- Nori 额外展示事件时间线；这是增强能力，不是当前 FrameOS 运行时已证实的 1:1 要求。
- 详情请求没有超时，事件没有 cursor/limit，大型历史会无限增长。
- 已打开抽屉不会随 15 秒列表刷新同步；只有 assignment prop 改变或点“重试”才重新拉取。
- 抽屉只提供“去完成/查看”，不提供当前服务端允许的 submit/review/reopen/assign。
- 事件 payload 没有姓名快照；actor 删除后显示“系统”，审计可读性下降。

## 9. API 清单

### 9.1 Canonical 读取

| 文件 | 路径 | 用途 |
| --- | --- | --- |
| `src/app/api/collaboration/assignments/my/route.ts` | `GET /api/collaboration/assignments/my` | 当前执行人的 todo/in_review/done 列表 |
| `src/app/api/collaboration/assignments/pending-review/route.ts` | `GET .../pending-review` | 当前账号可审核的 pending 列表 |
| `src/app/api/collaboration/assignments/counts/route.ts` | `GET .../counts` | 四类计数与审核标签能力 |
| `src/app/api/collaboration/assignments/count/route.ts` | `GET .../count` | `counts` 的重复别名，当前 Nori 前端未用 |
| `src/app/api/collaboration/assignments/pending-review-count/route.ts` | `GET .../pending-review-count` | 只返回待审核计数，当前 Nori 页面未用 |
| `src/app/api/collaboration/assignments/list/route.ts` | `GET .../list?projectId=` | 项目任务总览；会触发同步兜底写入 |
| `src/app/api/collaboration/assignments/candidates/route.ts` | `GET .../candidates?projectId=&stage=` | manager 可选负责人 |
| `src/app/api/collaboration/assignments/[assignmentId]/route.ts` | `GET .../:assignmentId` | assignment 快照和全量事件 |

### 9.2 Canonical 写入

| 文件 | 路径 | 前端状态 |
| --- | --- | --- |
| `assign/route.ts` | `POST .../assign` | 项目面板已用 |
| `submit/route.ts` | `POST .../submit` | 我的任务已用 |
| `approve/route.ts` | `POST .../approve` | 我的任务已用 |
| `reject/route.ts` | `POST .../reject` | 我的任务已用 |
| `mark-complete/route.ts` | `POST .../mark-complete` | 我的任务与项目面板已用 |
| `reopen/route.ts` | `POST .../reopen` | 仅项目面板使用 |
| `batch-assign/route.ts` | `POST .../batch-assign` | 项目面板已用，但未处理部分失败 |
| `batch-approve/route.ts` | `POST .../batch-approve` | 无前端调用者 |
| `batch-reject/route.ts` | `POST .../batch-reject` | 无前端调用者 |

以上 canonical action route 都只是 `apiHandler + assignment-http` 的 4 行薄适配器。

### 9.3 FrameOS 兼容入口

`src/app/api/creative/projects/collaboration/assignments/[action]/route.ts` 提供 FrameOS 原前缀兼容层：

- GET：`my / pending-review / counts / pending-review-count / list / candidates`。
- POST：全部单条与 batch 动作。
- 支持 snake_case 参数和 `data` 包装响应。
- 当前 Nori 页面不调用这个前缀；它是兼容边界，不应误判为死接口。

## 10. 权限审计

| 能力 | 当前规则 | 结论 |
| --- | --- | --- |
| 登录/全局 API 门 | assignment 路径统一要求 `read` | 合理；具体动作继续下沉对象授权 |
| 个人列表 | `workspaceOwnerId + assigneeUserId` | 不泄露其他 workspace；若成员关系事后被移除，assignment 仍可能在个人列表出现，进入项目时再被 ACL 拦截 |
| 详情 | 先 workspace 查 assignment，再 `requireProjectReader` | 跨 workspace 为 404；同 workspace 无项目读权为 403 |
| 项目总览 | `requireProjectReader` | 读者可看；manager/reviewer 能力单独返回 |
| 分配/换人/完成/重开 | `requireProjectAssignmentManager` | 服务端真实验权 |
| 通过/驳回 | `requireProjectAssignmentReviewer` | 服务端真实验权 |
| 提交/重提 | 当前 assignee | 缺少当前账号 active 状态和阶段 write 权限复核；角色被改后仍可能提交旧任务 |
| 候选人 | active workspace user + 阶段权限 | 资产要求 `assetWrite`；分镜/视频要求 `storyboardWrite`；管理员全阶段 |
| 停用账号 | 不再进入候选；已有 DTO 标记 disabled | 管理员可换人，但没有专门“停用账号待迁移”队列 |
| `super_admin` | `FosShell` 重定向到独立 Admin 平台 | 不进入 Nori 工作前端，符合账号体系隔离 |

重要边界：前端 capability 只决定按钮是否显示，真正授权在服务端；这一点实现正确。主要缺口是 submit 时没有再次验证执行人仍活跃且仍有该阶段写权限。

## 11. 视觉对照

### 11.1 已对齐部分

当前 `fa-*` CSS 与 FrameOS 实机的核心尺寸基本一致：

- 页面背景 `#0d0d0d`、系统字体、20px/700 标题。
- 标题区 56px、底部间距 16px。
- 筛选区高 46px、左右 24px、项目间距 16px。
- 下拉 200×32px。
- 标签栏 40px、蓝色 `#3b82f6`、2px active bar。
- 内容顶部 14px、表头 40px、空态 202px。
- 表格列宽与 FrameOS 完全采用 `240 / 92 / 168 / 168 / 168 / 200 / 220`。
- 详情抽屉 420px。

### 11.2 明确差距

1. FrameOS 有 32px 桌面 titlebar（居中 FrameOS、右侧刷新）；Nori 的 `FosTitlebar()` 直接返回 `null`，整个任务页纵向上移 32px，也没有刷新入口。
2. FrameOS 折叠导航时页面占满内容宽度，折叠/展开按钮和分隔线在任务标题区；Nori 折叠后仍保留 56px rail，页面表格整体右移 56px，按钮也位于侧栏而不是标题组。
3. Nori 折叠 rail 只保留画布入口，“我的任务”入口消失；FrameOS 当前折叠态至少保留标题区展开入口。
4. FrameOS 下拉是 8px 圆角、14px 文本；Nori task trigger 是 4px 圆角、13px 文本。
5. `fpa-*` 项目任务管理弹窗使用蓝紫渐变与 14px 大圆角，和 `fa-*` 主任务页的黑灰扁平风格明显不同；当前没有 FrameOS 项目管理弹窗实机证据，故这是 Nori 内部一致性问题，不直接宣称为 FrameOS 1:1 缺口。
6. 当前缺少 Nori 普通账号的同视口截图、非空行、详情抽屉、审核弹窗、分页和窄屏截图基线，尚不能给出像素差数值。

Nori 顶部品牌、角色提示和“下载桌面端”与 FrameOS 原品牌不同，属于 Nori 产品层差异；若目标是页面内部 1:1，应把它与任务主体像素验收分开。

## 12. 测试逐文件审计

| 文件 | 已覆盖 | 明显未覆盖 |
| --- | --- | --- |
| `tests/unit/collaboration/assignment-policy.test.ts` | 标签状态映射、关键允许/禁止边、直接完成 | 未穷举全部状态×动作；无 unassign/withdraw/revision/idempotency |
| `tests/unit/collaboration/assignments-service.test.ts` | matched 列表/计数一致、详情事件与 ACL、同步、solo 隐藏、assignee 提交、候选权限、非法转换、驳回重提、审核通过 | 无 reject、mark-complete、reopen、pending reassign、in-progress 并发 reassign、batch 部分成功、page 越界、filters 组合、角色变更后 submit |
| `tests/unit/collaboration/object-access.test.ts` | management 与子账号的 project/work where 形状 | 没直接测 `requireProjectAssignmentManager/Reviewer` 的数据库能力组合 |
| `tests/unit/frameos/assignments-view-model.test.ts` | 时间列、标签、跳转、备注、事件和 count 映射 | 无异常 DTO、时区、asset 子类型目的地、回跳消费 |
| `tests/unit/frameos/assignment-deep-link-contract.test.ts` | 用源码字符串确认 `episode_id` 被工作台接收 | 不是运行时导航测试；没有验证 `from/from_tab`，也没有返回任务页 UI |
| `tests/unit/frameos/project-assignment-management.test.ts` | 用源码字符串确认入口和若干 API 字面量 | 不是 React 交互测试；不能发现批量部分失败误报、权限显示、筛选和按钮忙碌态 |
| `tests/unit/auth/account-permissions.test.ts` | assignment API 外层要求 read | 未覆盖服务层各动作的完整角色矩阵 |
| `tests/unit/guards/api-route-contract-guard.test.ts` | 薄 route 使用 `apiHandler` | 不验证请求/响应、ACL 或状态转换 |
| `tests/contracts/route-catalog.ts` | 登记全部 canonical 和兼容 route | 仅登记不等于行为覆盖 |
| `tests/contracts/route-behavior-matrix.ts` | 把 `user-project-routes` 映射到 `crud-routes.test.ts` | `crud-routes.test.ts` 实际筛选条件不包含 `user-project-routes`；assignment 路由存在“矩阵声称覆盖、测试未枚举”的覆盖假阳性 |
| `tests/integration/api/contract/crud-routes.test.ts` | 资产/asset-hub/novel CRUD 的未登录合同 | 当前没有执行 assignment 路由专项合同 |

目前完全缺失：

- `FosAssignmentsClient/Table/Controls` 的真实组件渲染与用户交互测试。
- canonical 与 legacy assignment API 的 401/403/404/409/成功结构测试。
- admin/writer/asset/storyboard 的端到端角色矩阵。
- 批量部分成功与重试幂等测试。
- 多管理员并发重新分配测试。
- assignment SSE/重连测试（功能本身也不存在）。
- FrameOS/Nori 视觉截图基线和像素差。

`tests/unit/projects/project-route-mass-assignment.test.ts` 名称中的 mass assignment 指 API 字段越权写入防护，不是 `WorkflowAssignment` 批量任务覆盖，不能计入本模块测试。

## 13. 缺口优先级

### P1：正确性与用户误导

1. 批量分配解析 `results`，明确显示成功/失败条数及逐条失败原因，不能把部分成功提示成全部成功。
2. 为 assignment 增加 revision、expectedRevision 和 idempotency key；首先覆盖 `in_progress` 同状态重新分配竞争。
3. submit/resubmit 时复核 assignee 仍为 active 且仍具备对应阶段写权限。
4. 清理或区分 last review note，避免旧驳回意见在直接完成后变成绿色“通过”备注。
5. 修正 route behavior matrix 的 assignment 覆盖假阳性，并补 canonical/legacy API 合同测试。

### P2：FrameOS 闭环与可恢复性

1. 在「我的任务」行内/详情中按 capability 加入分配、重新分配、恢复进行中。
2. 工作台消费 `from/from_tab`，展示返回任务页；同时显示当前 assignment 状态与提交入口。
3. URL 保存 work/project/stage/page，处理浏览器历史和末页回退。
4. 把全表 busy 改成行级 busy，写成功先合并服务端 assignment，再后台刷新。
5. 新增 assignment actor/workspace 级事件流，或至少建立统一缓存失效层。
6. 详情事件分页、请求超时和已打开抽屉实时刷新。
7. 移除 GET 写库主路径，把同步放到所有业务事件，并保留可观测的修复任务。

### P3：进度与视觉收敛

1. 用 execution 关联替代未使用的单一 `sourceTaskId`，展示 Task/GraphRun 聚合进度但不混淆人工状态。
2. 补 titlebar、折叠布局和任务页下拉圆角/字体差异。
3. 统一 `fpa-*` 项目管理弹窗与 `fa-*` 主任务页色系和密度。
4. 建立空态、非空行、详情、审核、分页、错误、加载和窄屏截图基线。
5. 若继续支持英文路由，将当前硬编码中文任务文案迁入 `next-intl`。

## 14. 建议验收门槛

在以下条件满足前，不应把「我的任务」标记为“全部完成”：

- 单条和批量动作不会误报，状态竞争有 revision/idempotency 防护。
- admin、writer、asset、storyboard 四角色的产生、分配、编辑、提交、驳回重提、通过、重开闭环通过。
- 列表、counts、筛选、URL 和分页在动作后保持一致。
- 「我的任务」和目标工作台可双向返回，工作台内可以提交对应 assignment。
- 所有 canonical/legacy route 有真实 API 合同测试。
- 非空任务、详情和审核弹窗有隔离 fixture 的运行时测试。
- FrameOS/Nori 同视口截图差异经过确认；无法安全触发的 FrameOS 写状态继续保持只读。
