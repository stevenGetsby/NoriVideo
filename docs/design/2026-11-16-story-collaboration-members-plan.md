# 影游画布：协作成员（把别人拉进来一起做）设计与实现文档

日期：2026-11-16　角色：协作/权限设计 → 交给实现 agent。本文自成一体，照做即可，不需要再问用户。

## 这份文档在解决什么

用户的原话：**「现在影游画布项目创建人不能拉其他的人进来协同工作」**。

先说结论，因为它决定了改造范围：**权限层没有拦人，是界面上根本没有「成员」这个入口。**

证据链（下面每一处都在本文用 file:line 锚定）：

1. `src/features/interactive/` 目录里搜 `成员|邀请|协作|/members|member-candidates`，**零命中**。影游的列表页（`InteractiveHub.tsx`）、剧情画布（`StoryOverview.tsx`）、作品画布（`StoryWorksCanvas.tsx`）、章节画布（`StoryProductionCanvas.tsx`）都没有任何成员入口。
2. 仓库里唯一能加成员的地方是 `FosProjectsClient.tsx:616` 的项目成员对话框，它挂在 `/works`。而 `/api/works` 默认只返回 `productLine: 'canvas'`（`src/lib/works/service.ts:145`），`FosProjectsClient.fetchWorks`（`FosProjectsClient.tsx:142`）没有传 `productLine`，所以**影游项目根本不会出现在 `/works` 列表里**，那个「设置成员」入口对影游是死的。
3. 影游创建人的权限其实够了：`createInteractiveStory` 要求 `actor.isManagement || actor.projectLeader`（`src/lib/interactive/service.ts:226`），而 `canAccessWork` 对这两类账号直接返回 `true`（`src/lib/permissions/resolve.ts:56`）。所以创建人今天就已经持有 `workMemberManage`，`POST /api/works/[workId]/members` 现在就能成功——只是没有人能点到它。
4. 唯一缺的后端字段：`getInteractiveStory` 只回 `canManage: access.canManage` 和 `canCreateChapters: access.canCreateProjects`（`src/lib/interactive/service.ts:333-334`），**没有 `canManageMembers`**，所以前端就算加按钮也不知道该给「设置」还是「查看」。

由此得出本文的两条边界，请实现时守住：

- **不动权限模型**：`WORK_MEMBER_PERMISSIONS`、`PROJECT_OWNER_PERMISSIONS`、`canAccessWork`、`effectiveWorkMemberPermissions` 一行不改。理由见 §A.2。
- **不加章级协作**：影游的「章」是挂在项目（`Work`）下的作品（`Project`），项目级成员已经能进所有章。加作品级协作者属于另一个功能，写进部署记录的建议即可。

## 全部功能改动一览

| # | 现状 | 改完创作者看到什么 | 章节 | 批次 |
|---|---|---|---|---|
| 1 | 剧情画布顶栏只有「新建章节 / 全剧试玩」，没有成员 | 顶栏多一个「协作成员」按钮，点开就是现成的成员管理对话框 | §B.1 §B.2 | 一 |
| 2 | `/api/interactive/[workId]` 不返回 `canManageMembers`，前端无从判断 | payload 多一个 `canManageMembers`，创建人看到「设置协作成员」，其他人看到「查看协作成员」 | §B.3 | 一 |
| 3 | 影游列表卡没有成员数，看不出这个项目有几个人 | 卡片元信息多「N 人协作」（仅当 >1 时显示） | §C | 二 |
| 4 | 成员对话框底部写的是「项目组长可创建项目并随时增删成员」，放在影游里语义错位（影游的章不是在这里建的） | 影游复用同一个对话框，但底部说明改成影游语义 | §B.4 | 二 |
| 5 | 成员候选为空时只显示「暂无数据」，创建人不知道要先建子账号 | 空态提示「没有可添加的账号。请先在账号管理里创建子账号，再回到这里添加。」 | §B.5 | 二 |
| 6 | 项目组长身份被管理员撤掉后，连创建人都进不了成员管理，只能找管理员 | 不自动兜底，但在只读对话框里明确告诉用户找谁（文案见 §B.6） | §B.6 | 二 |
| 7 | 新增成员后没有任何反馈 | 保存成功后对话框内出现「已添加 N 位成员，他们现在可以在影游列表中看到这个项目」 | §D.2 | 三 |

