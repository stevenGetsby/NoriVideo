# FrameOS 更新版「我的作品 / 我的任务」静态资源与 API 证据

取证日期：2026-07-18（Asia/Shanghai）  
取证对象：本机 `/Applications/帧界FrameOS.app`、Electron 用户目录、当前 CDP 页面与 `www.frameos.cn` 当前静态资源  
当前页面目标：`https://www.frameos.cn/#/my-assignments`  
用途：固定更新后 FrameOS 的版本、路由、懒加载 bundle、CSS、接口和任务状态枚举，供 NoriVideo 后续对齐时复查

## 1. 结论与边界

当前桌面 App 的二进制版本仍为 `1.0.9`，但它加载的是 2026-07-17 21:46（UTC+8）发布的新 Web 静态资源。新版主包明确注册：

- 「我的作品」：hash 路由 `#/works`，懒加载 `WorksView--iIEYyfw.js`。
- 「我的任务」：hash 路由 `#/my-assignments`，懒加载 `MyAssignmentsView-CQLsoIZW.js`。

本次只进行了以下操作：

- 读取 App 版本、进程、日志和 Chromium 缓存文件元信息。
- 读取 CDP target、DOM、Performance Resource Timing 和当前资源 URL。
- 在 `#/works` 与 `#/my-assignments` 之间做 hash 路由导航，让 App 自己发起列表 GET 请求。
- 以 GET/HEAD 下载公开静态 JS/CSS 到 `/tmp/frameos-updated-evidence`，计算哈希并做离线静态分析。

没有调用 FrameOS 的任何 POST、PUT、PATCH 或 DELETE 接口；没有创建作品/项目、分配任务、提交审核、通过、驳回、标记完成、恢复任务、上传素材或调用生成服务。没有提取或保存 cookie、登录 token、账号 UID、遥测 session ID 或接口响应中的个人内容。

运行时页面和 bundle 可以证明入口、字段、条件分支和 API client 存在；不能据此声称写入状态转换已在 FrameOS 云端端到端执行成功。

## 2. 桌面 App 版本与更新时间

### 2.1 二进制版本

`Info.plist` 与 CDP User-Agent 给出一致版本：

| 项目 | 当前值 |
| --- | --- |
| App | 帧界FrameOS |
| Bundle ID | `com.frameos.desktop.web` |
| `CFBundleShortVersionString` | `1.0.9` |
| `CFBundleVersion` | `1.0.9` |
| Electron | `38.8.6` |
| Chromium | `140.0.7339.249` |
| CDP Protocol | `1.3` |
| User-Agent 产品段 | `frameos-desktop/1.0.9` |

App 主归档：

| 文件 | 大小 | 修改时间 | SHA-256 |
| --- | ---: | --- | --- |
| `/Applications/帧界FrameOS.app/Contents/Resources/app.asar` | 183,576,601 B | 2026-07-03 18:59:08 +0800 | `325a0982a6f035ea83f2474cafb556ce8feb2d385a3751251391bf087d9faa49` |

### 2.2 更新与运行时间线

- 本地更新日志记录 `2026-07-17T09:04:03Z`（17:04:03 +0800）完成换包，更新归档 SHA-256 为 `343212f67700cacf550afdd2404812874777ef3983c9f114fe689fe75667f467`。
- 当前 App 主进程于 2026-07-17 17:20:54 +0800 启动。
- 当前页面 renderer 于 2026-07-17 22:51:56 +0800 启动。
- 当前 Web JS/CSS 的 `Last-Modified` 为 2026-07-17 13:46:15–16 GMT，即 21:46:15–16 +0800。

这说明当前取证对象是更新后的桌面壳和更新后的 Web 部署，而不是只看 App 版本号推断页面代码。

## 3. 当前 CDP target 与路由表

当前唯一 page target：

```text
title: 帧界FrameOS
type: page
url: https://www.frameos.cn/#/my-assignments
remote debugging port: 9334
```

主包中的路由契约：

| Hash 路由 | Route name | 标题 | 懒加载入口 |
| --- | --- | --- | --- |
| `#/` | — | — | redirect 到 `/works` |
| `#/projects` | — | — | redirect 到 `/works` |
| `#/works` | `Works` | 我的作品 | `WorksView--iIEYyfw.js` |
| `#/my-assignments` | `MyAssignments` | 我的任务 | `MyAssignmentsView-CQLsoIZW.js` |

