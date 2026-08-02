# NoriVideo「我的作品」当前实现审计

审计日期：2026-07-18  
审计范围：当前工作区中的页面、组件、API、数据模型、对象权限、交互状态、视觉结构与自动化测试  
对照基线：`docs/frameos-replica/works-evidence.md` 中的 FrameOS 本地 App 只读证据  
审计方式：源码静态追踪与定向测试；未修改作品业务代码，未执行数据库写入、构建、重启或真实创建/删除操作

## 1. 结论

当前「我的作品」不是静态占位页。作品列表、对象级 ACL、作品与项目 CRUD、成员管理、项目移动、创建项目、剧本导入、集数初始化和画风参考上传都有真实 API 与数据模型。主页面也具备加载骨架、超时、错误重试、空状态、搜索、后台导入遮罩及操作反馈。

本次没有发现可见按钮绑定空回调或 `#` 链接。但实现还不能视为完整收口，主要风险是：

1. 项目删除先清理外部文件/音色、后删除数据库；数据库删除失败时可能留下仍存在但媒体已被删掉的项目。
2. 多个以 `projectId` 保存、却没有 Project 外键的记录不在 Prisma 级联范围内；“生成记录会一并删除”的前端文案大于后端实际保证。
3. 初始剧本导入是请求返回后在 Web 进程中 fire-and-forget，不是持久 Task；进程重启可能让项目长期停在 `pending/processing`，卡片没有失败原因或重试入口。
4. 作品/项目成员的管理权限字段已经存在，但页面和 API 只能添加或移除成员，不能授予、收回或查看细粒度管理权限。
5. 作品 CRUD、成员与移动服务没有直接行为测试；现有相关测试主要是策略函数、源码字符串和建项子契约。

## 2. 页面与文件清单

### 2.1 页面、入口与壳层

| 文件 | 当前职责 | 审计结论 |
| --- | --- | --- |
| `src/app/[locale]/page.tsx` | 登录后的根页面重定向 | 通过 `AUTHENTICATED_HOME_PATHNAME` 进入 `/works` |
| `src/lib/home/default-route.ts` | 登录后首页常量 | 当前固定为 `/works` |
| `src/app/[locale]/works/page.tsx` | 正式「我的作品」页面 | 真实渲染 `FosProjectsClient` |
| `src/app/[locale]/projects/page.tsx` | 旧 `/projects` 兼容别名 | 与 `/works` 渲染同一组件；没有独立行为 |
| `src/components/frameos/FosShell.tsx` | 全局 Header、侧栏、账号状态 | 展开侧栏的「我的作品」指向 `/works`；未登录重定向；`super_admin` 被送往独立管理端 |
| `src/styles/frameos-replica.css` | `works-*`、`create-project-*` 样式 | 有完整桌面与两档响应式结构；仍有已知 FrameOS 视觉差异，见第 9 节 |

### 2.2 主前端组件

| 文件 | 当前职责 | 关键状态/行为 |
| --- | --- | --- |
| `src/components/frameos/FosProjectsClient.tsx` | 页面总状态与所有弹窗编排 | 认证、15 秒超时、请求取消、搜索、加载/错误/空状态、作品/项目操作、创建项目深链 |
| `src/components/frameos/works/FosWorkPanels.tsx` | 作品面板与项目卡 | 作品菜单、项目菜单、批量选择/移动、工作台入口、无限画布入口、导入中遮罩 |
| `src/components/frameos/works/FosWorksDialogs.tsx` | 作品相关弹窗 | 新建作品、重命名、移动、成员查看/编辑、删除确认、候选账号搜索 |
| `src/components/frameos/CreateProjectDialog.tsx` | 创建项目主表单 | 水准、协作、风格、受众、比例、分辨率、时长、剧本来源、画风参考 |
| `src/components/frameos/ProjectStyleReferencePicker.tsx` | 画风图片/视频选择与预检 | 最多 4 个、200MB、视频最多 60 秒、预览、删除、上传进度 |
| `src/components/frameos/works/fetch-all-works.ts` | 聚合 `/api/works` 全部分页 | 合并同 ID 作品/项目并透传 AbortSignal |
| `src/components/frameos/works/types.ts` | DTO 类型与兼容归一化 | 兼容 camel/snake case 和旧未归属作品响应 |
| `src/components/frameos/project-list-state.ts` | 旧列表状态判定函数 | 当前生产组件没有引用，仅测试直接引用，属于残留抽象 |

### 2.3 领域与上传服务