## 执行规则

- **R1 复用，不重写**：成员对话框、候选搜索、变更集、端点拼装、样式全部复用现有实现（`src/components/frameos/works/FosWorksDialogs.tsx:521` 的 `MemberManagerDialog`、`member-candidates.ts`、`member-change-set.ts`、`frameos-replica.css`）。**禁止**为影游另写一套成员 UI，也禁止改动 `MemberManagerDialog` 的对外 props 语义（只允许按 §B.4/§B.5 增加可选 prop）。
- **R2 不动权限模型**：见 §A.2。任何「顺手把 `workMemberManage` 加进 `WORK_MEMBER_PERMISSIONS` 让成员也能加人」的改动都是错的，会连带影响 `/works` 的既有行为并有单测拦着（`tests/unit/collaboration/object-access.test.ts:182`）。
- **R3 不动数据库**：`WorkMember` / `ProjectMember` schema 一字不改。影游不需要 `ProjectMember` 行（见 §A.3）。
- **R4 payload 只增不改**：`getInteractiveStory` 的返回值只允许新增字段，禁止改名、禁止改变既有字段语义（`canManage` / `canCreateChapters` 是什么意思，改完还是什么意思）。新增字段在 `OverviewStory` 里声明为**可选**（`canManageMembers?: boolean`），这样 `tests/unit/interactive/story-overview-model.test.ts:24`、`tests/browser/*.fixture.tsx` 里那一堆手写 fixture 不用逐个补字段也能编译。
- **R5 未定义即只读**：前端一律以 `story.canManageMembers === true` 作为可写条件。`undefined` / `null` / 缺字段一律当**只读**处理，绝不当成可写。这是权限类字段，方向不能反。
- **R6 两个只读概念不许混**：`readOnly = !hasAccountPermissions(session?.user || {}, ['canvasWrite'])`（`StoryOverview.tsx:28`）是**账号能力**（这个人有没有画布写权限），`canManageMembers` 是**项目关系**（这个人管不管得了这个项目的成员）。「协作成员」按钮的可点性只看 `canManageMembers`，**不要**跟 `readOnly` 与门，否则 `reviewer` 角色的创建人就再也管不了自己的成员了。
- **R7 不加邀请制**：本项目没有邮件/链接邀请，成员必须是同工作区、状态 `active` 的已有账号（`listMemberCandidates` → `workspaceUserWhere(actor.workspaceOwnerId)`，`src/lib/works/service.ts:447`）。文案必须说清「先建子账号」，不要让用户以为能发邀请。**禁止**自行实现邀请码/邀请链接/待接受状态。
- **R8 三个批次各自可独立上线**：批次一上完，用户的核心诉求就解决了；批次二、三是打磨。任何一批做不完，前面的必须能独立跑通。
- **R9 不许自行加功能**：不加审批流、不加成员角色下拉（`readWorkMemberGrant` 明确拒绝 `role`/`permissions`，`src/lib/works/service.ts:59-64`，放开就是修改权限模型）、不加「成员操作日志」、不加通知系统。
- **R10 文档与代码不一致就停**：任何 file:line 锚点对不上（说明代码已经被人改过），停下来回报，不要按自己的理解猜着改。

## 全局逻辑红线

