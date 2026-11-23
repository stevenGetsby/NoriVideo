# LanmiaoTV 大画布流畅度实施计划

> **给执行 agent：** 使用 `superpowers:executing-plans` 按批次实施，并逐条完成复现、回归和前后对照；未经授权不部署。每个批次独立提交，只提交该批文件。

**目标：** 随着素材、连线和历史不断增加，打开、平移、缩放和编辑仍流畅；不靠删素材、丢历史、限用户操作或拆旧画布换速度。

**架构：** 权威图独立于渲染投影；画布只挂载当前能操作的卡片和连线，远景用有上限的概览层。重字段按节点加载，保存走有版本保护的操作。超出现有文档上限是最后一个独立扩容项目。

**技术栈：** Next.js App Router、TypeScript、React Flow、TanStack Query、Prisma/MySQL、Vitest、Playwright/Chrome。

**Spec：** [`docs/design/2026-11-21-large-canvas-performance-design.md`](../../design/2026-11-21-large-canvas-performance-design.md)；含备案机只读统计、测量口径和选型理由。

## 全局约束

- 从当前工作树确认哪些未提交改动是有效基线，不随意 reset、stash、覆盖或提交；先建立含必要改动的隔离实现基线。`AGENTS.md` 优先：只在本地/获准环境测试，不碰退役主机，不改受保护配置，不做真实付费生成，不自动发版。
- 本次不删素材、不删连线、不截断历史或引用、不改变权限和计费。展示数据不属于持久化数据；不得把未加载详情当作空值、把未渲染项当作删除。
- 先通过 179 节点／1,111 边和 1,000 节点／4,000 边；P0–P4 保持现有 1,000 节点、4,000 边、16 MiB 完整文档护栏。P5 验证后才单独提高额度。不得因省字节拒绝保存现有合规画布。
- 第一轮默认只在普通画布启用大图渲染/新数据协议；影游、只读分享、旧标签如不走新协议，保持行为不变并跑回归。用户可继续使用现有缩略图、海报先行、`@` 引用、素材上传、编辑与多标签同步。
- 实现开关分开：渲染与数据协议可独立回退。生产灰度先对单工作区开启；监控不记录标题、提示词、素材路径、签名 URL、凭证、用户 ID；产物只用合成数据。

## Review Focus

| 高风险场景 | 必须证明的行为 | 所属批次 |
|---|---|---|
| 两端都在屏外、曲线穿过视口；高出度节点超过显示额度 | 可见范围正确；未显示的边仍可查看、定位、断开，不会从生成引用中漏掉 | P1 |
| 松手同时输提示词，另一标签已保存，worker 同时回写 | 视角与内容都不丢；冲突保持 409 和合并规则，不能用旧数据覆盖终态 | P2、P3 |
| 切画布后上一个历史请求返回；未加载详情就复制、撤销或恢复离线草稿 | 响应隔离；只提交完整节点或显式补丁；不覆写任何未加载的 `history` | P3 |
| 素材列表切关键词、筛选、权限、或跨页多选 | 新旧查询不串页；选择不丢；范围、去重、条数和全选含义准确 | P4 |
| 视口很远、全部素材挤在一团；内容超出单块、跨块引用 | 每屏成本仍有上限；跨块命令原子；断网后可安全恢复 | P1、P5 |

## P0 · 建立可信基线（不改行为）

**文件：** `tests/browser/canvas-pan-performance.browser.mjs`、`tests/browser/canvas-pan-performance.fixture.tsx`；新增 `tests/browser/canvas-scale-fixtures.mjs` 和结果说明。该基准相对仓库根运行，沿用脚本支持的 `NORI_BROWSER_TOOLS_DIR`、`NORI_CHROME_EXECUTABLE`、`NORI_BROWSER_GLOBAL_CSS_PATH` 和本地样片路径。环境没有样片时，用 FFmpeg 生成短静音测试片，不取真实素材。