| 文件 | 当前职责 |
| --- | --- |
| `src/lib/works/service.ts` | 作品列表、创建、重命名、删除、移动、成员与候选账号的核心服务 |
| `src/lib/collaboration/access.ts` | 工作区 actor、作品/项目读取范围和 manager/reader 检查 |
| `src/lib/api-auth.ts` | 验证真实账号；把 `actorId` 保留为操作者，把 `session.user.id` 归一为 workspace owner |
| `src/lib/projects/creation-config.ts` | 项目水准、风格、受众、时长、集数范围和描述归一化 |
| `src/lib/projects/validation.ts` | 项目名称/描述公共校验 |
| `src/lib/projects/create-project-request.ts` | 带上传进度的建项请求与画风参考错误定位 |
| `src/lib/projects/style-reference-contract.ts` | 画风参考数量、大小、时长及类型契约 |
| `src/lib/projects/style-reference-upload.ts` | 服务端图片/视频内容校验、上传、MediaObject 登记及失败清理 |
| `src/lib/novel-promotion/project-import-pipeline.ts` | 初始剧本分集、资产解析与持久化；成功/失败更新 `importStatus` |

## 3. 当前数据流

```text
/works
  -> FosProjectsClient
  -> fetchAllWorks(pageSize=50, search)
  -> GET /api/works?page=N&pageSize=50
  -> listWorks(session, filters)
  -> Work + WorkMember + Project + ProjectMember + NovelPromotionProject
  -> normalizeWorksResponse
  -> WorkPanel / ProjectCard
```

`fetchAllWorks` 会按服务端 `totalPages` 把所有页取完，因此当前页面不是虚拟滚动或用户触发翻页。搜索输入 220ms 后既触发服务端搜索，也在客户端再次按作品名/项目名过滤。

创建项目链路为：

```text
CreateProjectDialog
  -> multipart POST /api/projects
  -> 服务端校验剧本与画风参考
  -> 外部存储上传画风参考
  -> 单事务创建 Project + NovelPromotionProject + 空白集/初始协作任务
  -> 事务失败时清理已上传对象
  -> 如导入剧本，响应后直接启动 runProjectImportPipeline()
  -> 前端进入项目工作台
```

其中基础项目、项目配置、MediaObject 索引和指定范围空白集是事务化的；后续 LLM 分集/资产导入不是与建项同一个持久任务。

## 4. API 清单

### 4.1 作品 API

| 方法与路径 | 实现 | 权限 | 当前行为 |
| --- | --- | --- | --- |
| `GET /api/works` | `listWorks` | 已登录 + 对象读取范围 | 分页、作品/项目搜索、稳定总作品数、项目级裁剪、返回能力字段 |
| `POST /api/works` | `createWork` | 任意已登录工作账号 | 创建者自动成为 manager；可同时添加普通成员 |
| `PATCH /api/works/:workId` | `updateWork` | `requireWorkManager` | 仅更新名称，最多 50 字 |
| `DELETE /api/works/:workId` | `deleteWork` | `requireWorkManager` | 仅允许删除空作品 |
| `GET /api/works/:workId/members` | `listWorkMembers` | 作品 reader | 返回创建者与成员状态 |
| `POST /api/works/:workId/members` | `addWorkMember` | 作品 manager | 添加工作区内 active 用户；重复添加为 no-op upsert |
| `DELETE /api/works/:workId/members` | `removeWorkMember` | 作品 manager | 禁止移除创建者 |
| `GET /api/works/member-candidates` | `listMemberCandidates` | 已登录 | 新建作品使用；只返回当前工作区 active 用户 |
| `GET /api/works/:workId/member-candidates` | `listMemberCandidates` | 作品 manager | 搜索候选账号，最多 100/页；前端固定只取 20 条 |
| `POST /api/works/projects/move` | `moveProjects` | 目标作品 manager + 每个源项目管理权 | 同事务批量更新 `Project.workId` |

### 4.2 项目 API（与作品页直接相关）

| 方法与路径 | 当前用途 | 权限与说明 |
| --- | --- | --- |
| `POST /api/projects` | 创建作品内项目 | 已登录；指定 `workId` 时必须是作品 manager |
| `PATCH /api/projects/:projectId` | 项目卡重命名 | `requireProjectManager`；只允许 name/description |
| `DELETE /api/projects/:projectId` | 项目卡删除 | `requireProjectManager`；清理部分外部媒体后删除 Project |
| `GET /api/projects/:projectId/members` | 查看项目协作者 | 项目 reader |
| `POST/DELETE /api/projects/:projectId/members` | 添加/移除项目协作者 | `requireProjectAssignmentManager`；禁止移除创建者 |
| `GET /api/projects/:projectId/member-candidates` | 项目候选账号 | `requireProjectAssignmentManager` |
| `GET /api/projects` | 旧的独立项目列表/统计 API | 当前 `/works` 不使用；仍供其他页面或兼容调用 |