1. **不能移除创建人**：`removeWorkMember` 已经有 `'不能移除项目创建者。'`（`src/lib/works/service.ts:548-551`），前端 `buildMemberChangeSet` 也已经把创建人和管理账号保护起来（`member-change-set.ts:11-17`）。改完必须还是这个行为，影游也不例外。
2. **成员只能被加进这个工作区**：候选接口只会返回同工作区的账号，`addWorkMember` 里还有 `requireActiveWorkspaceUser`。**不要**在前端做「按 ID 直填」之类的旁路。
3. **一次一个**：增删都是一次一个 `{userId}` 的 POST / DELETE 循环（`FosWorksDialogs.tsx:570-593`），没有批量接口，也不要新写批量接口。中途失败时已经成功的要保持成功（现有行为），错误提示要说清是「添加 X 失败」还是「移除 X 失败」。
4. **成员权限的真相**：新加进来的成员拿到的是 `WORK_MEMBER_PERMISSIONS = ['projectCreate','projectManage']`（`src/lib/permissions/catalog.ts:15`）。对影游来说这意味着：能看到影游（`workParticipantWhere` 含 `members.some`，`src/lib/collaboration/access.ts:34-41`）、能进所有章、能新建章节、能改剧情配置；**不能**改名（要 `canManage`）、**不能**换画幅、**不能**管成员。这是设计如此，不是 bug。
5. **不动 `productLine`**：不要为了让影游出现在 `/works` 里而去改 `listWorks` 的默认值（`src/lib/works/service.ts:145`）。影游有自己的一等入口，把两种产品线混进同一个列表是这个项目明确避免的事。

---

## §A 现状与判断依据（实现前先读，改的时候不用再查）

### §A.1 已经存在、直接能用的一整条链路

| 环节 | 位置 | 状态 |
|---|---|---|
| 成员对话框 | `src/components/frameos/works/FosWorksDialogs.tsx:521` `MemberManagerDialog` | 可用，props：`{title, endpoint, candidatesPath, readOnly, onClose, onChanged}` |
| 成员列表接口 | `src/app/api/works/[workId]/members/route.ts` GET | `listWorkMembers`，**任何参与者都能读**（`requireWorkManagerOrReader`，`src/lib/works/service.ts:517`） |
| 添加成员 | 同文件 POST | `requireWorkMemberManager` + `requireActiveWorkspaceUser` |
| 移除成员 | 同文件 DELETE | 同上 + 拒移除创建人 |
| 候选搜索 | `/api/works/[workId]/member-candidates` | `listMemberCandidates`，`requireWorkMemberManager`（`src/lib/works/service.ts:434`） |
| 端点拼装 | `FosWorksDialogs.tsx:735` `workMembersEndpoint` / `:739` `workMemberCandidatesEndpoint` | 直接可用 |
| 变更集 | `src/components/frameos/works/member-change-set.ts` | 直接可用 |
| 样式 | `src/styles/frameos-replica.css`（`works-member-*` / `works-candidate*` / `works-selected-members`） | 已通过 `src/app/globals.css:6` 全局引入，影游页面直接可用 |

结论：**不需要写任何新的后端接口。** 需要补的只有 `getInteractiveStory` 的一个字段，和影游页面上的一个按钮。

### §A.2 为什么不动权限模型

三条硬事实：

- `canAccessWork` 的 `_work` 参数是故意不用的（`src/lib/permissions/resolve.ts:52`），所以 `work.createdById` 在工作区层面不授予任何权限。成员管理只能来自 `isManagement`、`projectLeader`、或成员的 `permissions` 数组。
- `effectiveWorkMemberPermissions` 把成员的 `permissions` **过滤**成只剩 `projectCreate` / `projectManage`（`src/lib/permissions/resolve.ts:31-34`），所以即使有人在 DB 里给某个 `WorkMember.permissions` 塞了 `workMemberManage`，也会被过滤掉。这是刻意的安全设计。
- `tests/unit/collaboration/object-access.test.ts:182` 有一条单测专门锁这个行为：`'revokes member administration immediately when projectLeader is removed'`。

对影游创建人来说，这条限制**不构成障碍**：创建影游必须先成为项目组长或被管理员（`src/lib/interactive/service.ts:226-229`），而这两类正是 `canAccessWork` 直接放行的账号。所以「创建人不能拉人」100% 是 UI 缺失。

真要放开「成员也能邀请人」，那是**产品决策**，会同时影响画布项目的既有行为，必须由用户拍板。写进部署记录的建议，不要在本批次自行实现。

### §A.3 为什么不需要 `ProjectMember` 行