- [ ] 加确定性场景：小图 **40/80**；老头 A **179/1,111（108 个视频、约 7.6 MiB 历史、单节点最多 22 条入边）**；老头 B **176/724（126 个视频，缩放约 0.2）**；当前上限 **1,000/4,000**；未来 P5 **5,000/20,000**。保留稠密区、长边、画布分组、数量多但当前视野稀疏三种布局；用合成内容构造首屏载荷和媒体 URL，禁止抓生产原文或媒体。固定同节点不同边数、同拓扑不同历史体积两组对照。
- [ ] 用真实 `mouse.wheel`、中键平移及 React Flow 本体的 `setViewport` 驱动，并断言 transform 或节点位置有变化；旧脚本单独创建 D3 zoom 不足以验证缩放。删掉首屏计时里强制等待 2 秒的逻辑；分别测 API 时间/压缩字节、解码字节、首个视口可操作及首个海报完成。区分冷启动、缓存命中和连续 60 秒操作。
- [ ] 记录 Chromium/OS/GPU/DPR、分辨率、缩放档位、选择/小地图/播放状态。相同环境各跑至少 5 次，普通设备和 Chrome 4× CPU 参考档各一组，报告每次及中位数；保留 p95 帧时间和 >50 ms 帧占比，不用平均 FPS 掩盖卡顿。分段测首次打开、平移、缩放、拖单/多节点、停止后 2 秒、点 `@` 和打开历史；用 CDP/trace 区分 JS、布局、绘制、请求。额外测 DB 读行、自动保存次数与 payload、解码队列、React 活跃节点/边数、跨 5 次画布切换的堆趋势。
- [ ] 加结构性断言：未点播放时网络无视频正文且没有视频元素；真实坐标变更；请求和视觉节点数确实进入统计。把性能报告模式和可重复的硬上限断言分开；不要沿用仅以无 `pageerror` 判定 `PAN_ASSERT` 的旧口径。记录改前数据，禁止拿两台设备的绝对值作前后对比。

## P1 · 渲染投影：先让拖动、缩放跟素材总量解耦

**文件：** 新增 `src/features/canvas/rendering/{canvas-render-budget.ts,canvas-viewport-index.ts,useCanvasRenderProjection.ts,CanvasOverviewLayer.tsx}` 与对应用例；接入 `CanvasGraph.tsx`、`nodes/CreativeNode.tsx`、`components/CanvasEdge.tsx`；核对 `edge-marquee.ts`、`zoom-bucket.ts` 和素材缩略图工具。

**接口：** `CanvasRenderIndex.applyChanges({nodes, edges, removedNodeIds, removedEdgeIds})`（字段为变更集合）；`queryCanvasRenderProjection(index, { viewport, surface, selectedNodeIds, selectedEdgeIds, pinnedNodeIds, gesture, mode }): CanvasRenderProjection`，返回完整节点 ID、交互边 ID、概览格子和被折叠数量；不返回持久化文档。

- [ ] 先写纯函数测试：负坐标、DPR/CSS 缩放、宽组节点、未知尺寸、两端出屏却横跨视区的边；测试选中边和正在操作的节点优先。构造全量塞进一个格子的极端图，断言候选访问数及输出不随格子内对象总数线性增长，结果排序稳定。
- [ ] 用世界坐标网格/空间索引查视野，预留初始 **200 CSS px** 视口缓冲；改变节点大小/位置时只刷新受影响格子与相关边，边用保守曲线包围盒，长边进粗粒度索引。格子维护计数及固定数量代表项；拥挤时直接用上一层的预聚合，不先枚举所有节点再 `slice`。索引只在图或量测变化时更新，手势中通过每帧至多一次的 rAF 合并，且只有跨格、跨档或编辑态变化才重算显示集合。`CanvasGraph` 的全图派生不由像素级视角更新驱动；画布面板定位订阅自身坐标，不把整个 `nodes` 传成随手势抖动的依赖。
- [ ] 普通画布初值：完整 React 卡片最多 **80**，活跃 SVG 边最多 **160**，概览格子最多按屏幕 **32×18** 预算取样；大图在 `nodes > 80` 或 `edges > 160` 时开启。选中、键盘聚焦、拖动、编辑和播放对象优先；大量框选不把所有选中对象升成完整 DOM，以概览状态显示，命令仍作用于所有 ID。缩放 `≤0.30` 进入概览、`≥0.38` 退出（迟滞）；拥挤时即使停手也不恢复全部卡片/边，只把空余预算补给附近内容。手势期间可进一步删减装饰性渲染，保留实时连线反馈。阈值只能据基准调整，并保留硬预算。
- [ ] React Flow 收到的是显示投影，现有 `nodes` / `edges` 或后续权威 store 仍是业务来源。全图 fit、框选、查引用、分组、复制、布局、边命中及去重用权威索引；核对 `getNodes()/getEdges()`、删除回调和连接合法性，投影卸载不产生 `remove`。可视连接超过预算时给「查看 N 条连接」入口（键盘可达、列表虚拟化/分页）；允许查找、聚焦或显式解除，不能将未绘制解释为无引用。剧情线、挂载和画面引用不套普通素材线裁剪规则；普通小图默认沿用现有交互。
- [ ] 概览层用 Canvas 2D，合批画节点/组和聚合边；交互命中走索引，而不是复制一套业务状态。`CreativeNode` 只对入队可见且有预算的媒体加载 240/480 预览；缩远只画类型/标题/色块；原图、视频、音频、3D 在显式预览或播放时才挂载。画布卡片保持**最多 8 个新预览在途、最多 2 个主动播放实例**，离屏或退出时撤销未完成请求/释放；不影响独立预览窗。缩略图失败不要让成百张卡片一起回落原图，提供占位和单项重试；原素材的访问策略保持不变。
- [ ] 浏览器验收：P0 老头图和上限图返回投影而非全量；静止远景、缩放穿阈值、平移过边界、选择/框选/删除/撤销/重新连线均正确；边不可见时生成参数仍包括全部引用，拖动边恢复不改变 ID/方向/角色；确认预算检查使用**挂载数和候选访问数**，不是 CSS 隐藏数。用现有加节点/视频提示词/选择器用例复验。