侧栏「我的任务」不是 `/tasks`，其真实跳转代码是 `push('/my-assignments')`。任务详情返回列表时保留 `from=my-assignments` 与 `from_tab`，并恢复为 `MyAssignments` 路由及对应标签。

## 4. 当前静态资源指纹

以下哈希均针对从当前资源 URL 下载后的原始响应体；格式化副本只用于阅读，不参与指纹判定。

| 资源 | 大小 | SHA-256 | 用途 |
| --- | ---: | --- | --- |
| `js/index-DZAItfmb.js` | 1,139,577 B | `0c9e36169d9bef18fea2211a96f5bf337b3dcf5fe5b031c2020b240922cce66b` | 主应用、路由、共享 API client |
| `js/WorksView--iIEYyfw.js` | 78,382 B | `e7af557e6340c76c21079cd7278af37ed3752a00fe27d3999190edb00c94f9e9` | 我的作品页面 |
| `css/WorksView-Sw4zQrD5.css` | 55,494 B | `c1255e3ebe7861a32c30d8a471530d78bc6c344f53a4c9828b8fa6fd3dc7c4fb` | 我的作品页面样式 |
| `js/workService-CISx8Cc2.js` | 1,349 B | `843629de64a0676f69f3c70e0f6037f5e226bc93a17c63af693b0944f1dedb52` | 作品 CRUD 与成员接口 client |
| `js/MyAssignmentsView-CQLsoIZW.js` | 15,966 B | `974743d111a85962aead41861a861dd2e16f233ad6218f6c5c009eceb9515b1a` | 我的任务页面 |
| `css/MyAssignmentsView-DlQrIQr5.css` | 7,012 B | `32ad1620a74e997c6c279ffe2b2e79d00e586069444b42405b3047acd65ee0f9` | 我的任务页面样式 |
| `js/collaborationService-T2BeDvW-.js` | 3,905 B | `01838199b06d854ff1c2abac58d399f74fb0e0a8271d91db24bf78fb3c1c2a74` | 任务读写 API client |
| `js/useCollaborationTaskActions-BNHk8H9G.js` | 4,426 B | `7ab6cf2ea9158af41ac58a686e1fb8324b1becf8cfcf13cf4f9a15e672c1fa5d` | 状态标签、可用动作与动作菜单 |
| `js/collaborationAssignmentNavigateGate-CYAbOIRe.js` | 7,737 B | `2a43e4245100209f0acb6740855ece11280e4c9e5fc753878969a4a98f27e2c1` | 任务进入生产阶段的校验与回跳 |
| `js/useCollaborationNavigation-D48_27Ox.js` | 2,028 B | `962192d6b2aec83193c83972f9f5d99bea3f231055e81598edd5b976ce96966e` | 任务导航状态 |

关键 CDN 响应头：

| 资源 | ETag | Last-Modified (GMT) |
| --- | --- | --- |
| `index-DZAItfmb.js` | `DFF0578E36892FFBAB8AEC84612FE8A0` | Fri, 17 Jul 2026 13:46:16 GMT |
| `WorksView--iIEYyfw.js` | `3B26147D97FE5DF75316BCC9F7379472` | Fri, 17 Jul 2026 13:46:15 GMT |
| `WorksView-Sw4zQrD5.css` | `A7AA6FF531DFA866986E6221519258ED` | Fri, 17 Jul 2026 13:46:15 GMT |
| `workService-CISx8Cc2.js` | `5859B6FB82A51E0EBACEDE1D74C6467D` | Fri, 17 Jul 2026 13:46:16 GMT |
| `MyAssignmentsView-CQLsoIZW.js` | `74E6B9F60712F07F39AFE8262B415949` | Fri, 17 Jul 2026 13:46:15 GMT |
| `MyAssignmentsView-DlQrIQr5.css` | `922F0FC6FB63A1B141FF102351FC0DD0` | Fri, 17 Jul 2026 13:46:15 GMT |
| `collaborationService-T2BeDvW-.js` | `0C9B3B38FDF764AB681E1A7D4208EB61` | Fri, 17 Jul 2026 13:46:15 GMT |

## 5. 本机缓存交叉证据

Electron 用户目录为：

```text
~/Library/Application Support/frameos-desktop
```

