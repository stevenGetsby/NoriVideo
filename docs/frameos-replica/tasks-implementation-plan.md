# FrameOS「我的任务」实现计划

更新时间：2026-07-17  
状态：基于 NoriVideo 当前代码的实施基线；FrameOS 原生 App 深度取证完成后再补充像素与交互差异，不以本文件替代原 App 证据。

## 1. 目标与非目标

目标是把「我的任务」建设成完整的人工协作闭环：任务可被可靠地产生、分配、执行、提交、审核、驳回后重提、重开，并在跨项目页面中实时更新；同时可以关联机器生成任务的进度，但不混淆人工任务和 BullMQ 任务的状态语义。

本轮不得把以下三个领域合并成同一张表或同一套状态：

- `WorkflowAssignment`：人工责任、执行人、审核人和交付状态。
- `Task`：一次 BullMQ 机器执行及其排队、进度、错误、计费状态。
- `GraphRun`：一个多步骤 AI 工作流及其步骤、attempt、事件、产物和恢复状态。

「我的任务」以 `WorkflowAssignment` 为列表主数据。`Task` / `GraphRun` 只能作为任务执行证据和进度投影出现。

## 2. 当前基线与必须优先修复的问题

当前入口和核心文件：

- 页面：`src/app/[locale]/my-assignments/page.tsx`
- 页面状态：`src/components/frameos/FosAssignmentsClient.tsx`
- 表格：`src/components/frameos/FosAssignmentsTable.tsx`
- 抽屉与弹窗：`src/components/frameos/FosAssignmentControls.tsx`
- 视图模型：`src/components/frameos/assignments-view-model.ts`
- 后端：`src/lib/collaboration/assignments.ts`
- 状态机：`src/lib/collaboration/assignment-policy.ts`
- HTTP 适配：`src/lib/collaboration/assignment-http.ts`

实施前必须承认并修正以下断点：

1. 项目创建只产生未分配的资产任务；未分配任务不会进入任何人的「我的任务」。
2. 分镜和视频任务只在 `listProjectAssignments()` 被调用时惰性补建，当前 Nori 前端没有任务分配管理入口。
3. 驳回后任务进入 `rejected`，但 `submit` 只接受 `in_progress`，执行人无法重新提交。
4. `matched=false` 的任务被前端过滤，服务端 `total` 却包含它们，计数和行数不一致。
5. 执行人被停用或删除后，进行中任务不能重新分配。
6. 候选执行人没有按任务阶段所需写权限过滤，可能出现“能接任务、不能编辑”的死路。
7. `sourceTaskId` 未使用，人工任务不会显示真实生成进度，也不会从生成结果得到完成证据。
8. 页面没有 assignment 级实时事件；分配、审核和驳回不会自动刷新。
9. 事件表只写不读，详情抽屉看不到任务时间线。
10. 后端已有批量接口、重开接口和候选人接口，但当前前端没有入口。

## 3. 数据模型

### 3.1 `WorkflowAssignment` 保留字段

保留：

- `uuid`
- `workspaceOwnerId`
- `projectId`
- `episodeId`
- `scopeId`
- `stage`
- `status`
- `assigneeUserId`
- `assignedById`
- `assignedAt`
- `submittedAt`
- `completedAt`
- `lastReviewNote`
- `matched`
- `createdAt`
- `updatedAt`

### 3.2 建议新增字段

以下字段是否在第一阶段启用，需以 FrameOS 原 App 证据确认；数据层先保留可演进边界：

- `title`：可选自定义任务标题；为空时由阶段和分集派生。
- `description`：任务说明。
- `priority`：`low | normal | high | urgent`。
- `dueAt`：截止时间。
- `submittedById`：不能用当前 assignee 推断历史提交人。
- `reviewedById`、`reviewedAt`：保留最后一次审核快照。
- `revision`：乐观并发版本；每次状态或分配变更递增。
- `archivedAt`：避免把历史删除等同于物理删除。

### 3.3 机器任务关联

不要继续依赖单一 `sourceTaskId` 作为长期模型。一个人工任务可能触发多张资产图、多集分镜或多个视频任务，建议新增关联表：

```text
WorkflowAssignmentExecution
- id
- assignmentUuid
- taskId              // 可空，指向 Task
- runId               // 可空，指向 GraphRun
- kind                // primary | evidence | retry | auxiliary
- attachedById
- createdAt
```

约束：

- `@@unique([assignmentUuid, taskId])`
- `@@unique([assignmentUuid, runId])`
- 删除 Task/Run 时保留人工事件中的历史快照；关联可 `SET NULL`。
- 人工任务状态不能仅因 Task 完成而自动变成 `completed`；机器结果只提供“可提交”证据。

### 3.4 事件模型

`WorkflowAssignmentEvent` 应成为不可变审计流，至少支持：