## P2 · 保存和撤销：让改一个东西只处理一个东西

**文件：** `src/features/canvas/state/{useCanvasAutosave.ts,canvas-operations.ts,useCanvasHistory.ts,canvas-autosave-runtime.ts}`、`CanvasGraph.tsx`、`src/features/canvas/api/client.ts`、`src/lib/canvas/{operations.ts,persistence.ts}`、`…/canvas/[canvasId]/ops/route.ts`；测试 `tests/unit/canvas/{operations,persistence,autosave-runtime}.test.ts` 及专项浏览器回归。

**接口：** `CanvasChangeBatch = { epoch, viewport?, dirtyNodeIds, removedNodeIds, dirtyEdgeIds, removedEdgeIds }`；`buildCanvasOperationsFromChanges(confirmed, current, changes): CanvasOperation[]`。`epoch` 为本地单调递增标记，不代替服务端 `expectedRevision`。命令路径和首次迁移过渡期间，旧 `buildCanvasOperations` 保留为正确性对照/完整文档回退，不是拖动热路径。

- [ ] 写测试：179 或 1,000 节点的画布仅改视角时只发一个 `canvas.update_meta { viewport }`，不构造/比较节点文档，不重存离线正文；改一个节点位置只读取该节点和必要附属对象。与普通终点、双击检查、批量拖动、移除或恢复同一节点混合时，操作序列与现有 full diff 的业务结果一致。
- [ ] 在所有正常命令入口标脏，移动中只更新即时坐标，停止时合并一批。视角单独 debounced；有内容脏时整合到同一版本提交，已在途的变化按 `epoch` 区分，确认耗尽的批次才清脏。409 后按现有流程合并再重试，不能盲覆盖；权限变化、离线回放、删除前后多操作队列保留现有语义。待处理操作及最少恢复数据写 IndexedDB，旧全量草稿仍可读。首次录制离线基础状态可以重，但不得每次移动重新克隆或比较全图。
- [ ] 服务端沿用 `/ops`、兼容老客户端、权限与 CAS。对 **delta 客户端且唯一操作是 `canvas.update_meta` 且只含 viewport**，验证不存在需要执行的整图快照后走 metadata-only 分支，仅返回更新的 canvas 与空 delta；若按当前策略到快照点，保留完整快照路径并专项测量，不能悄悄跳过审计或快照。用 transaction spy 验证非快照分支不查 `canvasNode`/`canvasEdge` 数据。新协议标志不匹配或旧客户端仍拿原整图响应，不下放一个不完整的文档。
- [ ] `useCanvasHistory` 用命令级、不可变 before/after 实体差量实现撤销/重做，只为实际修改的项存值，不克隆整张图或让 undo 拿到可变 React Flow internals。保留默认 80 步语义；大批量命令一次成组；覆盖删除含子节点/外部引用、复制、批量移动及临时选中状态。生产 `CanvasSnapshot` 与 UI 撤销分开，不夹带修改历史保留策略。
- [ ] 回归：两标签同时改不同节点和同节点；保存中继续拖动；断网重进；服务器生成任务在保存期间从 `RUNNING` 到终态；撤销离屏节点后打开详情。验证无丢失、无假成功、无多余 409 风暴；记录与播放、缩放并行时的 Chrome trace。

