# 《需求及 Bug 管理 V1》验收矩阵

来源：`/Users/headmasterx/Downloads/需求及 Bug 管理_V1.xlsx`

- SHA-256：`dc967ecfb12305a47a79dc68de885cc7c8282b8898a4a6838af33cb07e59c537`
- 清单规模：16 条需求、22 条 Bug。
- 原工作簿只保存了附件文件名，没有内嵌图片或视频；本机也未找到原附件。因此 Bug 1 与 Bug 9 无法按原画面做精确视觉验收，不能标记为已完成。
- 2026-07-23 最终定向回归：31 个测试文件、157 个测试全部通过。
- 质量门禁：TypeScript、相关 ESLint、能力目录、计价目录与模型配置严格契约全部通过。
- 2026-07-23 画布运行验收：Mini/Fast 显示 480p、720p；Pro 显示 480p、720p、1080p、4K；引用素材悬浮预览、自动放大开关、提示词面板调宽/持久化/跟随节点、框选连线和批量删除均通过。
- 2026-07-23 工作台运行验收：无图环境资产显示深色可操作空状态；工具箱原生下拉的普通选项为浅色字/深色底，禁用选项为独立灰色；角色、变体与 Segment 的新增、删除、上下移动控件均在真实项目数据中可见且可用。验收过程未提交任何增删操作。

## 需求管理（16 条）