当前资源在 Chromium Disk Cache/Code Cache 中均有对应记录：

| 当前 URL | Disk Cache 容器 |
| --- | --- |
| `js/WorksView--iIEYyfw.js` | `Cache/Cache_Data/95e2dd5c77bb8e64_0` |
| `js/MyAssignmentsView-CQLsoIZW.js` | `Cache/Cache_Data/dbe557ab0438573e_0` |
| `css/MyAssignmentsView-DlQrIQr5.css` | `Cache/Cache_Data/c4617139791f79c6c_0` |
| `js/collaborationService-T2BeDvW-.js` | `Cache/Cache_Data/d5220f1f63b2be4a_0` |

缓存容器内可直接复核当前 URL、`HTTP/1.1 200`、Content-Type、ETag 和 Last-Modified。例如 `dbe557ab0438573e_0` 内记录了：

```text
https://www.frameos.cn/js/MyAssignmentsView-CQLsoIZW.js
etag:"74E6B9F60712F07F39AFE8262B415949"
last-modified:Fri, 17 Jul 2026 13:46:15 GMT
```

缓存中同时残留旧资源名，如 `MyAssignmentsView-BJfpkzvU.js`、`MyAssignmentsView-C_B_OaHk.js` 和多版旧 `WorksView-*`。当前 target 的 Performance Resource Timing、主包路由表和最新缓存记录三者都指向 `CQLsoIZW / -iIEYyfw`，因此不能把旧缓存文件当作当前版本基线。

## 6. 「我的作品」运行时与 API

### 6.1 当前页面结构

`#/works` 运行时确认存在：

- 标题「我的作品」、作品总数和「新建作品」。
- 同时搜索作品或项目的搜索框。
- 作品面板、项目计数、作品级「新建项目」和权限条件下的更多操作。
- 每个作品下的项目网格；空作品显示「暂无项目」。
- 新建作品弹窗包含作品名称和可选成员。

当前账号运行时显示 2 个作品；本文不保存作品名、项目名、成员或 ID。

### 6.2 运行时实际观察到的 GET

| GET | HTTP | 作用 |
| --- | ---: | --- |
| `/api/creative/works/list` | 200 | 作品列表 |
| `/api/creative/projects/list` | 200 | 当前账号可见项目 |
| `/api/creative/works/projects/list?id=<work-id>` | 200 | 按作品读取可见项目 |

以上来自 App 自己的 Performance Resource Timing；未保存响应正文，`<work-id>` 已去标识化。

### 6.3 Bundle 中的作品/项目 API client

作品 client 的基址为 `/api/creative`，静态代码包含：

| 方法 | 相对路径 | 用途 | 本次调用 |
| --- | --- | --- | --- |
| GET | `/works/list` | 列出作品 | 是，200 |
| GET | `/works/detail` | 作品详情 | 否 |
| GET | `/works/projects/list` | 作品下项目 | 是，200 |
| GET | `/works/members/list` | 作品成员 | 否 |
| GET | `/works/members/candidates` | 成员候选 | 否 |
| POST | `/works/create` | 创建作品 | **未调用** |
| POST | `/works/update` | 重命名/更新作品 | **未调用** |
| POST | `/works/delete` | 删除作品 | **未调用** |
| POST | `/works/members/add` | 添加成员 | **未调用** |
| POST | `/works/members/remove` | 移除成员 | **未调用** |
| POST | `/projects/move` | 批量移动项目到作品 | **未调用** |

主包中的项目 client 还包含：

- `GET /projects/list`、`GET /projects/detail`、`GET /projects/members/list`。
- `POST /projects/create`、`POST /projects/update`、`POST /projects/delete`。
- `POST /projects/members/add`、`POST /projects/members/remove`。

默认项目列表会过滤 `status === 'deprecated'`；只有显式 `includeDeprecated` 才保留。这是目前能从作品链确认的项目生命周期分支，不能据此扩展出未见于 bundle 的其他项目状态。

## 7. 「我的任务」运行时与 API

### 7.1 页面结构

`#/my-assignments` 在 `1300 × 989` 视口实际渲染：

- 作品筛选：默认「全部作品」。
- 项目筛选：默认「全部项目」，未选作品时禁用。
- 任务类型筛选：默认「全部类型」。
- 标签页：待我处理、审核中、已完成；有审核权限时条件显示「待我审核」。
- 表格列：任务、状态、负责人、当前标签对应时间、操作备注、操作。
- 默认分页大小为 10。