## P3 · 首屏轻图与重详情：把历史和长提示词移出热路径

**文件：** `src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts`、`…/nodes/[nodeId]/route.ts`（新增 GET，保留已有 DELETE 行为）；新增 `src/lib/canvas/graph-summary.ts`；接入 `src/features/canvas/{types.ts,api/client.ts,state/useCanvasSync.ts,CanvasGraph.tsx,components/CanvasDialogs.tsx}`。涉及 `src/lib/canvas/generation-reconciliation.ts`、`src/lib/task/public-presentation.ts`、`…/ops/route.ts` 与所有读 `data.history` 的调用点。

**接口：**
- `GET …/canvas/:id?view=summary-v1 -> CanvasGraphSummaryV1 { kind: 'summary-v1', canvas, nodes: CanvasNodeSummaryV1[], edges }`。节点白名单只包含 ID、位置/大小、类型、标题、分组与端口所需字段、当前缩略图/稳定媒体引用、状态、必要任务 ID/进度、当前积分摘要、`historyCount`、`detailVersion`。角色 ID 和完整拓扑仍在。**不是 `CanvasGraphResponse` 或 `CanvasDocumentInput`**。
- `GET …/nodes/:nodeId?view=detail-v1 -> CanvasNodeDetailV1 { kind: 'detail-v1', detailVersion, node }`，仅供确需完整可写节点的操作。打开历史先用 `view=history-v1&limit=20&cursor=...`，返回 `{ kind: 'history-v1', detailVersion, items, nextCursor }`，稳定以 `(createdAt,id)` 排序，页内不含长提示词或完整引用。展开条目改用 `view=history-item-v1&entryId=...`，返回 `{ kind: 'history-item-v1', detailVersion, item }`；条目 ID 也必须属于该节点。`detailVersion` 取可区分 worker 异步回写的节点版本，不仅用 `canvas.revision`。统一 `requireProjectAuthLight` + `requireCanvasInProject` + 节点归属检查，沿用公开字段清洗，详情缓存按账号、项目、画布、节点、版本隔离。

- [ ] 写契约测试：同一合成图的旧接口返回原始完整结构；summary 不含大字段并与历史条数、组、连线和当前任务一致；新版端点跨项目/跨画布不可读，错误与只读场景遵循既有权限。摘要 ETag 基于该表示本身，异步生成完成（画布 revision 未变也可能）后不能返回过期 304。
- [ ] 真正缩短读取链路：可先在服务器构造白名单以减少序列化和下发；随后用参数化投影 SQL 或现有 Prisma 可维护的摘要读取路径，只取必要 JSON 路径和历史计数，把历史对象本身留在数据库。需要终态对账的节点单独批量读取和对账，不得因摘要接口跳过回写/状态修复。分别测 DB→应用、应用→浏览器；只打掉网络体积不能宣称后端也优化了。若需额外持久化摘要列，另拆迁移，不用无上限缓存伪装成修复。
- [ ] UI 按节点 ID/详情版本缓存；先画首屏，请求在选中、编辑、查看历史、再生成、需要完整节点的复制/导出时触发。详情 cache 初值 **最多 24 个节点或约 16 MiB**（可回收条目，按先达到者；活动编辑、未保存草稿及离线恢复数据通过独立的编辑状态保护），并发 **4**；取消离开后的未消费请求，旧请求不得覆盖新版本和本地编辑。项目切换清隔离状态。历史对话框页级加载，当前素材启用/错误、积分标签、`@`、活动任务进度仍能正常显示。
- [ ] 先做防丢写入再开启新 GET：`node.upsert` 只接收完整节点，编辑器需要时显式 hydrate 目标，并通过节点版本检查/现有终态保护处理与 worker 的竞态。几何移动/尺寸新增明确的 `node.update_geometry { id, position?, size? }` 操作，服务端只动这两个字段；绝不把摘要对象传给 `/document`、快照或 upsert。新版 `ops` delta 与冲突重读保持同种表示或显式区分 payload 类型，不允许下次保存把“未返回”解释成删除。新 UI 从完整数据恢复或把基线迁回旧协议之前，必须先验证未保存的命令已安全落盘/可重放。旧客户端继续使用原全量路由；模板、导出和版本恢复走现有完整服务端路径，不把重数据搬回首屏。
- [ ] 回归：带 14 条历史的节点移动/改名/复制/删除撤销，剩余旧历史逐项相等；初次点击历史后切画布，迟到响应不串；开启轻图后另一标签提交或任务终态回写时，未加载历史不回退；离线草稿刷新后仍能恢复。录像验证首屏不主动请求历史和原视频。若某功能仍需完整图暂不兼容，将其画布留在旧路径，报告覆盖范围，不能以丢字段绕过。