| ID | 原需求 | 当前结论 | 主要实现证据 | 自动化证据 |
|---|---|---|---|---|
| R01 | 增加角色自定义功能 | 已验证。角色名称只负责展示，功能区权限独立授权。 | `src/lib/account/permissions.ts`；`src/components/frameos/FosAccountManagementParts.tsx`；`src/app/api/admin/accounts/` | `tests/unit/frameos/account-management-platform.test.ts`；`tests/unit/frameos/project-role-panel-permissions.test.ts` |
| R02 | 系统提示词优化，减少仿真人 3D 感 | 已验证。真人实拍默认注入真实皮肤/材质约束，并明确排除 3D、CGI、数字人、塑料皮肤等。 | `src/lib/projects/creation-config.ts`；`src/app/api/novel-promotion/[projectId]/assets/route.ts` | `tests/unit/projects/creation-config.test.ts` |
| R03 | UI 编辑框可自由调节 | 已验证。画布提示词面板支持拖动和键盘调宽，宽度本地持久化，重新进入仍恢复。 | `src/features/canvas/generator-panel-width.ts`；`src/features/canvas/components/CanvasGenerator.tsx` | `tests/unit/canvas/generator-panel-width.test.ts`；运行态验收 |
| R04 | 默认勾选生成声音 | 已验证。支持声音的新视频模型默认开启；用户明确关闭后草稿继续保持关闭。 | `src/components/frameos/views/toolbox-draft.ts`；`src/components/frameos/views/FosToolbox.tsx` | `tests/unit/frameos/toolbox-draft.test.ts` |
| R05 | 按 Seedance 文档设置分辨率 | 已验证。分辨率完全来自所选模型能力，不再全局写死；UI 统一显示 4K。 | `standards/capabilities/image-video.catalog.json`；`src/app/api/frameos/generation-config/route.ts`；`src/components/frameos/views/FosToolbox.tsx` | `tests/unit/canvas/generator-options.test.ts`；运行态验收 |
| R06 | 模型支持 Fast、Mini、Pro | 已验证。三档作为稳定模型暴露，并带独立能力与说明。 | `src/lib/nori-model-catalog.ts`；`standards/capabilities/image-video.catalog.json` | `tests/unit/nori-model-catalog.test.ts`；`tests/unit/model-capabilities/seedance-business-tiers.test.ts`；`tests/integration/api/specific/user-models-default-video.test.ts` |
| R07 | 提示词界面查看引用素材、悬浮大图、自动放大 | 已验证。已连线和仅被 @ 提及的素材均可见；图片/视频悬浮预览；开关持久化。 | `src/features/canvas/components/CanvasGenerator.tsx`；`src/features/canvas/canvas.css` | `tests/unit/canvas/seedance-toolbox-interactions.test.ts`；运行态验收 |
| R08 | 框选批量删除连线 | 已验证。框选矩形与真实 SVG 路径求交，支持 Delete 和“删除选中”。 | `src/features/canvas/edge-marquee.ts`；`src/features/canvas/CanvasGraph.tsx` | `tests/unit/canvas/edge-marquee.test.ts`；运行态验收 |
| R09 | 节点磁吸增强并避免连接时框选 | 已验证。连接/重连半径为 64，连线期间关闭拖框选择，并提高 pane 点击容差。 | `src/features/canvas/CanvasGraph.tsx` | `tests/unit/canvas/seedance-toolbox-interactions.test.ts`；运行态验收 |
| R10 | 工具箱视频失败显示具体原因 | 已验证。主预览和历史卡片显示错误码、错误详情与任务 ID；后端持久化失败记录。 | `src/components/frameos/views/FosToolbox.tsx`；`src/app/api/frameos/toolbox/assets/route.ts`；`src/app/api/frameos/toolbox/generate/route.ts` | `tests/unit/canvas/seedance-toolbox-interactions.test.ts`；`tests/integration/api/specific/frameos-toolbox-generate-route.test.ts` |
| R11 | 画布提示词框跟随节点 | 已验证。锚点由节点位置、尺寸和视口实时计算，移动节点后面板同步移动并自动上下翻转。 | `src/features/canvas/generator-anchor.ts`；`src/features/canvas/CanvasGraph.tsx` | `tests/unit/canvas/generator-anchor.test.ts`；运行态验收 |
| R12 | 列表可自由增删改 | 已验证描述所覆盖的生产列表：真实项目中角色新增/删除、角色变体新增/删除、Segment 新增/上下移动/删除控件均可见且可用；物品和环境沿用同一资产列表实现。原图缺失，无法确认描述是否还指向另一个列表。 | `src/components/frameos/views/FosAssetSetting.tsx`；`src/components/frameos/views/FosStoryboard.tsx`；相关 API | `tests/unit/frameos/manual-asset-and-panel-surface.test.ts`；运行态验收 |
| R13 | 工具箱视频增加音频和视频参考 | 已验证。全能参考支持图片、视频、音频并保持顺序；首尾帧继续使用严格图片语义。 | `src/components/frameos/views/FosToolbox.tsx`；`src/lib/canvas/generation-input-schema.ts` | `tests/unit/frameos/toolbox-references.test.ts`；`tests/integration/api/specific/frameos-toolbox-generate-route.test.ts` |
| R14 | 资产库与素材库明确区分并支持归类 | 已验证。素材保存源文件；资产分类为角色/场景/道具/镜头/其他，并按项目映射到资产库。 | `src/lib/frameos/material-category.ts`；`src/components/frameos/views/FosMaterialLibrary.tsx`；`src/app/api/frameos/materials/route.ts` | `tests/unit/frameos/material-category.test.ts`；`tests/unit/frameos/material-picker-dialog.test.ts` |
| R15 | 资产库分类上传、项目文件夹、人物音频同步 | 已验证。上传被锁定到当前项目和品类；项目树真实读取；角色卡展示绑定音色。 | `src/components/frameos/materials/MaterialPickerDialog.tsx`；`src/components/frameos/views/FosAssetLibrary.tsx` | `tests/unit/frameos/material-picker-dialog.test.ts`；`tests/unit/frameos/character-bound-voice-surface.test.ts` |
| R16 | 统计报表 | 已验证。服务记录页读取真实任务、失败、项目成本、账户流水、Token、趋势和服务类型统计。 | `src/lib/workspace/service-records.ts`；`src/components/workspace/FrameServiceRecordsDashboard.tsx` | `tests/unit/workspace/service-records-overview.test.ts`；`tests/unit/workspace/service-records-route.test.ts`；`tests/unit/frameos/service-records-surface.test.ts` |

## Bug 管理（22 条）