- `created`
- `assigned`
- `unassigned`
- `reassigned`
- `submitted`
- `resubmitted`
- `approved`
- `rejected`
- `marked_complete`
- `reopened`
- `assignee_disabled`
- `target_missing`
- `execution_attached`
- `execution_progress`
- `execution_completed`
- `execution_failed`
- `comment_added`（仅当 FrameOS 证据确认存在评论）

事件 payload 必须是展示所需的稳定快照，不依赖事后查询已被删除的账号或项目名称。

## 4. 状态机

### 4.1 人工任务状态

```text
unassigned
  -> in_progress        assign

in_progress
  -> unassigned         unassign
  -> in_progress        reassign（执行人改变，revision 递增）
  -> pending_review     submit
  -> completed          mark-complete（有管理权限）

pending_review
  -> completed          approve
  -> rejected           reject
  -> in_progress        withdraw（仅提交人，若 FrameOS 支持）

rejected
  -> pending_review     resubmit
  -> in_progress        reassign / resume
  -> completed          mark-complete（有管理权限）

completed
  -> in_progress        reopen
```

### 4.2 驳回重提的硬性规则

- 执行人必须能从 `rejected` 直接执行 `resubmit`，不能要求管理员先重新 assign。
- `resubmit` 写入新的提交事件，并保留历史驳回意见。
- 列表中的“重新提交”按钮只在服务端 `canResubmit=true` 时出现。
- 重新提交后清空当前快照的 `completedAt`，更新 `submittedAt`，但不删除历史事件。

### 4.3 并发和幂等

所有写操作携带：

- `assignmentId`
- `expectedRevision`
- `idempotencyKey`

更新条件至少包含 `uuid + current status + revision`。冲突返回 `409 ASSIGNMENT_VERSION_CONFLICT`，响应附带最新 assignment，前端展示“任务已被他人更新”并合并刷新。

批量操作是逐条幂等的部分成功模型，不伪装成全事务；返回每条结果及统一摘要。

## 5. 任务产生与一致性

### 5.1 禁止仅靠列表查询惰性补建

将当前 `ensureProjectAssignments()` 拆成可重复调用的同步服务，但在以下业务事件后主动执行：

- 团队协作项目创建完成。
- 初始剧本导入完成、分集产生。
- 新建或删除分集。
- 剧本从空变为可用，或被清空。
- 分镜从空变为可用，或被清空。
- 项目协作模式从自由协作切到任务分工。

列表 GET 不应承担主要写入职责；如保留兜底，只能异步修复并记录审计日志。

### 5.2 匹配状态

- 服务端列表默认排除 `matched=false`，计数必须使用相同 where 条件。
- 管理界面可用显式筛选查看“目标已失效”的任务，以便归档或修复。
- 前端不得再次静默过滤服务端行。
- 分集删除应由事务或级联同步处理，不能留下计数幽灵。

### 5.3 任务分配入口

项目工作台必须提供任务分配面板：

- 资产：项目级任务。
- 分镜：分集级任务。
- 视频：分集级任务。
- 可按阶段/分集单条或批量选择。
- 支持未分配、分配、换人、取消分配、批量分配。
- 显示禁用账号并阻止新分配；已有任务提供迁移操作。

## 6. API 设计

### 6.1 列表与计数

```text
GET /api/collaboration/assignments/my
GET /api/collaboration/assignments/pending-review
GET /api/collaboration/assignments/counts
```

公共查询参数：

- `tab`
- `workId`
- `projectId`
- `stage`
- `status`
- `assigneeUserId`（仅管理视图）
- `cursor` 或 `page/pageSize`
- `includeUnmatched=false`

要求：

- 列表与 counts 共用同一个 filter builder。
- 返回服务端派生能力：`canSubmit/canResubmit/canReview/canReopen/canReassign/canUnassign`。
- 返回 `revision`。
- 作品筛选不能固定读取前 50 项；使用专用 filter-options API 或分页加载。
- 页码超过末页时服务端返回校正后的合法页，或前端收到总数后主动回退。

### 6.2 详情与事件

```text
GET /api/collaboration/assignments/:assignmentId
GET /api/collaboration/assignments/:assignmentId/events?cursor=&limit=
```

详情响应包含：

- assignment 完整快照
- 项目/作品/分集摘要
- 当前执行人和审核能力
- 关联 Task/Run 的当前聚合进度
- 最近事件；更多事件分页加载
- 可执行动作列表，而不是让前端自行猜状态机

### 6.3 写操作

建议收敛为资源动作路由，同时在过渡期保留现有兼容入口：