影游的「章」是 `Project`，作品可见性走 `projectReadScopeWhere` → `visibleProjectsWhere` → `projectParticipantWhere` → `workParticipantWhere`（`src/lib/collaboration/access.ts:34-53`）。也就是说，**只要在 `WorkMember` 里有行，这个账号就能进这个项目下的全部章**。`insertChapter`（`src/lib/interactive/service.ts:200-222`）不写 `ProjectMember` 是符合设计的，不要「顺手补上」。

### §A.4 新成员进来看得到什么、点得动什么

| 位置 | 需要什么 | 新成员（子账号且含 `canvasWrite`） |
|---|---|---|
| `/interactive` 列表能看到这个影游 | `workReadScopeWhere` 命中 `members.some` | ✅ |
| 进剧情画布 / 三个画布层 | `requireStory` → `getWorkAccess` | ✅ |
| 编辑画布节点、跑生成 | 账号级 `canvasWrite` | ✅（`writer` / `asset` / `storyboard` 角色默认有；`reviewer` 没有） |
| 新建章节 | `requireWorkProjectCreator` | ✅（`projectCreate` ∈ `WORK_MEMBER_PERMISSIONS`） |
| 改剧情配置（变量/连线/玩法） | 只要 `requireStory`（`src/lib/interactive/service.ts:347+` 只对 `name` 查 `canManage`） | ✅ |
| 改名 / 换画幅 | `access.canManage` | ❌ |
| 加/删成员 | `workMemberManage` | ❌ |
| 删除影游 | `workDelete` | ❌ |

注意最后一列的两处易错点：给 `reviewer` 角色的人加成员**不会**给他画布写权限（他进去只能看，`readOnly` 为 `true`），这不算 bug；需要他改东西就给他 `writer` 角色。

---

## §B 批次一：让创建人今天就能拉人（核心）

### §B.1 后端：`getInteractiveStory` 补 `canManageMembers`

**文件**：`src/lib/interactive/service.ts`

`getWorkAccess` 已经把 `canManageMembers` 算好了（`src/lib/collaboration/access.ts:183`），只需要透出来。在 `getInteractiveStory` 的返回对象里、`canCreateChapters` 那一行后面加一行：

```ts
    story: {
      workId,
      name: access.work.name,
      aspectRatio: story.aspectRatio,
      resolution: story.resolution,
      canManage: access.canManage,
      canCreateChapters: access.canCreateProjects,
      canManageMembers: access.canManageMembers,
      config: { ...config, sequence },
    },
```

锚点：`src/lib/interactive/service.ts:329-337`（`return { story: {...}, chapters }` 那段）。**只加这一个字段**，不要顺手把 `canDelete` 也透出来（本文没用到）。

顺带检查同一文件 `updateInteractiveStory` 末尾（`:382`）也有一次 `return getInteractiveStory(...)`，它自动受益，不用改。

### §B.2 前端类型：`OverviewStory` 加可选字段

**文件**：`src/features/interactive/story-overview-model.ts`

```ts
export type OverviewStory = {
  workId: string
  name: string
  aspectRatio: StoryAspectRatio
  resolution: StoryResolution
  canManage: boolean
  canCreateChapters: boolean
  /** 只有项目组长/管理员为 true；缺字段一律按只读处理。 */
  canManageMembers?: boolean
  config: InteractiveStoryConfig
}
```

锚点：`story-overview-model.ts:20-29`。必须是**可选**（`?`），原因见 R4：`tests/unit/interactive/story-overview-model.test.ts:24`、`tests/browser/story-chapter-map-edges.fixture.tsx:25`、`tests/browser/story-p3-editor.fixture.tsx:177`、`tests/browser/story-p4-editor.fixture.tsx:107`、`tests/browser/story-interaction-nodes.fixture.tsx:178` 这些手写 fixture 都没这个字段，写成必填会全部报错。

`useStoryOverview` 只是把 response `as StoryOverviewData`（`useStoryOverview.ts:34`），不需要改。

### §B.3 前端：剧情画布顶栏加「协作成员」按钮

**文件**：`src/features/interactive/StoryOverview.tsx`

1. 改 import（当前是 `StoryOverview.tsx:6`）：