| ID | 原 Bug | 当前结论 | 主要实现证据 | 自动化证据 |
|---|---|---|---|---|
| B01 | 焦点切换动画有闪屏感 | 待原附件复验。已取消资产库中转路由并保持根文档暗色，能消除已知白闪；但缺少原视频，无法证明“焦点切换动画”就是同一触发点。 | `src/app/globals.css`；`src/components/frameos/FosShell.tsx` | `tests/unit/frameos/asset-library-navigation-stability.test.ts`（仅覆盖已知路由白闪） |
| B02 | 点击资产库闪白 | 已验证。侧栏直接进入规范路由，且 HTML/body 始终使用暗色底。 | `src/components/frameos/FosShell.tsx`；`src/app/globals.css` | `tests/unit/frameos/asset-library-navigation-stability.test.ts` |
| B03 | 资产设定 AI 修图和导入素材不可用 | 已验证。按钮接入真实改图任务、素材选择和本地上传，结果写回资产。 | `src/components/frameos/views/FosAssetSetting.tsx`；`src/app/api/novel-promotion/[projectId]/import-asset-image/route.ts` | `tests/unit/frameos/material-storyboard-toolbox-surface.test.ts` |
| B04 | 无图片资产占位不美观 | 已验证。真实无图环境资产渲染为 `rgb(5,5,6)` 深色空状态，显示“环境设定图还未生成”和“可生成图片，或从素材库与本地导入”，不再伪造白底资产图。 | `src/components/frameos/views/FosAssetSetting.tsx` 的 `AssetPreview` | `tests/unit/frameos/material-storyboard-toolbox-surface.test.ts`；运行态视觉验收 |
| B05 | 下拉选项白色看不清 | 已验证。工具箱真实下拉的普通 option 计算样式为 `rgb(242,245,255)` 浅色字与 `rgb(23,25,31)` 深色底，disabled option 为 `rgb(113,121,138)`。 | `src/styles/frameos-replica.css` | `tests/unit/frameos/material-storyboard-toolbox-surface.test.ts`；运行态计算样式验收 |
| B06 | 不同品类上传可互相混入 | 已验证。角色、场景、道具入口锁定对应 `assetCategory` 和图片类型，服务端仍校验分类。 | `src/components/frameos/materials/MaterialPickerDialog.tsx`；`src/lib/frameos/material-category.ts` | `tests/unit/frameos/material-picker-dialog.test.ts`；`tests/unit/frameos/material-category.test.ts` |
| B07 | 画布一次导入 6 张只成功 2 张 | 已验证。并发数 2 仅是并发上限，队列会处理全部最多 100 个文件，并逐个插入成功结果。 | `src/features/canvas/CanvasGraph.tsx`；`src/lib/async/settle-with-concurrency.ts` | `tests/unit/async/settle-with-concurrency.test.ts`；`tests/unit/canvas/surface-parity-regression.test.ts` |
| B08 | 分镜师不能创建项目，需要自定义权限 | 已验证。`projectCreate` 是独立功能区，不再按角色写死；全部项目仍可读。 | `src/lib/account/permissions.ts`；`src/components/frameos/FosAccountManagementParts.tsx` | `tests/unit/frameos/project-role-panel-permissions.test.ts`；`tests/unit/frameos/account-management-platform.test.ts` |
| B09 | “这个小东西不知道何意味” | 无法定位。工作簿没有内嵌截图，本机也没有附件 `image.png`；仅凭文字无法确定控件，不能猜测删除。 | 缺原始视觉证据 | 缺原始视觉证据 |
| B10 | 工具箱视频参考项缺少音频 | 已验证。选择器和上传接口同时接受图片、视频、音频，并显示媒体类型。 | `src/components/frameos/views/FosToolbox.tsx`；`src/app/api/frameos/toolbox/materials/route.ts` | `tests/unit/frameos/toolbox-references.test.ts`；`tests/integration/api/specific/frameos-toolbox-material-upload-route.test.ts` |
| B11 | 提示词删除位置与光标不一致 | 已验证。真实 textarea 负责输入，覆盖高亮层严格继承字形粗细并同步滚动，避免 @ 高亮造成字宽漂移。 | `src/components/frameos/materials/MentionPromptEditor.tsx`；`src/styles/frameos-replica.css` | `tests/unit/canvas/seedance-toolbox-interactions.test.ts`；`tests/unit/canvas/mention-references.test.ts` |
| B12 | 离开工具箱后提示词和资产清空 | 已验证。草稿按账号、项目和生成类型隔离，保存提示词、模型、声音、参数和有序引用。 | `src/components/frameos/views/toolbox-draft.ts`；`src/components/frameos/views/FosToolbox.tsx` | `tests/unit/frameos/toolbox-draft.test.ts` |
| B13 | 图片可添加但保存提示词提示无权限 | 已验证。读取与编辑分离，实际写操作按独立功能区校验；有写权限时前后端契约一致。 | `src/lib/account/permissions.ts`；`src/lib/canvas/access.ts`；相关路由 | `tests/unit/canvas/write-route-permissions.test.ts`；`tests/unit/canvas/permission-ui.test.ts` |
| B14 | 不能删除、不能移动 | 已验证可定位的资产/分镜对象：真实项目中角色与角色变体删除控件可用，Segment 上下移动和删除控件按首尾位置正确启停。原图缺失，无法确认是否还指另一个对象。 | `src/components/frameos/views/FosAssetSetting.tsx`；`src/components/frameos/views/FosStoryboard.tsx` | `tests/unit/frameos/manual-asset-and-panel-surface.test.ts`；运行态验收 |
| B15 | 添加道具资产弹窗无法加入 | 已验证。道具通过 `location` 资产接口以 `assetKind=prop` 创建，并刷新列表。 | `src/components/frameos/views/FosAssetShared.tsx`；`src/app/api/novel-promotion/[projectId]/location/route.ts` | `tests/unit/frameos/manual-asset-and-panel-surface.test.ts` |
| B16 | 工具箱视频生成没有权限 | 已验证。所有内置子账号默认包含 `toolboxUse`，自定义角色可单独开关；上传和生成路由统一校验。 | `src/lib/account/permissions.ts`；工具箱路由 | `tests/integration/api/specific/frameos-toolbox-material-upload-route.test.ts`；`tests/unit/frameos/account-management-platform.test.ts` |
| B17 | 人物资产与音频容易错配 | 已验证。音色记录绑定 `characterId`，资产卡显示绑定状态，视频参考按素材 ID/顺序提交。 | `src/components/frameos/views/FosAssetLibrary.tsx`；`src/app/api/novel-promotion/[projectId]/character-voice/route.ts` | `tests/unit/frameos/character-bound-voice-surface.test.ts`；语音绑定单元测试 |
| B18 | 画布文本生成节点无法拖拽 | 已验证。文本预览区为 drag handle，编辑控件继续保留输入交互。 | `src/features/canvas/nodes/CreativeNode.tsx` | `tests/unit/canvas/editor-interactions.test.ts` |
| B19 | 工具箱视频生成失败只显示“生成失败” | 已验证。与 R10 同一闭环：错误码、错误文本、任务 ID持久化并可查看。 | `src/components/frameos/views/FosToolbox.tsx`；工具箱 API | `tests/unit/canvas/seedance-toolbox-interactions.test.ts`；`tests/integration/api/specific/frameos-toolbox-generate-route.test.ts` |
| B20 | 视频成功后不能预览、历史找不到、资产库没有 | 已验证。视频使用 controls 预览；历史只查工具箱任务；完成结果绑定素材 ID并可跳到当前项目素材库。 | `src/components/frameos/views/FosToolbox.tsx`；`src/app/api/frameos/toolbox/assets/route.ts`；工具箱 worker | `tests/unit/canvas/seedance-toolbox-interactions.test.ts`；`tests/integration/api/specific/frameos-toolbox-assets-route.test.ts` |
| B21 | 余额明细 UI 不统一、看不清项目消耗 | 已验证。旧静态弹层已移除，统一进入 NoriVideo 服务记录页，展示项目成本、余额、流水与 Token。 | `src/components/frameos/FosShell.tsx`；`src/components/workspace/FrameServiceRecordsDashboard.tsx` | `tests/unit/frameos/service-records-surface.test.ts`；`tests/unit/workspace/service-records-overview.test.ts` |
| B22 | 生成历史不能预览、点击、定位项目 | 已验证。历史卡可选中，图片/视频可预览，完成项可跳到当前项目素材库并聚焦对应素材。 | `src/components/frameos/views/FosToolbox.tsx`；`src/components/frameos/views/FosMaterialLibrary.tsx` | `tests/unit/canvas/seedance-toolbox-interactions.test.ts`；`tests/integration/api/specific/frameos-toolbox-assets-route.test.ts` |

## 尚缺的原始证据

完成精确验收仍需要以下原附件中的任意一种：原文件、截图，或清楚说明控件所在页面与操作路径。

1. Bug 1：`20260723_093042.mp4`。
2. Bug 9：对应的 `image.png`（工作簿中多个条目复用同名文件，必须明确是哪一张）。