## 5. 数据模型

| 模型 | 关键字段 | 关系/约束 |
| --- | --- | --- |
| `Work` | `workspaceOwnerId`、`createdById`、`name` | workspace owner 与 creator 分离；包含 projects/members |
| `WorkMember` | `workId`、`userId`、`role`、`canManage` | `@@unique([workId,userId])`；作品删除级联 |
| `Project` | `userId`、`workId`、`createdById`、`collaborationMode` | `userId` 是 workspace owner；`workId` 必填且删除作品为 Restrict |
| `ProjectMember` | `projectId`、`userId`、`canManageAssignments`、`canReviewAssignments` | `@@unique([projectId,userId])`；项目删除级联 |
| `NovelPromotionProject` | 水准、风格、受众、时长、参考素材、`importStatus` | 与 Project 一对一，项目删除级联 |

Project 有外键的 `NovelPromotionProject`、Canvas、UsageCost、成员和 WorkflowAssignment 等会随项目级联删除。但以下项目域记录只保存字符串 `projectId`，没有 Project relation，不能依据 Prisma schema 推断会自动删除：

- `Task`、`TaskEvent`、`GraphRun` 及相关运行记录。
- `CanvasWorkflowTemplate`。
- `FrameosMaterial`、`FrameosScript`、`FrameosWorld` 等 FrameOS 表。
- `ServiceUsageRecord` 等弱关联审计/用量表。

这不代表它们一定都必须物理删除；但前端“生成记录会一并删除”的承诺需要明确保留/归档策略，不能依赖当前级联。

## 6. 权限模型

认证层同时维护两个身份：

- `actorId`：真正点击操作的账号。
- `session.user.id` / `workspaceOwnerId`：数据租户 owner。`requireUserAuth` 验证后会把 `session.user.id` 归一为 workspace owner。

因此项目查询使用 `Project.userId = session.user.id` 是租户隔离设计，不是把子账号误当 owner。对象能力由 `actorId`、作品创建者、作品成员和项目成员共同决定。

| 身份/关系 | 读作品/项目 | 管理作品 | 管理项目 |
| --- | --- | --- | --- |
| admin / workspace owner | 工作区全部 | 全部 | 全部 |
| 作品创建者 | 自己作品及其项目 | 是 | 是 |
| `WorkMember.canManage` 或 role=manager | 所属作品全部项目 | 是 | 是 |
| 普通作品成员 | 所属作品全部项目 | 否 | 否，除非另有项目能力 |
| 项目创建者 | 所属项目 | 不自动管理作品 | 是 |
| `ProjectMember.canManageAssignments` | 所属项目 | 否 | 当前实现把它视为项目管理能力 |
| 普通 ProjectMember | 所属项目 | 否 | 否 |

前端管理入口使用后端返回的 `canManage/canMove/canManageMembers`，没有再用全局 admin 标志覆盖，方向正确。`super_admin` 在 `FosShell` 中不会进入工作前端。

## 7. 前端交互与状态矩阵

| 场景 | 已有状态 | 明显缺口 |
| --- | --- | --- |
| 首次加载 | 两个作品面板骨架 | 骨架固定两项，不能反映历史规模；无 reduced-motion |
| 请求超时/失败 | 15 秒 abort、错误卡、重新加载 | 静默刷新失败会用全屏错误替换仍在内存中的旧列表，没有“数据可能已过期”降级态 |
| 空账号 | 暂无作品说明 + 新建作品 CTA | 与 FrameOS 证据中的简洁空态不同，属于 Nori 增强 |
| 搜索 | 作品名/项目名、关键词高亮、清空 | API还搜索项目描述，客户端二次过滤不认描述；搜索时顶栏显示过滤后数量而不是稳定总数 |
| 作品管理 | 新建项目、成员、重命名、批量移动、空作品删除 | 没有修改 WorkMember role/canManage 的入口 |
| 项目卡 | 工作台、画布、成员、重命名、移动、删除 | 固定“剧情模式”；导入失败没有错误标志或重试；没有阶段/集数摘要 |
| 批量模式 | 全选/清空、移动、退出 | 仅单作品内移动；无批量失败明细或并发版本检查 |
| 新建作品 | 名称计数、重名提示、候选成员、多选 | 候选固定首 20 条；会包含当前账号；不能设置成员权限 |
| 成员管理 | 读取、添加、移除、只读查看 | 候选不排除已有成员；批量添加逐个请求，部分成功没有逐项结果；移除使用浏览器原生 confirm |
| 创建项目 | 三类剧本来源、全部配置、画风素材、上传进度、错误 | 编剧剧本加载失败被伪装成“暂无可用剧本”；提交中大部分表单控件仍可改变 |
| 初始导入 | pending/processing 卡片遮罩，成功/失败写状态 | 无持久 task、百分比、失败原因、重新执行入口；进程退出可能遗留 pending |
| 删除项目 | 二次确认、busy、服务端错误 | 外部清理先于 DB 删除；清理范围与确认文案不一致 |