本次账号当前显示「暂无任务」，所以列表结构和状态机由运行时 DOM与 bundle 交叉确认，未伪造任务行数据。

### 7.2 标签页查询枚举

| Query `tab` | UI 标签 | 时间列 |
| --- | --- | --- |
| `todo` | 待我处理 | `assigned_at` / 分配时间 |
| `in_review` | 审核中 | `submitted_at` / 提交时间 |
| `done` | 已完成 | `completed_at` / 完成时间；同时保留提交时间 |
| `pending_review` | 待我审核 | `submitted_at` / 提交时间 |

`pending_review` 标签只有 `/pending-review-count` 返回 `show_tab: true` 时才显示，不应给所有账号固定渲染。

### 7.3 任务阶段枚举

| `stage` | UI 标签 | 粒度 |
| --- | --- | --- |
| `asset` | 资产设定 | 项目级 |
| `storyboard` | 分镜设计 | 分集级 |
| `video` | 视频制作 | 分集级 |

### 7.4 任务原始状态与展示状态

原始业务状态：

| 原始 `status` | UI 标签 | CSS/展示归一值 |
| --- | --- | --- |
| `unassigned` | 待分配 | `unassigned` |
| `in_progress` | 进行中 | `assigned` |
| `pending_review` | 待审核 | `pending_review` |
| `completed` | 已完成 | `approved` |
| `rejected` | 已驳回 | `rejected` |

标签页枚举和任务状态枚举不是同一套值。例如 `todo` 是“当前用户要处理的集合”，数据库/接口状态仍可能是 `in_progress` 或 `rejected`；NoriVideo 不应把标签名直接当任务状态保存。

### 7.5 状态驱动动作

Bundle 中的动作键和 UI 文案：

| 状态/权限条件 | 动作键 | 文案 |
| --- | --- | --- |
| `unassigned` + 可管理 | `assign` | 分配 |
| `in_progress` + 当前执行人 | `submit` | 提交审核；直完成任务显示「标记完成」 |
| `in_progress` + 可管理 | `reassign` / `markComplete` | 重新分配 / 标记完成 |
| `pending_review` + 可审核 | `approve` / `reject` | 通过 / 驳回 |
| `pending_review` + 可管理 | `reassign` | 重新分配 |
| `rejected` + 当前执行人 | `submit` | 重新提交 |
| `rejected` + 可管理 | `reassign` / `markComplete` | 重新分配 / 标记完成 |
| `completed` + 可恢复 | `reopen` | 恢复为进行中 |
| 可进入详情 | `navigate` | 查看详情 |

与动作相关的权限字段至少包括：

```text
can_manage_assignments
can_review_assignments
can_submit
can_mark_complete
can_reopen
can_review
```

### 7.6 运行时实际观察到的 GET

进入任务页时，App 实际发送：

| GET | HTTP | 用途 |
| --- | ---: | --- |
| `/api/creative/projects/list` | 200 | 项目筛选候选 |
| `/api/creative/projects/collaboration/assignments/pending-review-count` | 200 | 审核标签权限与数量 |
| `/api/creative/projects/collaboration/assignments/my?page=1&page_size=1&tab=todo` | 200 | 待处理徽标数 |
| `/api/creative/projects/collaboration/assignments/my?page=1&page_size=1&tab=in_review` | 200 | 审核中徽标数 |
| `/api/creative/projects/collaboration/assignments/my?page=1&page_size=1&tab=done` | 200 | 已完成徽标数 |
| `/api/creative/projects/collaboration/assignments/my?page=1&page_size=10&tab=todo` | 200 | 当前标签列表 |

可选筛选参数由 service 统一映射为：`project_id` 或逗号分隔 `project_ids`，以及 `stage`、`page`、`page_size`、`tab`。

### 7.7 Bundle 中的任务 API client

接口前缀：

```text
/api/creative/projects/collaboration/assignments
```

读取接口：

| 方法 | 相对路径 | 用途 |
| --- | --- | --- |
| GET | `/my` | 当前用户任务，支持 tab/分页/项目/阶段筛选 |
| GET | `/pending-review` | 待当前账号审核列表 |
| GET | `/pending-review-count` | 待审核数量和标签显隐 |
| GET | `/list` | 按 `project_id` 读取任务 |
| GET | `/candidates` | 按 `project_id` 读取执行人候选 |