## P4 · 素材面板分页、索引和列表虚拟化

**文件：** `src/features/canvas/components/{CanvasProjectAssets.tsx,CanvasReferencePickerDialog.tsx}`、`src/components/frameos/materials/{MaterialPickerDialog.tsx,fetch-all-materials.ts}`、现有 `/api/frameos/materials` 服务端分页链路；单独加面板回归，不删其他调用方可能依赖的 `fetchAllFrameosMaterials`。

- [ ] 先用 10,000 条合成素材验证失败：只开面板不能把余下页面一网打尽；滚到末尾或输入关键词才请求。客户端按游标每页 **48** 条、网格最多 **96** DOM 项（含缓冲），取消上一筛选请求；作品范围、媒体类型、共享来源、归类、搜索在服务端先筛后分页，稳定 `createdAt,id` 游标。
- [ ] 选择状态独立于页面与 DOM，用稳定 ID 集合；已有「全选」需明确“当前结果”还是“已加载”，不悄悄改含义。若原来全选全量结果，用匹配查询并带排除项或服务端按页解析，禁止静默截断；添加到画布时沿用用户可见容量/选择限额。继承去重不能简单在每页独立处理导致翻到下一页重复，分页契约必须稳定。素材计数不能拿当前已加载数冒充总数。
- [ ] 回归跨页选中、换筛选、作品权限变更、失败重试、重命名、拖入画布以及 `@` 自动连线；验证全局搜索可以找到未加载项、不新增 TOS 费用路径、媒体加载利用 P1 预览策略。

## P5 · 超出当前文档上限（独立立项；不跳过）

**接口边界：** 在 P1–P4 过线后再实现版本化 `canvas manifest`、带游标的视口 chunk、按节点搜索/详情和按操作的写入。现有 `CanvasNode.position` 为 JSON，不能把无索引的全表范围扫描当作流式后端。

- [ ] 先测 5,000／20,000 合成图的每块上界。设计有索引的世界坐标 chunk：稳定分块 key、对超长边或超大组的粗层条目、可裁剪的边端点索引。首屏只取 manifest、可见粗图和少量块；正常平移只取进入预取圈的新块；跨块边去重按稳定 ID，连接和搜索可以定位未加载节点。每个响应有分页和字节上限，禁止一次响应抛回完整图。客户端用 LRU 限活跃块，选中/编辑/未同步块固定；回收不是业务删除。
- [ ] 画布命令在一个事务里更新跨块关系并维持 revision 条件，覆盖节点连线与分组、撤销重做、离线日志与恢复。服务端历史改为可逐块读取的版本清单/快照或检查点加增量，先做全量一致性验证；**保留旧 16 MiB 文档机制，不给已经超过上限的新图假称可以由旧 UI 完整写回。** 新格式写入前要有影子读取、对账、版本协商、只读兼容/关闭写入的回滚步骤，再申请生产迁移与单独开关。
- [ ] 过门条件：同视野从 1,000/4,000 增长到 5,000/20,000，DOM/在途媒体/可驻留分块仍有上限，帧时间 p95 增幅 **≤20%**（同设备、同视觉拥挤度），同时下载和恢复都不需要单个整图请求。未过只交付现有容量内的优化，不许改限额或宣传“无限画布”。

## 发布门槛

| 指标 | P1–P4 初始验收目标；先采改前值 |
|---|---|
| 平移/缩放/拖节点 | 老头图与当前上限图：约定 60 Hz 普通桌面档 p95 帧间隔 ≤25 ms；4× CPU 参考档 ≤33.4 ms，>50 ms 的帧比例 ≤1%；停手后记录保存阶段，不排除这段再算帧率 |
| 首屏负载 | 老头 A 对照夹具，首屏 graph 响应传输字节减少 ≥75%；无历史明细/未激活视频请求。独立列出 over-the-wire 与解码字节，压缩设置一致 |
| 纯视角保存 | 不发节点/边写入、不构造节点/边 diff；非快照 delta 服务端不读整图。4× CPU 参考档客户端调度至请求前的同步工作 p95 ≤8 ms（不含 debounce 等待和网络） |
| 行为/数据 | 权限、计费、引用、生成模拟、剧情、导入导出、历史、撤销、冲突和离线不回退；小图不改变默认表现 |