```ts
import { ArrowLeft, Loader2, Play, Plus, RefreshCw, UsersRound, X } from '@/components/ui/icons'
```

再补一条（放在 `import { InteractivePlayer } from './InteractivePlayer'` 附近，保持现有 import 排序风格）：

```ts
import { MemberManagerDialog, workMemberCandidatesEndpoint, workMembersEndpoint } from '@/components/frameos/works/FosWorksDialogs'
```

2. 加状态（`StoryOverview.tsx:30-31` 那一批 `useState` 后面）：

```ts
const [membersOpen, setMembersOpen] = useState(false)
```

3. 在 `.nori-ix-ov-actions` 里加按钮，**位置在「新建章节」之前、「已同步」状态之后**（`StoryOverview.tsx:105-116`）：

```tsx
{story.canManageMembers === true ? (
  <button type="button" className="fos-btn fos-btn-ghost" onClick={() => setMembersOpen(true)}>
    <UsersRound />协作成员
  </button>
) : null}
```

设计说明：

- 用 `fos-btn-ghost`，让「全剧试玩」（`fos-btn-primary`）保持唯一主行动。顶栏已经有「新建章节」这个 ghost，同级并列不抢视线。
- 图标用 `UsersRound`（`src/components/ui/icons/index.ts:91` 导出，`AppIcon` registry 里键名是 `usersRound`）。仓库里**没有** `userPlus` 图标，不要臆造。
- 条件只看 `story.canManageMembers === true`（R5/R6）。非管理员成员看不到这个按钮——他们本来也没有可看的内容差别（成员列表接口虽可读，但影游没有第二处入口，见 §B.7 的取舍）。
- 不加 `disabled` 态，不加 tooltip，不做加载骨架。

4. 渲染对话框，放在 `{trial ? ... : null}` **之后**（`StoryOverview.tsx:143-154` 之后、`</FosShell>` 之前）：

```tsx
{membersOpen ? (
  <MemberManagerDialog
    title={`${story.canManageMembers === true ? '设置' : '查看'}协作成员 · ${story.name}`}
    endpoint={workMembersEndpoint(story.workId)}
    candidatesPath={workMemberCandidatesEndpoint(story.workId)}
    readOnly={story.canManageMembers !== true}
    onClose={() => setMembersOpen(false)}
    onChanged={() => void overview.reload()}
    note="被添加的成员可以在「影游画布」里看到这个项目，一起编辑每一章；改名、画幅和成员管理仍然只有项目组长可以操作。"
  />
) : null}
```

`onChanged` 用 `overview.reload()`（`useStoryOverview.ts:38-45`，注意 `quiet()` 式的错误吞掉风格，这里直接用即可，`reload` 内部自己处理错误态）。**不要**在这里自己 `apiFetch` 拿一遍成员数。

### §B.4 复用对话框：加可选 `note` prop

**文件**：`src/components/frameos/works/FosWorksDialogs.tsx`

当前底部说明是硬编码的（`:681`）：

```tsx
<p className="works-permission-note">项目组长可创建项目并随时增删成员；成员可创建和管理项目内作品，只有作品创建者可删除作品。组长身份由管理员在账号管理中统一设置。</p>
```

改成可选覆盖，默认值保持原字符串逐字不变（`/works` 的显示不能有任何变化）：

```tsx
export function MemberManagerDialog({
  title,
  endpoint,
  candidatesPath,
  readOnly = false,
  note,
  emptyHint,
  onClose,
  onChanged,
}: {
  title: string
  endpoint: string
  candidatesPath: string
  readOnly?: boolean
  /** 覆盖底部权限说明；/works 不传即沿用原文案。 */
  note?: string
  /** 覆盖候选为空时的提示。 */
  emptyHint?: string
  onClose: () => void
  onChanged: () => void
}) {
```

然后把 `:681` 换成：

```tsx
<p className="works-permission-note">{note ?? '项目组长可创建项目并随时增删成员；成员可创建和管理项目内作品，只有作品创建者可删除作品。组长身份由管理员在账号管理中统一设置。'}</p>
```