写接口仅做静态确认，本次全部未调用：

| 方法 | 相对路径 | 主要请求字段 |
| --- | --- | --- |
| POST | `/assign` | `assignment_uuid`, `assignee_uid` |
| POST | `/submit` | `assignment_uuid` |
| POST | `/approve` | `assignment_uuid`, `note` |
| POST | `/reject` | `assignment_uuid`, `note` |
| POST | `/mark-complete` | `assignment_uuid` |
| POST | `/reopen` | `assignment_uuid` |
| POST | `/batch-assign` | `assignment_uuids`, `assignee_uid` |
| POST | `/batch-approve` | `assignment_uuids`, `note` |
| POST | `/batch-reject` | `assignment_uuids`, `note` |

## 8. 更新版 CSS 识别基线

### 8.1 我的作品

更新版 `WorksView-Sw4zQrD5.css` 的稳定特征：

- `.works-main`：`padding: 20px 28px 60px`，纵向滚动。
- `.ws-title`：`22px / 700 / #fff`。
- `.ws-create-btn`：紫色胶囊按钮，`#a78bfa`，高 `30px`。
- `.ws-search`：`220 × 36px`、圆角 `8px`、深色半透明背景。
- `.wt-panel`：圆角 `16px`、琥珀色弱边框、紫黑渐变头部。
- `.wt-grid`：`repeat(auto-fill, minmax(220px, 1fr))`，gap `14px`。
- 项目卡封面高 `170px`；标题 `17px / 600`；蓝、绿、紫、橙用于类型/分辨率/风格/协作标签。

### 8.2 我的任务

更新版 `MyAssignmentsView-DlQrIQr5.css` 的稳定特征：

- `.my-assignments-view`：全高 flex，背景 `var(--bg-app-1, #0d0d0d)`。
- `.mav-title`：`20px / 700 / #fff`。
- 筛选区左右 padding `24px`，每个选择器宽 `200px`。
- 标签页内容使用透明滚动条，hover 后显示 `rgba(255,255,255,.2)`。
- 表头 `12px / 600`，背景 `rgba(255,255,255,.05)`。
- 状态 chip 为 `12px / 600` 胶囊：
  - `assigned`：蓝 `#60a5fa`。
  - `pending_review`：橙 `#f59e0b`。
  - `approved`：绿 `#10b981`。
  - `rejected`：红 `#ef4444`。
  - `unassigned`：灰色弱背景。

这些值来自当前 CSS 原始响应体，不是从截图近似取色。

## 9. 对 NoriVideo 复刻的直接约束

1. 一级入口应分别使用“我的作品”和“我的任务”，任务中心不能混同生成队列。
2. 真实任务路由为 `/my-assignments`；如 NoriVideo 使用不同 URL，也应保持导航、回跳和标签上下文等价。
3. 标签页 query 与任务 `status` 必须分层建模，不能把 `todo/in_review/done` 当作任务实体状态。
4. 「待我审核」必须由审核权限/`show_tab` 条件显示。
5. 作品列表需要作品级权限与项目可见性裁剪；作品标称项目总数不必等于当前账号渲染的项目卡数量。
6. 动作按钮必须由状态、当前执行人和管理/审核权限共同决定，不能每行固定展示所有写操作。
7. 复刻验收应固定本文 bundle 名、ETag 与 SHA-256；若 FrameOS 再次发布新 hash，应新建一轮证据，不能混用本机旧缓存。

## 10. 可复查命令

以下命令均为只读：

```bash
curl -fsS http://127.0.0.1:9334/json/version
curl -fsS http://127.0.0.1:9334/json/list
plutil -p '/Applications/帧界FrameOS.app/Contents/Info.plist'
shasum -a 256 '/Applications/帧界FrameOS.app/Contents/Resources/app.asar'
curl -fsSI 'https://www.frameos.cn/js/MyAssignmentsView-CQLsoIZW.js'
curl -fsSL --compressed 'https://www.frameos.cn/js/MyAssignmentsView-CQLsoIZW.js' | shasum -a 256
```

不要用生成服务或 FrameOS 写接口来“验证”本文；它们与本次只读静态/运行时证据无关。