## 8. 明确问题与优先级

### P0/P1：数据完整性与任务恢复

1. **项目删除不是可恢复工作流。** `DELETE /api/projects/:projectId` 先删除百炼音色和存储对象，再执行 `prisma.project.delete()`。若最后一步失败，项目仍在但其媒体已经不可逆地被删除。应改为可重试的删除作业，至少先标记 deleting、事务删除索引、再异步清理，并记录逐对象结果。
2. **项目删除未定义弱关联记录策略。** Task、GraphRun、CanvasWorkflowTemplate、FrameosMaterial、FrameosScript 等没有 Project 外键。应逐表决定删除、匿名保留或归档，并让前端确认文案与策略一致。
3. **初始剧本导入不耐进程重启。** `startInitialProjectImport()` 在请求返回路径内直接启动 Promise，没有 durable Task、lease 或 watchdog。应进入现有 Task/GraphRun 基础设施，并提供状态读取、失败原因和重试。

### P1：权限配置与操作闭环

4. **已有权限字段无法在产品内配置。** WorkMember 的 `role/canManage`、ProjectMember 的 `canManageAssignments/canReviewAssignments` 没有 PATCH API 或 UI。新添加成员只能得到默认普通成员，文案中的“作品管理员”无法通过当前页面授予。
5. **移动弹窗列出无权管理的目标作品。** `MoveProjectsDialog` 只排除虚拟作品和源作品，而服务端要求目标作品 `requireWorkManager`。子账号会看到可以选择、提交后必然 403 的目标；目标列表应按 `work.canManage` 过滤，并解释不可用项。
6. **移除成员没有依赖检查。** 当前直接删除 membership，不检查未完成 WorkflowAssignment、审核责任或仅由该成员可访问的工作。需要明确迁移/解除分配策略。

### P2：状态、搜索和并发

7. **候选账号状态不完整。** 候选查询不排除已有成员/创建者；前端固定 `limit=20` 且不消费 pagination。已有成员会再次显示“+”，大工作区无法浏览第 21 个之后的账号，只能靠搜索命中。
8. **成员批量添加是隐式部分成功。** 前端串行 POST，任一失败即停止；已成功项不会回滚，也不返回摘要。应使用批量 API或显示逐项结果。
9. **搜索契约不一致。** 服务端匹配项目描述，客户端二次过滤仅匹配名称；描述命中会被客户端再次移除。服务端用未过滤总数计算 `totalPages`，搜索时可能请求额外空页；顶栏又改显示 `visibleWorks.length`，与 FrameOS 稳定计数证据不一致。
10. **没有 revision/idempotency。** 重命名、成员变更和移动均是 last-write-wins；移动 updateMany 不验证原 workId。多标签并发时不会提示已发生变化。
11. **审计记录不完整。** Project PATCH/DELETE 有 semantic log，但传入的 ID 是 workspace owner、名称是 actor，可能造成 ID/名称不一致；Work CRUD、成员和移动没有同等级业务审计流。

### P2/P3：交互、文案和视觉

12. **项目重名提示文案写死为“作品”。** `RenameDialog` 在 `kind='项目'` 时仍显示“已有同名作品”。保存按钮也没有在名称未变化时禁用。
13. **编剧剧本读取失败被吞掉。** `/api/video-repaint/scripts` 非 2xx 或异常均落为空数组，用户只能看到“暂无可用剧本”，没有失败/重试态。
14. **提交中没有完整锁定表单。** `CreateProjectDialog` 只阻止关闭和部分点击冒泡，大部分输入/select/button 本身未 disabled；子控件 handler 会先执行，导致请求进行时界面参数还能变化。
15. **菜单与弹窗键盘体验不完整。** 项目菜单没有 menu/menuitem 语义、箭头键/Escape 管理；hover 隐藏容器缺少 `:focus-within`，键盘聚焦时可能不可见。弹窗没有 focus trap 或关闭后的焦点恢复，成员删除图标按钮缺少明确 aria-label。
16. **移动权限变化没有预览。** 项目移到目标作品后会立即继承目标作品成员的可读范围，并失去源作品隐式访问；当前弹窗只写“项目内数据不会改变”，没有说明访问范围会变。
17. **兼容残留未清理。** `resolveProjectListViewState`、`canCreateInsideWork` 在生产源码中没有调用；`memberCount`、候选积分字段没有消费；当前 schema 强制 `Project.workId`，服务仍返回空 `unassignedProjects` 并保留虚拟作品分支。