**遍历检查点**：仓库里 `MemberManagerDialog` 只有两处调用（`FosProjectsClient.tsx:616`、`:625`），都不传新 prop，行为不变。

### §B.5 候选为空时的提示

同一个文件，`CandidatePicker` 的候选列表（`:172`）：

```tsx
{!loading && !error && candidates.length === 0 ? <div className="works-list-hint">暂无数据</div> : null}
```

改成：

```tsx
{!loading && !error && candidates.length === 0 ? <div className="works-list-hint">{emptyHint ?? '暂无数据'}</div> : null}
```

`emptyHint` 从 `MemberManagerDialog` 透传给 `CandidatePicker`（`CandidatePicker` 的 props 类型在 `:94-107` 增加 `emptyHint?: string`）；影游传「没有可添加的账号。请先在「账号管理」里创建子账号，再回到这里添加。」。

理由：`listMemberCandidates` 只返回**同工作区且未在成员里**的账号（`src/lib/works/service.ts:443-457`），小团队一加完就是空列表，「暂无数据」会让创建人以为是报错，进而以为「不能拉人」。这句话是解决用户原始抱怨的关键一步。

### §B.6 只读态说清找谁

`MemberManagerDialog` 的只读分支现在是固定一句（`:629`）：

```tsx
) : <p className="works-dialog-intro">你可以查看当前成员，但没有修改权限。</p>}
```

保持这句不变（`/works` 也在用），但影游的只读场景要在 `note` 里兜住：当 `canManageMembers !== true` 时，说明用户是被撤了组长身份或只是普通成员，`note` 换成「只有被管理员设为项目组长的账号可以增删成员；需要调整请联系管理员。」。

实现方式：`StoryOverview` 里 `note` 用三元表达式，**不要**给对话框再加一个 prop 去做这个判断（判断属于页面，不属于通用组件）。

### §B.7 批次一的验收（自己跑一遍再交付）

1. 用管理账号建一个影游 → 进剧情画布 → 顶栏能看到「协作成员」 → 点开 → 搜索框里能搜到工作区里的子账号 → 选中 → 保存 → 列表出现该成员，且创建人后面没有删除按钮。
2. 换被添加的子账号登录 → `/interactive` 列表能看到这个影游 → 能进所有章 → 能新建章节 → 顶栏**没有**「协作成员」按钮。
3. 用 `reviewer` 角色子账号重复第 2 步 → 能看，画布只读，点不动节点。
4. 用组长的账号点开对话框 → 底部说明是影游版本那句 → 移除刚加的人 → 保存成功。
5. `/works` 页面里随便找个画布项目开成员对话框 → 文案与改之前**逐字一致**，功能无变化（R1 回归）。

---

## §C 批次二：影游列表卡片显示协作人数（可选但推荐）

**目的**：不用点进去就知道这个影游有几个人在做，减少「以为拉不到人」的误解。

### §C.1 后端

**文件**：`src/lib/interactive/service.ts` `listInteractiveStories`（`:178-198`）

`select` 增加成员数（`Work` ↔ `WorkMember` 已有关系，`prisma/schema.prisma:463-479`）：

```ts
      _count: { select: { projects: { where: { deletedAt: null } }, members: true } },
```

返回对象增加：

```ts
    memberCount: work._count.members,
```

⚠️ 注意 `_count` 里的 `projects` 带了 `where`，`members` 不带——Prisma 允许在同一个 `_count` 里混用，但类型上 `work._count.projects` 与 `work._count.members` 都是 `number`，写错成 `work._count.members?.count` 会类型报错。

### §C.2 前端

**文件**：`src/features/interactive/InteractiveHub.tsx`

`StorySummary`（`:14-22`）加 `memberCount?: number`（可选，老响应不炸）。

在卡片 meta 里（`:104-107`）加一项，**仅当 `memberCount > 1`** 才显示（自己是成员，1 人等于没有协作，显示出来是噪音）：

```tsx
{typeof story.memberCount === 'number' && story.memberCount > 1 ? (
  <span><UsersRound />{story.memberCount} 人协作</span>
) : null}
```