```text
POST /api/collaboration/assignments/:id/actions/assign
POST /api/collaboration/assignments/:id/actions/unassign
POST /api/collaboration/assignments/:id/actions/reassign
POST /api/collaboration/assignments/:id/actions/submit
POST /api/collaboration/assignments/:id/actions/resubmit
POST /api/collaboration/assignments/:id/actions/approve
POST /api/collaboration/assignments/:id/actions/reject
POST /api/collaboration/assignments/:id/actions/mark-complete
POST /api/collaboration/assignments/:id/actions/reopen
POST /api/collaboration/assignments/batch-actions
```

每个写响应返回最新 assignment、追加事件以及新的 counts delta，便于前端原子更新缓存。

### 6.4 实时事件

现有 `/api/sse?projectId=` 是机器 Task 的 project 级流，不适合跨项目「我的任务」。新增：

```text
GET /api/collaboration/assignments/events?afterId=
```

通道按 `workspaceOwnerId + actorId` 过滤，事件至少包含：

- assignment id、project/work id
- event type
- from/to status
- assignee/reviewer actor id
- revision
- counts delta
- 更新时间

连接策略：

1. 首连返回当前账号相关 active assignment 快照。
2. 支持 `Last-Event-ID` / `afterId` 回放。
3. 断线自动重连。
4. 终态和分配变化立即失效列表与 counts。
5. 机器进度高频事件节流，不为每个百分比刷新整张列表。

## 7. 权限与候选人规则

### 7.1 路由权限

协作动作继续使用对象级授权，但服务端必须同时验证账号有效状态和任务阶段写能力。

- 查看：工作区 `read`。
- 提交/重提：当前执行人，且具备该阶段写权限。
- 分配/换人/取消分配/标记完成/重开：assignment manager。
- 通过/驳回：assignment reviewer。

### 7.2 阶段能力映射

以权限而不是显示角色名做最终判断：

```text
asset      -> assetWrite
storyboard -> storyboardWrite
video      -> storyboardWrite
```

管理员拥有全部能力。候选列表默认只返回满足阶段写权限的活跃账号；若 FrameOS 允许跨角色分配，必须明确展示“只读，无法完成该阶段”的阻断提示，不能静默允许。

### 7.3 账号停用或删除

- 停用账号后，其 active assignments 进入管理员待处理队列。
- 允许管理员从 `in_progress/rejected/pending_review` 安全换人。
- 删除账号后事件 actor 可为空，但事件 payload 保留姓名快照。
- 不得留下 `assigneeUserId=null + status=in_progress` 的永久死任务。

## 8. 前端状态与交互

### 8.1 页面查询模型

- URL 保存 `tab/work/project/stage/page`，支持刷新、浏览器前进后退和分享。
- counts、列表、筛选选项使用独立缓存键，但共享规范化 filters。
- 不做客户端二次过滤来改变服务端 total。
- 操作按行锁定，而非一个任务操作时禁用全表。
- 写成功后先应用服务端返回快照，再后台校验列表与 counts。

### 8.2 列表与空态

需要区分：

- 当前标签确实无任务。
- 有任务但被筛选条件过滤。
- 数据加载失败。
- 部分 counts/筛选项加载失败。
- 目标项目或分集已删除。
- 账号无该任务写权限。

不得用同一个“暂无任务”覆盖以上状态。

### 8.3 详情抽屉

至少显示：

- 任务层级：作品 → 项目 → 分集 → 阶段。
- 当前状态、负责人、分配人、审核人。
- 分配、提交、完成、更新时间。
- 审核意见完整文本。
- 关联机器任务聚合进度、失败原因和结果入口。
- 事件时间线。
- 服务端返回的可执行动作。

### 8.4 跳转工作台

- `episode_id` 必须继续传递。
- `from=my-assignments` 与 `from_tab` 必须在目标工作台消费，展示“返回我的任务”。
- 资产任务需要根据 scope 或最近编辑目标跳转角色/场景/道具，而不是永远进入角色页。
- 工作台应显示当前 assignment 状态和提交入口，避免用户完成内容后再返回列表寻找按钮。

### 8.5 审核和危险动作

- 驳回原因是否必填、最大长度、字符计数必须与服务端一致。
- 通过/驳回弹窗显示任务标识、负责人和本次动作结果。
- 最终确认按钮防重复提交并携带 idempotency key。
- 本地关闭弹窗、Escape、点击遮罩不得触发写操作。

## 9. Task / GraphRun 进度集成

### 9.1 聚合规则

人工任务行可展示：

- 无执行：不显示机器进度。
- 单个 active Task：显示百分比、阶段、预计剩余时间（只有可验证估算时）。
- 多个 Task：显示 `已完成/总数` 和加权百分比。
- 关联 GraphRun：显示当前 step、step index/total、失败 step。
- 机器失败：不自动把人工任务改为 `rejected`；显示“生成失败”附重试入口或工作台入口。

### 9.2 取消与重试边界