- 测试起点：`BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/canvas tests/unit/projects/canvas-routes-scope.test.ts`；补跑各批新增契约和浏览器对照，`npm run check:api-handler`；再检查本批 lint/TS。仓库已有失败须在同一基线上对照，记录原样，不能把基线失败记成已通过。
- 按 **P0 → P1 → P2 → P3** 逐个验收；P4 可以单独发布，P5 必须另审。P1/P2 第一批不迁移；P3 保留老协议和本地关开关的兼容测试。任何一批都不夹带无关工作树改动。
- 交付要求：附配置与种子、同机前后表、Chrome trace、数据完整性用例和回退步骤；灰度前需用户批准。灰度后看大图 GET 和 ops 的耗时/字节、5xx、409、未保存草稿和交互指标。出现保存/历史丢失、引用/权限回归立即关对应开关，按现有发布流程回退应用；不清业务库、不回写旧数据库快照。

## 2026-11-22 本地验收记录

**已测通过的门槛：** M4、Chrome 152.0.7977.65、Metal、1440×900、DPR 2、压缩 production React、固定种子 1。`laotou-a` 与 `limit-1000` 分别以 CPU×1、CPU×4 各跑 5 次，共 20 次；无脚本结构错误、无浏览器异常。

| 夹具 | CPU | 交互最差 p95 | >50 ms 比例最大值 | 纯视口保存同步 p95 最大值 |
|---|---:|---:|---:|---:|
| 老头 A：179 / 1,111 | ×1 | 16.8 ms | 0% | 0.2 ms |
| 当前上限：1,000 / 4,000 | ×1 | 16.8 ms | 0% | 0.1 ms |
| 老头 A：179 / 1,111 | ×4 | 16.8 ms | 0.89% | 0.7 ms |
| 当前上限：1,000 / 4,000 | ×4 | 16.8 ms | 0.60% | 0.8 ms |

对照的 ×4 上限图曾出现滚轮缩放 p95 49.9 ms、长帧 3.85%；延迟概览升档后，五轮最差缩放 p95 为 16.8 ms。纯视口请求每次只包含一个 `canvas.update_meta`。上限图真实框选包括尚未挂载的节点，验证全部选中节点移动相同手势位移，并核对保存的节点 ID 和坐标。离线几何草稿不载入全图详情，不替换服务器正文或历史。

复跑：在项目根目录配置 `NORI_BROWSER_TOOLS_DIR` 和 `NORI_BROWSER_GLOBAL_CSS_PATH`，使用 `PAN_SCENARIOS='["laotou-a","limit-1000"]' PAN_RUNS=5 PAN_CPU=4 PAN_GPU=metal PAN_SWITCH=0 PAN_ASSERT=1 PAN_BUDGET=1 PAN_OUT=codex-final-cpu4.json node tests/browser/canvas-pan-performance.browser.mjs`，再以 `PAN_CPU=1`、`PAN_OUT=codex-final-cpu1.json` 复跑。逐轮证据在 `test-results/canvas-pan-performance/codex-final-cpu{1,4}.json`；测试只使用合成节点和拦截 API。

**DB→应用与应用→浏览器分开测：** 在独立、禁网络、仅 Unix socket 的本地 MySQL 实例中装载老头 A。179 个节点的应用收到的行 JSON 从 7,897,731 降到 127,486 B（约 **98.4%**，不是 MySQL 协议字节）；同夹具 graph gzip 从 167,892 降到 22,477 B（约 **86.6%**）。5 次本地读取中位数 64.9→49.7 ms。新数据库投影和原完整节点 JS 投影逐节点比对，除不透明版本标识外相同。合成用例另验证历史计数、当前积分、详情权限范围、历史内容变化但画布 revision 不变时的版本更新。结果：`test-results/canvas-pan-performance/codex-db-projection-smoke.json`。仅本地实测，不代表备案机延迟；MySQL 生产镜像尚未在这一轮实跑。