`UsersRound` 加进 `:5` 的 import。样式复用现有 `.nori-ix-card-meta span`（`interactive.css` 里已有），**不需要**新增 CSS。

---

## §D 批次三：保存后的明确反馈

### §D.1 为什么值得做

成员变化是异步的、跨账号生效的。创建人点了保存，列表刷新了，但没有任何一句话告诉他「对方现在真的能看到了」。这是用户抱怨「不能拉人协同」在体验上的第二层来源。

### §D.2 实现

**文件**：`src/components/frameos/works/FosWorksDialogs.tsx` `MemberManagerDialog.saveChanges`（`:570-599`）

在 `await reload()` 之后、`onChanged()` 之前，记录本次变更数：

```ts
const added = changeSet.additions.length
const removed = changeSet.removals.length
...
await reload()
setSavedNote(
  added && removed ? `已添加 ${added} 位、移除 ${removed} 位成员。`
  : added ? `已添加 ${added} 位成员，他们现在可以在影游列表中看到这个项目。`
  : `已移除 ${removed} 位成员。`,
)
onChanged()
```

`setSavedNote` 是新增的 `useState<string | null>(null)`；在 `<div className="works-form">` 顶部渲染：

```tsx
{savedNote ? <p className="works-dialog-intro" role="status">{savedNote}</p> : null}
```

要求：
- 只在 `note` prop **存在时**（即影游场景）显示「他们现在可以在影游列表中看到这个项目」这半句；`/works` 场景用中性的「已添加 N 位成员」。实现上用 `note ? A : B`，不要给组件再加开关。
- 用户下一次改动（`onToggle` / 移除按钮）时清空 `savedNote`，避免陈旧提示。
- 任何一步失败时保持现有行为：显示错误、**不**清空 `savedNote` 以外的东西、不回滚已成功的增删。

---

## §E 改动清单（按文件汇总，共 5 个文件 + 1 个测试）

| 文件 | 批次 | 改什么 |
|---|---|---|
| `src/lib/interactive/service.ts` | 一 / 二 | `getInteractiveStory` 返回 `canManageMembers`；`listInteractiveStories` 返回 `memberCount` |
| `src/features/interactive/story-overview-model.ts` | 一 | `OverviewStory` 加 `canManageMembers?: boolean` |
| `src/features/interactive/StoryOverview.tsx` | 一 | import、`membersOpen` 状态、顶栏按钮、挂载对话框 |
| `src/components/frameos/works/FosWorksDialogs.tsx` | 一 / 二 / 三 | `MemberManagerDialog` 加 `note` / `emptyHint`（可选，默认值逐字不变）、`CandidatePicker` 加 `emptyHint`、`saveChanges` 加成功提示 |
| `src/features/interactive/InteractiveHub.tsx` | 二 | `StorySummary.memberCount?`、卡片 meta 加「N 人协作」 |
| `tests/unit/interactive/service.test.ts` | 一 | 断言 `canManageMembers` 透出 |

**不动的文件**（这一行很重要，防止实现时手滑）：`src/lib/permissions/resolve.ts`、`src/lib/permissions/catalog.ts`、`src/lib/collaboration/access.ts`、`src/lib/works/service.ts`、`src/app/api/works/**`、`src/app/api/interactive/**`、`prisma/schema.prisma`、`src/components/frameos/FosProjectsClient.tsx`、`src/styles/frameos-replica.css`、`src/features/interactive/interactive.css`。

**明确不做**（写进部署记录的建议，不实现）：
- 「成员也能邀请人」——需要改权限模型，见 §A.2，是产品决策。
- 影游出现在 `/works` 列表里——违反两条产品线分离的既有设计。
- 章级协作者——需要新的 UI 与接口，且当前 `WorkMember` 已覆盖全部章。
- 邀请链接 / 未注册邀请 / 成员操作记录。

---

## §F 测试

### §F.1 必做单测

**文件**：`tests/unit/interactive/service.test.ts`

现有 mock 结构：`access.getWorkAccess.mockResolvedValue({ work: {...}, canManage: true, canCreateProjects: true })`（`:43`）。补 `canManageMembers` 到 mock 返回，然后加两条断言：