## 9. 视觉结构对照

当前样式已经复现 FrameOS 的主要骨架：`20px 28px 60px` 页面 padding、220px 搜索框、14px 面板间距、16px 面板/卡片圆角、58px 面板头、170px 项目封面和深色紫黑层级。

仍存在以下明确差异：

- Nori 顶栏 `min-height:42px`、下间距 16px；FrameOS 证据为 36px、20px。
- Nori 作品边框 `rgba(160,114,15,.34)`；FrameOS 为更轻的 `rgba(251,191,36,.16)`。
- Nori 项目标签和日期为 11px；FrameOS 约 12px。
- Nori hover 会抬升 3px、增加重阴影并缩放文件夹；FrameOS 证据只确认边框/图标变蓝。
- Nori 的独立“进入画布”、项目菜单和批量移动是用户要求的增强，不是 FrameOS 当前证据中的原生卡片表面。
- Nori 搜索无结果是大型状态卡；FrameOS 是单行灰字。
- 760px 以下项目配置仍保持两列，极窄视口没有单列断点；创建项目弹窗缺少专门的小屏交互设计。

当前没有 works 页面视觉快照或截图 diff 测试，因此不能声称像素级 1:1。

## 10. 测试证据

2026-07-18 使用 Node 22 定向复跑：11 个文件、35 条测试全部通过。

| 测试文件 | 条数 | 覆盖内容 |
| --- | ---: | --- |
| `tests/unit/auth/account-permissions.test.ts` | 6 | 账号固定权限与作品/成员写操作下放对象 ACL |
| `tests/unit/collaboration/object-access.test.ts` | 2 | workspace owner/actor 读取范围 |
| `tests/unit/frameos/project-list-reliability.test.ts` | 3 | 错误/空状态判定、超时/重试/画布入口源码接线 |
| `tests/unit/frameos/works-create-project.test.ts` | 3 | 创建项目选项、集数范围、对象能力标志源码接线 |
| `tests/unit/projects/project-route-mass-assignment.test.ts` | 3 | Project PATCH 字段白名单与 GET 隐私 |
| `tests/unit/projects/projects-route-workflow-summary.test.ts` | 1 | 旧 `/api/projects` 统计聚合源码接线 |
| `tests/unit/projects/creation-config.test.ts` | 6 | 建项配置、时长、描述、集数范围 |
| `tests/unit/projects/validation.test.ts` | 2 | 名称/描述归一与长度限制 |
| `tests/unit/projects/style-reference-upload.test.ts` | 3 | ISO 视频时长、上传进度、失败索引 |
| `tests/integration/api/specific/project-create-style-references.test.ts` | 4 | 上传、结构化引用、超时长拒绝、失败清理 |
| `tests/integration/api/specific/project-create-default-audio-model.test.ts` | 2 | 默认模型继承与描述校验 |

负向 API 用例会按预期输出结构化 ERROR 日志，本次测试退出码为 0。

### 当前测试空白

- 没有直接 mock/集成测试 `src/lib/works/service.ts` 的 list/create/update/delete/move/member 行为。
- 没有 `/api/works`、作品/项目 members 和 move 路由的请求级测试。
- 没有子账号“可管理源项目但不可管理目标作品”的移动 UI/403 回归。
- 没有项目删除的存储失败、数据库失败、重复执行与弱关联记录清理测试。
- 没有初始剧本导入进程重启、pending 对账、失败重试测试。
- 没有真实组件级键盘、焦点、弹窗、批量部分成功和响应式视觉测试。

## 11. 建议实施顺序

1. 先把项目删除和初始导入迁入可恢复任务，并定义弱关联记录生命周期。
2. 补齐作品/项目成员权限编辑 API 与 UI，再处理成员移除对任务的影响。
3. 修正移动目标过滤、候选分页/去重、搜索契约和部分成功反馈。
4. 补服务/API 行为测试与并发条件，再做 FrameOS 视觉和键盘交互收口。