**素材窗口与 trace：** `material-interactions.browser.mjs` 真实组件回归通过。10,000 条素材首次只读 48 条，继续滚动按游标加载，搜索可找到未加载的第 9,999 项；查询变化保留同一资产范围内已选素材，窗口最多 96 卡片。单独采集 `test-results/canvas-pan-performance/trace-limit-1000.json` 和 `codex-trace-cpu4.json`，不把 trace 运行混入上面的五轮采样。

**离线浏览器回归：** 老头 A 在 CPU×4 下断网拖动，验证 IndexedDB 存入不含任何节点正文或连线的 v2 几何草稿；联网重载后选择恢复，坐标与断网拖动一致，重放请求只含一个 `node.update_geometry`。结果在 `test-results/canvas-pan-performance/codex-recovery-cpu4.json`（用 `PAN_RECOVERY=1` 复跑）。

**回退：** 发布时仅对 `NEXT_PUBLIC_NORI_CANVAS_PERFORMANCE_WORK_IDS` 列出的业务项目启用。两个独立编译时开关：`NEXT_PUBLIC_NORI_CANVAS_SUMMARY_V1=1`、`NEXT_PUBLIC_NORI_CANVAS_PROJECTION=1`，均默认不在生产启用，影游保持旧路径。关闭轻图回到同一个 GET 的完整图视图；保留当前文档护栏。旧浏览器不会把新的几何草稿当作完整文档；如关闭新功能前有本地草稿，应先用支持该草稿格式的版本完成恢复或明确放弃。

**并发、历史与长时补测：** 共享同一浏览器上下文的实际双标签夹具中，A 的几何保存挂起，B 保存正文后模拟 worker 在不递增画布 revision 的情况下回写视频终态；A 实际收到 409、重读完整图并只重放几何，两个标签的编辑、视频终态和旧历史均精确保留（`tests/browser/canvas-agent-panel.browser.mjs`）。这不是实际队列 worker 或真实供应商的验收。`PAN_HISTORY_RACE=1` 验证了已发出的上一画布历史请求在切页后即使返回也不会串页。CPU×4 上限图连续操作 60 秒，强制 GC 后堆 16.9→17.0 MiB；6 次切换没有单调增长。产物分别在 `codex-history-race-cpu4.json`、`codex-limit-soak-cpu4.json`。

**额外布局正式验收：** 老头 B、千节点长边、分组及稀疏视口，每个布局 CPU×1、×4 各 5 轮，共 40 轮，结构断言和帧预算全部通过。两档交互最差 p95 均为 16.8 ms；长帧比例最高分别为 0%、0.61%。分组夹具检验普通节点只写几何、成员变更组才写分组字段；稀疏夹具验证视口内多选真实移动，不冒充密集视口超预算验证。原始产物：`codex-extended-formal-cpu{1,4}.json`。

**独立数据库复验：** `bash scripts/qa/canvas-worker-cas-local.sh` 在禁网络的临时 MySQL 实例中通过。实际应用协调器从合成终态任务/素材行写入节点；事件不递增画布版本；真实 SQL 拒绝过期的 A 写入，几何重放后终态、旧历史与 B 正文全部相同。此测试不运行付费 worker 或实际队列。

**后续复验（2026-11-22 晚）：** 真实 BullMQ 视频 Worker 在独立 Redis/MySQL 上经过端到端并发验收（供应商及存储 I/O 替身）；正文、生成终态、旧历史和几何重放相互隔离。生产灰度仍未完成，未推送、未部署。

**完整样式性能复验未过，以上早期帧时间不能作为放行证据。** 早期基准使用未编译的 `src/app/globals.css`；本地 fixture 未解析其中的主题 `@import`，导致测量遗漏完整样式的渲染成本。本轮使用完整编译 CSS，各档各场景 5 次，几何保存与结构断言均通过，但 CPU×1 多选拖拽 10/10 次超预算（最差 p95 50 ms，长帧最高 4.96%），CPU×4 有 1/10 次超长帧比例（1.02%）。原始记录见 `test-results/canvas-pan-performance/sync-audit-cpu{1,4}.json`。

后续必须先编译 CSS，例如 `node scripts/build-browser-fixtures.mjs material-interactions`，给 `NORI_BROWSER_GLOBAL_CSS_PATH` 传 `test-results/material-bundles/global.css`，不要使用该脚本生成的开发版画布 JS。性能脚本现在拒绝未编译输入，验证主题令牌确实生效，并把所用 CSS 哈希随结果记录。