```ts
it('exposes member administration from the work access for the 影游 surface', async () => {
  access.getWorkAccess.mockResolvedValue({
    work: { id: 'w1', name: '长安', projects: [{ id: 'p1' }] },
    canManage: true, canCreateProjects: true, canManageMembers: true,
  })
  const result = await getInteractiveStory(session, 'w1')
  expect(result.story.canManageMembers).toBe(true)
})

it('keeps member administration false for a plain member', async () => {
  access.getWorkAccess.mockResolvedValue({
    work: { id: 'w1', name: '长安', projects: [{ id: 'p1' }] },
    canManage: false, canCreateProjects: true, canManageMembers: false,
  })
  const result = await getInteractiveStory(session, 'w1')
  expect(result.story.canManageMembers).toBe(false)
})
```

⚠️ 这两个用例放在现有 `describe('interactive story service')` 里，并注意 `beforeEach` 会重置 `access.getWorkAccess`（`:38`），用例内部必须自己再 mock 一次。

**不要**给 `MemberManagerDialog` 写新的单测——仓库里目前没有它的测试（`tests/unit/collaboration/` 下 7 个文件全是纯函数/服务层测试），引入 jsdom 组件测试属于新增测试基建，R9 禁止。

### §F.2 必做的回归命令

```bash
npx tsc --noEmit
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/interactive tests/unit/collaboration
npm run check:api-handler
npm run lint
```

`npm run check:api-handler` 必跑的理由：本批次**没有**新增 API 路由，跑它是为了证明这一点（如果它报出新路由，说明实现跑偏了）。

### §F.3 手测命令（本地，headless）

按 `reference_local_dev.md` 起本地环境，用种子里带 `projectLeader` 的账号与一个 `writer` 子账号互测，走一遍 §B.7 的 5 步。

如果要对浏览器动效/布局做截图核对，用 `test-results/gallery` 那套 headless harness（注意它有 CSS `zoom: 1.2`，弹层要 `ViewportDialogLayer`），**不要**弹可见窗口。

---

## §G 批次与提交顺序

| 批次 | 内容 | 提交信息建议 |
|---|---|---|
| 一 | §B 全部（后端字段 + 类型 + 顶栏按钮 + 对话框复用 + 空态文案 + 单测） | `feat(story): add collaborators entry to the interactive canvas` |
| 二 | §C 成员数 + §B.4/§B.5 文案打磨 | `feat(story): show collaborator count on story cards` |
| 三 | §D 保存反馈 | `feat(works): confirm collaborator changes after saving` |

每批各自 `npx tsc --noEmit` + §F.2 的 vitest 子集跑绿再提交。批次一必须能独立上线。

---

## §H 部署记录里的建议（不实现，交给用户决策）

1. **成员能否邀请成员**：目前只有管理账号与被设为项目组长的账号能增删成员（§A.2）。如果用户希望「谁都能拉人」，需要在 `WORK_MEMBER_PERMISSIONS` 里加 `workMemberManage` 并调整 `object-access` 的单测——这是放开权限边界，必须用户明确同意。
2. **项目组长身份的唯一入口是账号管理**：`createInteractiveStory` 要求 `projectLeader`（`src/lib/interactive/service.ts:226`），普通子账号连「新建影游」的按钮都会报「当前账号不是项目组长，请联系管理员设置。」。如果实际使用中子账号需要自己立项，应该走账号级 `workCreate` 权限（`src/lib/account/permissions.ts:53`，「允许立项」），这与成员协作是两个独立议题。
3. **跨账号实时同步**：现在 A 改了剧情，B 需要刷新才看到（`useStoryOverview` 只在窗口重新聚焦且无未保存改动时刷新，`useStoryOverview.ts:53`）。真正的多人实时协作需要 WebSocket 与冲突合并，属于另一个项目。
4. **成员变动无通知**：被加进影游的账号不会收到任何提示，只能自己发现列表里多了项目。若要通知，应挂在现有站内信/通知体系上，不要为本功能单独造一套。