- 取消机器 Task 需要 `admin` 或对应业务写权限，且必须支持 cooperative cancellation。
- 人工任务不提供“取消 BullMQ 即取消人工任务”的隐式耦合。
- GraphRun step retry 仅对明确支持的 workflow type 开放。
- 重试产生新的 Task attempt / execution link，不覆盖历史证据。

## 10. 测试方案

### 10.1 状态机单元测试

覆盖每个允许和禁止的边：

- assign / unassign / reassign
- submit / resubmit
- approve / reject
- mark-complete / reopen
- submitCompletesDirectly（若保留）
- stale revision 冲突
- 幂等请求重复到达

重点回归：

- rejected 执行人可以重提。
- 删除/停用执行人后管理员可以换人。
- 进行中任务不能被无权限用户接管。

### 10.2 服务测试

- 团队项目创建后生成正确 assignment。
- 初始导入完成后生成每集 storyboard/video assignment。
- 新增/删除分集同步任务。
- 剧本/分镜由空变非空时更新 `matched`。
- list 和 counts 对同一 filters 完全一致。
- 候选人按阶段权限过滤。
- batch 部分成功结果稳定且幂等。
- 每次状态变更写入正确事件快照。

### 10.3 API 合同测试

所有 GET/POST 路由至少覆盖：

- 未登录 401。
- 工作区越权返回 404，避免泄露对象存在性。
- 角色/对象权限不足 403。
- 参数错误 400。
- revision 冲突 409。
- 合法成功响应结构。
- legacy snake_case 兼容合同。
- SSE 首次快照、回放、跨账号隔离。

### 10.4 React 组件测试

- URL 与 tab/filter/page 双向同步。
- 三种基础标签及审核标签的可见条件。
- 每个标签的列定义。
- counts 变化和标签 badge。
- 列表/筛选/错误/空态。
- 详情抽屉、Escape、遮罩关闭。
- 审核弹窗输入、字符上限、忙碌态。
- 单行操作不禁用全表。
- 实时事件只更新受影响行与 counts。
- 页码在最后一条移走后回退。

### 10.5 端到端角色矩阵

至少准备 admin、writer、asset、storyboard 四个账号：

1. admin 创建任务分工项目。
2. admin 分配资产、分镜、视频任务。
3. 每个子账号只能编辑对应领域并提交自己的任务。
4. reviewer 收到待审核任务。
5. 驳回后原执行人修改并重新提交。
6. 通过后双方列表和 counts 实时变化。
7. admin 重开已完成任务。
8. 禁用执行人后 admin 换人。
9. 跨工作区无法读取、操作或订阅任务事件。

### 10.6 视觉回归

- 固定 FrameOS 原生 App 视口和 Nori 视口。
- 为每个标签、下拉、非空行、空态、详情抽屉、审核弹窗、分页、窄屏保存截图基线。
- 对关键区域做像素差；字体渲染差异单独设置小阈值，布局、色值和尺寸不放宽。
- 测试数据必须是隔离 fixture，不操作真实 FrameOS 云端任务。

## 11. 分阶段实施顺序

### Phase A：打通正确性

1. 修复驳回重提状态机。
2. 主动同步 assignment 产生时机。
3. 修复 matched/list/count 一致性。
4. 增加换人和取消分配。
5. 完成候选人阶段权限过滤。
6. 补齐服务和 API 合同测试。

### Phase B：任务管理闭环

1. 项目级分配面板。
2. 单条与批量分配。
3. 详情事件 API 与时间线。
4. 已完成重开、停用账号迁移。
5. 工作台内 assignment 状态和提交入口。

### Phase C：实时与执行进度

1. workspace/actor 级 assignment SSE。
2. Task/GraphRun 关联表和聚合读模型。
3. 行级实时进度、错误和恢复。
4. 刷新、断线重连和事件回放测试。

### Phase D：FrameOS 像素与细节收敛

1. 根据 `tasks-evidence.md` 校准 DOM、尺寸、字体、色值、阴影和层级。
2. 补齐原 App 所有安全可触发子模块。
3. 对无法安全触发的最终业务动作使用隔离 fixture 验证。
4. 建立截图基线和差异门槛。

## 12. 完成门槛

只有同时满足以下条件才能声明「我的任务」完成：

- 正常产品路径可以产生并分配资产、分镜、视频任务。
- 四角色端到端矩阵通过。
- 驳回后可以由原执行人重新提交，无管理员人工修复。
- list、counts、筛选和分页始终一致。
- 分配、提交、审核、重开在其他在线客户端实时可见。
- 事件历史可追溯且跨账号隔离。
- 机器进度与人工状态边界清晰，刷新后可恢复。
- 所有 canonical assignment API 有合同测试。
- 关键 UI 状态有组件测试和 FrameOS 像素截图基线。
- 真实 FrameOS 云端数据在探索和回归过程中未被修改。
