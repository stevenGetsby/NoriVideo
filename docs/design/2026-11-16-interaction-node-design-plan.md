# 影游画布：互动节点（玩法单元）设计与实现文档

日期：2026-11-16　角色：互动影游设计 → 由 qwen4max 实现。本文自成一体，照做即可，不需要再问用户。

## 这份文档在解决什么

现在画布上的「互动节点」只是一个**参数卡**：选类型、填次数、连结果线。它没有自己的画面，没有预览，没有反馈设计，创作者无法判断"玩家在这一秒到底看到什么"；独立摆放时（不挂在片段上）试玩直接是黑屏。

本文把它做成一个**可玩的镜头单元（shot unit）**。一个互动节点由四部分组成，缺一不可：

| 组成 | 内容 | 谁来定 |
|---|---|---|
| **玩法** | 六种之一：限时抉择 / 快速点击 / 方向滑动 / 时机点击 / 长按蓄力 / 隐藏热区 | 已有，本文补难度预设 |
| **画面** | 玩家做这个互动时看到的底图。挂载时=宿主片段视频；独立时=自己的画面节点，或上一段最后一帧，或设计过的占位 | **本文新增** |
| **提示与反馈** | 提示文字（已有）、结果口文案（已有）、失败重来（已有）；新增卡内实时预览 | 部分新增 |
| **结果分支** | 成功 / 失败 / 完美 / 普通 / 失误 / 超时 / 选项 / 热区 → 各自连下一段 | 已有，本文补校验 |

一句设计原则：**互动节点只是"引用"素材，绝不复制或独占素材。**画面永远属于制作层（视频节点 / 图片节点 / 片段视频），互动节点只持有指向它的那条连线。这条原则决定了下面所有实现细节。

## 全部功能改动一览

| # | 现状 | 改完创作者看到什么 | 章节 | 批次 |
|---|---|---|---|---|
| 1 | 互动节点顶部只有「挂到片段」口，装不进画面 | 独立摆放的互动节点顶部多一个「画面」口，和片段一样能接视频/图片节点 | §B.1 §B.2 | 一 |
| 2 | 限时抉择节点的 `backdrop` 在 types/compile 里早就有了，画布上却接不进去（三处 `story_scene` 硬门禁） | 限时抉择节点也能接自己的画面，独立抉择不再借用上一段的黑屏 | §B.2 §B.5 | 一 |
| 3 | 编译出来的互动节点没有画面字段，播放器只能用上一段的视频且从头 `loop` | 独立互动/抉择按「自己画面 → 上一段最后一帧定格 → 设计过的占位」三级回退，不再黑屏 | §B.4 §E.2 | 一 / 三 |
| 4 | 卡片是一串无分组输入框，看不出玩家看到什么 | 卡片顶部多一张**画面预览**（作品宽高比 + 玩法示意叠层），下面按「画面 / 玩法 / 提示 / 结果」分区 | §C | 二 |
| 5 | 六种玩法的参数要靠创作者自己猜（点多少次算难？） | 每种玩法一组「简单 / 普通 / 困难」一键预设，只改编辑器字段，不动引擎 | §D | 二 |
| 6 | 独立互动没画面时没有任何提示，试玩才发现是黑的 | 校验面板报「互动…没有画面，试玩会是黑屏」，可定位到节点 | §B.6 | 二 |
| 7 | 播放器 `<video>` 没有 `onError` / 加载态，签名失效或解码失败就是一坨黑 | 失败显示「画面加载失败 · 跳过」，加载时显示占位，不再是无声黑屏 | §E.3 | 三 |
| 8 | 播放器用 `toDisplayImageUrl` 直连，未走画布那条 `playback=1` 代理 | 播放器视频与画布同源同策略，省流量且失败率一致 | §E.4 | 三 |
| 9 | 播放器子树没有 `.nori-force-dark`，浅色主题下舞台是接近白色的 | 无论界面主题，舞台恒为深色（影游播放本来就该是深色） | §E.5 | 三 |

## 执行规则

- **R1 不改数据模型**：全部字段落在节点 `data` 与 `InteractiveStory.config` JSON 内，无 DB schema 变更，不动任何 API 路由。新增素材走现有 `POST /api/interactive/[workId]/assets`（`uploadStoryAsset`）。
- **R2 旧作品逐字节兼容**：所有新字段宽松读取（沿用 `src/lib/interactive/compile.ts` 里 `record / text / id / positiveNumber` 的风格），缺省即旧行为。互动节点没有 `picture` 字段时，编译结果与今天完全相同。**不允许**因为新增字段改变任何既有 handle 集合、`startSec`、`durationSec`、`results` 的含义。
- **R3 纯函数先行**：端口判定、画面解析、难度预设、预览示意图、校验规则全部进 `src/lib/interactive/` 或 `src/features/canvas/story/*.ts`（无 JSX 的纯模块），配 vitest 单测。React 组件只渲染这些纯函数的结果，不在组件里写判定。
- **R4 画面不复制**：画布上任何时刻只有一条「画面」连线指向互动节点；画面节点本身仍然可以被别处引用（同一张图给多个互动用是合法的，和视频节点给多个片段用一样）。**禁止**把视频/图片 URL 抄进互动节点的 `data`。
- **R5 一次共享修复**：限时抉择的 `backdrop` 与互动节点的画面必须走**同一处**连接层改造（§B.2），不许各写一套。旧字段 `backdrop` 名字不动。
- **R6 引擎不动**：`engine.ts` 的 `resolveBeat / settle / startRun` 签名与流程一行不改。画面是播放层的事，编进 `StoryInteractionNode` 只是多一个可选字段供 `PlayerStage` 读。**如果发现需要改引擎才能做，说明本文设计错了，停下来回报用户。**
- **R7 流量约束**：画布上一律用海报图（`toVideoPosterUrl(url, 480)` 或 `posterUrl`），同时最多一个活的 `<video>`。卡片预览**不许**挂 `<video>` 自动播放。理由：出口流量按 GB 计费，影游视频代理曾占全站流量约 87%（见 `docs/design/2026-11-14-performance-traffic-login-plan.md`）。
- **R8 细节冲突时按此优先级取舍**：不出逻辑 bug（分支走错、数值错、存档错、悬空 handle）> 旧作品不变 > 素材不重复 > 操作少一步 > 好看。冲突时砍后者。
- **R9 不许自行加功能**：不加本文没有的互动类型、不加「互动皮肤商店」、不加音效系统、不加「从任意节点开始试玩」（那需要给 `startRun` 加新的起点选项，违反 R6）。觉得缺什么写进部署记录「建议」。
- **R10 文档与代码不一致就停**：任何 file:line 锚点对不上（代码已被人改过），停下来回报，不要按自己的理解猜。

## 全局逻辑红线（三个批次验收都过一遍）

1. **一个互动节点最多一条画面线**：`applyStoryConnection` 的 `media` 分支已经保证了「一个 target 只留一条非 flow 非 mount 的入线」，改造时沿用这条约束，把门禁从 `story_scene` 放宽到 `isStoryMediaTarget`，**不要**放宽「只留一条」。
2. **挂载优先**：互动节点同时有画面线和挂载线时，画面线**不参与播放**（挂载时画面跟随宿主片段），但仍然保留在画布上、仍然可删。这不是错误状态，是允许的（创作者可以先备好画面再挂载），只是报一条 warning（§B.6.3）。
3. **画面解析必须排除挂载线与剧情线**：`resolveNodeMedia` 的入线过滤要同时排除 `STORY_FLOW_ROLE` 与 `STORY_MOUNT_ROLE`。漏掉 mount 会把宿主片段当画面，造成"自己接自己"的死循环观感。
4. **端口永不指向不存在的 handle**：新增的 `media` 口在互动节点上是**常驻**的（不像结果口随玩法变），所以不新增 `STORY_HANDLE_PATCH_KEYS`。断线由用户手动删，删除时不弹窗（和片段画面一致）。
5. **预览不发起网络请求**：卡片预览只用已有 URL 拼 `MediaImage`，尺寸固定，`sizes` 写死（如 `sizes="260px"`），不许触发新的一次签名请求洪水（一次渲染一次请求，别放进 rAF 循环）。
6. **不出现第二套画面语义**：片段用 `media` 口，互动用 `media` 口，抉择用 `media` 口，三处同一个 `STORY_MEDIA_HANDLE` 常量、同一个 `isStoryMediaTarget` 判定、同一段 `applyStoryConnection` 分支。

---

# §A 设计基线：互动节点是什么

## A.1 两种摆放方式，画面规则完全不同

| | 挂载（mounted） | 独立（standalone） |
|---|---|---|
| 怎么放 | 从片段的底部「互动口」拖出，或从卡片顶部「挂到片段」口接上去 | 接在剧情线的中间/末端，或直接由选项连进来 |
| 什么时候触发 | 宿主片段视频播到 `startSec`，在片段画面上叠 UI | 剧情走到这个停靠点，弹出一整个舞台 |
| 画面从哪来 | **宿主片段的视频**（在 `startSec` 附近的那几秒） | **自己的画面** → 上一段最后一帧 → 占位（§B.4） |
| 互动时画面 | 继续 / 慢放（0.25×）/ 定格（已有 `during`） | 同上，但作用于自己的画面 |
| 作者心智 | "这一段打到第 6 秒，观众要狂点" | "剧情走到这里，是一个独立的互动关卡" |

这是互动影游的两种真实用法：**QTE 叠在正片里**，和**独立小关卡**。前者画面绝不该由互动节点自带（否则正片和 QTE 背景会打架），后者必须有画面（否则就是黑屏）。所以「画面口」只对**独立**摆放有意义 —— 挂载时它被忽略。这个区别必须写在卡片上（§C.2 的挂载文案）。

## A.2 六种玩法与它们的「素材刚需」

| 玩法 | 玩家做什么 | 最适合的剧情位置 | 素材刚需 |
|---|---|---|---|
| 限时抉择 choice | 倒计时内选一项 | 关键分岔、要不要开门 | 可带选项图；**需要有画面** |
| 快速点击 tap | 限时内连点 N 次 | 砸门、拽绳、挣扎 | 按钮文字/图片（可选） |
| 方向滑动 swipe | 按方向滑一次 | 闪避、推门、甩箭 | 方向箭头（可选文字/图） |
| 时机点击 timing | 指针扫过时点中区间 | 格挡、跳跃、点穴 | 道具图（可选） |
| 长按蓄力 hold | 按住蓄力，区间内松手 | 拉弓、蓄力重击、屏息 | 按钮文字/图片（可选） |
| 隐藏热区 hotspot | 点画面里看不见的触发点 | 侦探找线索、翻箱倒柜 | **必须有底图**（`frameImageUrl`），否则玩家在盲点 |

只有 `hotspot` 是**今天就有素材字段**的（`frameImageUrl`）。但它是互动自己的**一帧静图**，用于热区坐标归一化，**不是**"互动播放时的画面"。两者别混：`frameImageUrl` 是热区编辑与命中的坐标系基准，`picture`（本文新增）是播放时的底图。当两者都存在时，播放时用 `picture`，热区仍按 `frameImageUrl` 的宽高比换算（现有 `hotspotAt` + `mediaContainBox` 逻辑不动）。

## A.3 每个互动节点必须回答的四个问题

做设计评审时按这个顺序问创作者，四个都答不上来就不是一个合格的互动节点：

1. **为什么这里要互动？**（叙事动机：阻止、选择、发现、手感）
2. **玩家看到什么？**（画面：哪段视频/哪张图/哪一帧）
3. **他做对/做错，剧情怎么走？**（结果口是否都连了线）
4. **失败了会不会卡死？**（是否勾了「失败重来」，或失败口连到结局/安全分支）

第 3、4 条已由校验覆盖（`result_unlinked` / `stale_flow`）；第 2 条是本文补齐的（§B.6）。

---

# §B 画面：数据、连线和编译

## B.1 数据模型

`src/lib/interactive/types.ts`，`StoryInteractionNode`（现 189-202 行）新增一个**可选**字段：

```ts
export interface StoryInteractionNode extends StoryNodeBase {
  kind: 'interaction'
  spec: StoryInteractionSpec
  hint: string
  durationSec: number
  during: StoryBeatDuring
  mountedOn: string | null
  startSec: number
  results: Record<string, StoryResultConfig>
  /** 独立摆放时的底图：画面节点连进来的视频或图片。挂载时恒为 null（画面跟随宿主片段）。
   *  缺省 = 没有自己的画面，播放器回退到上一段最后一帧，再回退到占位。 */
  picture?: StoryMedia | null
}
```

同步给 `StoryChoiceNode` 的 `backdrop` 补一句注释说明它现在**可以从画布连进来了**（该字段已在 types.ts:185-187 存在，无需改动类型，只改注释）。

节点 `data` 上**新增零个字段**。画面完全由连线表达 —— 这是 R4 的落地方式：URL 只存在素材节点的 `data` 里，互动节点 `data` 里一个字节都不多。

## B.2 连接层：一次改造，三处受益（**本批次最关键的改动**）

现在有三处硬编码 `story_scene` 把画面挡在门外。全部改成一个共享判定。

### B.2.1 新增判定（`src/features/canvas/story/story-connection.ts`）

在 `STORY_MEDIA_SOURCE_TYPES`（第 14 行）下面加：

```ts
/** 可以接「画面」口的节点：片段（制作层画面）、互动节点与限时抉择（独立停靠点的底图）。 */
export const STORY_MEDIA_TARGET_TYPES = new Set(['story_scene', 'story_interaction', 'story_choice'])
export const isStoryMediaTarget = (type: string | null | undefined) => STORY_MEDIA_TARGET_TYPES.has(type ?? '')
```

### B.2.2 三处门禁（逐个改，语义不同别一把梭）

| 位置 | 现在 | 改成 |
|---|---|---|
| `story-connection.ts:73-77`（`resolveStoryConnection` 的 media 分支） | `if (scene.type === 'story_scene' && STORY_MEDIA_SOURCE_TYPES.has(media.type \|\| ''))` / 否则 `'片段顶部的画面接口只能连接视频或图片节点'` | `if (isStoryMediaTarget(scene.type) && STORY_MEDIA_SOURCE_TYPES.has(media.type \|\| ''))` / 否则 `'画面接口只能连接视频或图片节点'` |
| `story-connection.ts:86-88`（从素材节点往右拖） | `if (to.type === 'story_scene' && STORY_MEDIA_SOURCE_TYPES.has(from.type \|\| ''))` / 否则 `'只有视频或图片可以连到剧情片段作为画面'` | `if (isStoryMediaTarget(to.type) && …)` / 否则 `'只有视频或图片可以连接为画面'` |
| `story-apply`（同一函数 108-115 行 `applyStoryConnection` 的 media 分支） | 已经 target 无关（只看 `edge.target === plan.target`） | **不动**，只需确认 `intoScene` 的注释改写为 `intoTarget` |

变量名 `scene` 顺手改成 `target`/`host`，别留下误导性命名。

### B.2.3 几何层（`src/features/canvas/story/story-geometry.ts`）

| 行 | 现在 | 改成 |
|---|---|---|
| 93 | `if (input.target.type !== 'story_scene') return null` | `if (!isStoryMediaTarget(input.target.type)) return null` |
| 109 | `if (handleId === STORY_MEDIA_HANDLE) return node.type === 'story_scene' ? 'media-pick' : null` | `… ? 'media-pick' : null` → 判定改 `isStoryMediaTarget(node.type)` |
| 128 | `if (role === 'media') return node.type === 'story_scene' ? port(…) : []` | `isStoryMediaTarget(node.type) ? port(…) : []` |
| 152 | `from.type === 'story_scene' && hitIsMedia` | `isStoryMediaTarget(from.type) && hitIsMedia` |

**注意 152 行的连带效应**：从互动节点的画面口往外拖、落在素材节点上时走的是 `portsFor` 分支（因为 `role === 'media-pick'` 已被 151 行的 `role === 'media-pick'` 短路），所以 152 行改动只影响"从片段/互动/抉择的画面口拖出后落在素材节点上"的区域判定。改完请在测试机各拖一遍三张卡确认吸附点正确。

### B.2.4 连线的视觉（`src/features/canvas/components/CanvasEdge.tsx:60`）

```ts
const storyEnds = sourceNode && targetNode && (storyLine || targetNode.type === 'story_scene')
```

改成 `(storyLine || isStoryMediaTarget(targetNode.type))`。不改的后果：互动节点的画面线拿不到 `storyMediaAnchor` 的锚点（走默认 React Flow 端点），`storyClass` 也不会是 `is-story-media`，虚线样式与颜色跟片段画面线不一致，且 93 行的删除按钮文案 `'移除片段画面'` 需要按 target 类型分支。

第 93 行同步改成：

```ts
const deleteLabel = storyFlow ? '断开剧情连线' : storyMount ? '从片段上取下互动' : targetNode?.type === 'story_scene' ? '移除片段画面' : '移除互动画面'
```

### B.2.5 拒绝文案（`src/features/canvas/story/useStoryCanvasActions.ts:84-94`）

```ts
if (role === 'media' || STORY_MEDIA_SOURCE_TYPES.has(hit.type || '')) return '视频和图片只能作为画面，请连到片段或互动顶部的画面接口'
```

（原文 `'视频和图片只能作为剧情片段的画面，请连到片段顶部的接口'`，互动节点也能接之后必须改，否则文案说假话。）

### B.2.6 线菜单与新建画面节点

`useStoryCanvasActions.ts:221`：

```ts
if ((role === 'media' && type !== 'story_scene') || …) return false
```

改成 `(role === 'media' && !isStoryMediaTarget(type))`。

`:229-245` 的 `createSceneMedia(sceneId, type)` 泛化成 `createPictureNode(targetId, type)`：

- 参数改名 `sceneId → targetId`，内部所有 `scene` 变量改名 `target`；
- toast 文案改为中性：`'已在片段上方腾出画面位置'` → `'已在上方腾出画面位置'`；
- **调用点已核对：全库只有两处**，`StoryCanvasContext.tsx:46`（`StoryCanvasActions` 类型声明）与 `useStoryCanvasActions.ts:409`（return 对象）。没有组件在调它，所以**直接改名 `createPictureNode` 即可，不需要保留旧名包装**。类型签名同步改成 `createPictureNode: (targetId: string, type: 'video' | 'image') => void`。
- 落点计算复用 `storyDropBox`（`story-layout.ts:67`，`role === 'media'` 分支与 target 无关，**不用改**）。

## B.3 端口布局：顶边两个口怎么排

**问题**：互动节点顶边已经有「挂到片段」口（`StoryNodeShell` 的 `mount`，`Position.Top`，CSS `top: 0`），画面口也是 `Position.Top`。两个都居中会重叠。

**方案**：不动 React Flow 的 `Position`，只用 CSS 左右分开。React Flow 会在挂载后把真实 handle 位置写进 `handleBounds`，而 `storyHandleCenter`（`story-geometry.ts:63-67`）读的就是 `handleBounds` —— 所以**几何层零改动**，连线吸附、端点计算自动正确。

`src/features/canvas/story/StoryNodeShell.tsx`：`StoryNodeShell` 新增布尔 prop `picture = false`（语义是"这张卡可以接画面"），渲染顺序放在 `mount` 之前：

```tsx
{picture ? <StoryHandle id={STORY_MEDIA_HANDLE} side="media" /> : null}
```

`StoryInteractionNodes.tsx:228-229` 的调用加 `picture`：

```tsx
<StoryNodeShell id={id} type="story_interaction" selected={selected} title={interaction.title} mount picture …>
```

`src/features/canvas/story/story-canvas.css`，在 `.is-mount { top: 0 }`（137 行）附近加：

```css
/* 互动节点顶边同时有画面口与挂载口：左右分站，避免重叠。 */
.nori-story-node.is-interaction > .react-flow__handle.nori-story-handle.is-media { left: calc(50% - 34px); }
.nori-story-node.is-interaction > .react-flow__handle.nori-story-handle.is-mount { left: calc(50% + 34px); }
```

React Flow 给 handle 的默认定位是 `left: 50%` + `transform: translate(-50%, -50%)`（Top 口），`left: calc(...)` 直接覆盖即可，不要额外加 `transform`。

同时给 `HANDLE_LOOK.media` 的 title 改成能覆盖新场景的说法（`StoryNodeShell.tsx:30`）：

```ts
media: { position: Position.Top, title: '画面（制作层）：连接视频或图片节点' },
```

原文已经这么写，**不用改**。但 `mount` 的 title（第 31 行 `'挂到剧情片段：连接片段底部的互动口'`）要补一句挂载会覆盖画面口的行为：

```ts
mount: { position: Position.Top, title: '挂到剧情片段：连接片段底部的互动口。挂上后画面跟随片段视频' },
```

## B.4 编译：`resolveSceneMedia` 泛化

`src/lib/interactive/compile.ts:143-159` 的函数已经是 id + data + nodes + edges 的泛型形状，唯一场景专属的是第一行 `readSceneData(data)`。改成：

```ts
/** 节点画面：自己的选取优先，其次第一条连进来的视频，再次连进来的图片。
 *  互动/抉择节点没有「自己的选取」，直接落到连线分支；已存在的行为逐字节不变。 */
export function resolveNodeMedia(nodeId: string, data: unknown, nodes: CanvasNodeLike[], edges: CanvasEdgeLike[], options?: { sceneFields?: boolean }): StoryMedia | null {
  const sceneFields = options?.sceneFields !== false
  const scene = sceneFields ? readSceneData(data) : null
  if (scene?.videoUrl) {
    return { kind: 'video', url: scene.videoUrl, posterUrl: scene.posterUrl ?? scene.imageUrl, ...(scene.videoDurationSec ? { durationSec: scene.videoDurationSec } : {}) }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const linked = edges
    .filter((edge) => edge.target === nodeId && edge.role !== STORY_FLOW_ROLE && edge.role !== STORY_MOUNT_ROLE)
    .map((edge) => byId.get(edge.source))
    .flatMap((node) => (node ? [mediaFromNode(node)] : []))
    .filter((media): media is StoryMedia => !!media)
  const linkedMedia = linked.find((media) => media.kind === 'video') ?? linked[0]
  if (linkedMedia) return linkedMedia
  if (scene?.imageUrl) return { kind: 'image', url: scene.imageUrl, posterUrl: scene.imageUrl }
  return null
}
```

**兼容策略（重要）**：保留旧名 `resolveSceneMedia` 作为薄包装，签名与行为完全不变，内部 `return resolveNodeMedia(sceneId, data, nodes, edges)`。理由：`sceneVideoDurationSec`（`story-beats.ts:29`）、`compile.ts:193/201` 以及可能存在的其他调用点都还叫旧名，改一处漏一处就是回归。**必须**额外加 `STORY_MOUNT_ROLE` 排除（红线 3）—— 旧实现只排除 flow，片段没有 mount 入线所以旧行为不变，互动有。

`compile.ts` 两处调用改成显式：

```ts
// 第 193 行（scene 分支）：不变，继续用 resolveSceneMedia
// 第 198-199 行（interaction 分支）：
case 'interaction': {
  const mountedOn = mountedSceneId(node.id, nodes, edges)
  return { ...compileInteraction(node, mountedOn), picture: mountedOn ? null : resolveNodeMedia(node.id, node.data, nodes, edges, { sceneFields: false }) }
}
// 第 201 行（choice 分支）：backdrop 改用 resolveNodeMedia(..., { sceneFields: false })
```

`sceneFields: false` 是刻意的：互动/抉择节点的 data 里不该有 `videoUrl/imageUrl`，若强行读会让"节点 ddata 里塞 URL"这种违反 R4 的写法悄悄生效。

**服务端一致性检查**：`compile.ts` 同时被前端画布与播放器使用（试玩从 `program` 读），也可能是保存/读取 config 的服务端路径。若存在"编译产物被持久化到 DB"的路径（grep `compileChapter` 的调用方确认），老快照里没有 `picture` 字段 —— 因为是 `?` 可缺省，读起来就是 `undefined`，播放器按"没有画面"处理，行为与今天一致。**不要**写数据迁移脚本。

## B.5 限时抉择：同一个修复带来的免费收益

`StoryChoiceNode.backdrop` 早在 `types.ts:185-187` 就存在，`compile.ts:201` 也已经在填它，`PlayerStage.tsx:432-433` 也已经在用：

```tsx
node.backdrop ? <StageMedia media={node.backdrop} /> : <StageMedia media={backdrop} freezeLastFrame />
```

唯一的断点是**画布上连不进去**（§B.2 的三处门禁）。所以本批次改完，独立抉择节点自动获得"自己的画面"，代码上不需要新写一行播放逻辑。卡片侧给抉择节点加"画面"区（§C.5）即可。

## B.6 校验（`src/lib/interactive/validate.ts`）

### B.6.1 `interaction_no_picture`（warning）

加在 `validateChapter` 的 `node.kind === 'interaction'` 分支（现 337-341 行），紧跟 `interactionIssues` 之后：

```ts
if (!node.mountedOn && !node.picture) {
  issues.push(issue('warning', 'interaction_no_picture',
    `互动「${node.title}」没有画面，试玩时只剩黑屏。接一个视频或图片到它顶部的画面口。`, projectId, node.id))
}
```

### B.6.2 `choice_no_picture`（warning）

加在 `node.kind === 'choice'` 分支（现 361 行附近）：

```ts
if (!node.backdrop) {
  issues.push(issue('warning', 'choice_no_picture',
    `选择「${node.title}」没有自己的画面，将借用上一段的最后一帧。`, projectId, node.id))
}
```

注意这条是**真的 warning 而不是 error**：借用上一段最后一帧是合法的叙事手法（定格提问），只是要在检查面板里看得见。

### B.6.3 `interaction_picture_ignored`（warning）

```ts
if (node.mountedOn && node.picture) {
  issues.push(issue('warning', 'interaction_picture_ignored',
    `互动「${node.title}」挂在片段上，画面跟随片段视频，它自己的画面不会显示。`, projectId, node.id))
}
```

放在哪：编译后的节点没有"有没有连线"的信息，`picture` 为 null 就是没连。但这条需要区分"连了但挂载"（有画面且挂载）——编译时 `picture` 在挂载状态下已被强制置 null（§B.4），所以**这条校验在编译层拿不到信息**。

处理方式：把这条检查放进**画布侧**的动态校验，而不是 `validateChapter`。落到 `StoryInteractionNodes.tsx` 的卡片里当**行内提示**（§C.2 的 `已挂载` 条），文案：

> 已挂载：画面跟随片段视频（这里接的画面不会显示）

不占用 `StoryIssue` 列表，也不用改编译层的 `picture` 强制 null 逻辑。这样 `validate.ts` 只需要 B.6.1 与 B.6.2 两条。

### B.6.4 `hotspot_picture_and_frame`（warning）

热区同时有 `frameImageUrl` 与画面线时，热区坐标是按 `frameImageUrl` 归一化的，而播放底图是 `picture` —— 两者的宽高比如果不同，命中会偏移。

```ts
if (node.kind === 'interaction' && node.spec.type === 'hotspot' && node.spec.frameImageUrl && node.picture) {
  issues.push(issue('warning', 'hotspot_picture_and_frame',
    `互动「${node.title}」同时有背景帧和画面：背景帧决定热区位置，画面决定底图，两者宽高比要一致。`, projectId, node.id))
}
```

这是**已知限制的显式化**，不是 bug。真正的修法（用视频真实帧做热区坐标）需要抽帧，超出本文范围，写进「建议」。

---

# §C 卡片改版（`StoryInteractionNodes.tsx`）

目标：创作者不用试玩就知道玩家在这一秒看到什么。卡片按四个区块从上到下排，顺序固定。

## C.1 分区与顺序

| 区 | 内容 | 挂在片段 | 独立 |
|---|---|---|---|
| ① 状态 | 现有的 `nori-story-status` 一行（挂在「X」/ 未挂载） | ✓ | ✓ |
| ② **画面预览** | §C.3 的预览图 | ✓（显示"画面=片段视频"+ 时间轴条） | ✓（显示自己的画面/空态） |
| ③ 触发时机 | 开始（秒）/时长（秒） 或 限时（秒）+ 超出/重叠提示 | ✓ | ✓ |
| ④ 互动时画面 | 继续 / 慢放 / 定格 分段控件（现有） | ✓ | ✓ |
| ⑤ 玩法参数 | 按 `spec.type` 的现有表单 + 难度预设（§D） | ✓ | ✓ |
| ⑥ 提示文字 | 现有 `TextField`（label `提示文字`） | ✓ | ✓ |
| ⑦ 结果分支 | 现有 results 列表 | ✓ | ✓ |

即：把 **② 画面预览插在状态行之后、触发时机之前**，把 **⑤ 之前插一行难度预设**。其余顺序不动（现有创作者的手感不破坏）。

## C.2 画面区 UI 与文案

### 挂载态（`mount` 为真）

预览图 = 宿主片段的海报图（`toVideoPosterUrl` 或片段 `posterUrl`，480 宽）+ 玩法示意叠层 + 一条时间轴条，条上按 `startSec / startSec+durationSec / videoSec` 画出互动窗口（复用 `story-beat-timeline.ts:38` 的 `beatTrackFractions`）。

预览下一条说明行（`nori-story-note` 样式）：

> 挂在片段上，画面跟随片段视频 · `第 5–8 秒`

时间范围用 `beatRangeLabel(startSec, durationSec)`（`story-beat-timeline.ts:25`，现成函数，别重写）。

若该节点自己也接了画面线，说明行换成（§B.6.3）：

> 已挂载：画面跟随片段视频（这里接的画面不会显示）

### 独立态 · 有画面

```
┌──────────────────────────┐
│  [16:9 海报缩略图]        │   <- MediaImage，sizes="260px"
│  [玩法示意叠层]           │
└──────────────────────────┘
视频画面 · 《主角奔跑》        [更换] [移除]
```

- 类型文案：「视频画面」/「图片画面」，后面跟素材节点标题（读 source 节点的 `data.title`，空则 `视频`/`图片`）；
- 按钮：`更换` = 把画面口接到另一个素材（走现有拖线，按钮先 toast「从画面口拖出一条线接到新的视频或图片」）；`移除` = 删掉那条非 flow 非 mount 的入线，`record('移除互动画面')`。
- 视频素材若在 `sourceMetadata.durationMs` 上有值，补一句 `· 3.2 秒`。

### 独立态 · 没画面（**黑屏的源头，必须有引导**）

设计过的空态，不能是空的：

```
┌──────────────────────────┐
│   （虚线框 + 图标）       │
│   互动还没有画面          │
│   试玩时会是黑屏          │
└──────────────────────────┘
[ 新建画面 ]  [ 接已有节点 ]
```

- `新建画面` → 调 `createPictureNode(id, 'video')`（§B.2.6），默认建视频节点（影游以视频为主）；
- `接已有节点` → toast「从这张卡顶部的「画面」口拖出一条线，接到视频或图片节点」，并把画面口做一次 1.5s 的高亮动画（给 handle 加临时 class `is-hinting`，CSS 里做一次 scale 脉冲）；
- 两个按钮都要 `disabled={readOnly}`。

### 预览组件

`src/features/canvas/story/StoryInteractionPreview.tsx`（新文件）：

```tsx
export function StoryInteractionPreview({ spec, orientation, posterUrl, mounted, startSec, durationSec, videoSec, title }: { … }) 
```

内部：

- 容器 `aspectRatio: orientation === 'landscape' ? '16 / 9' : '9 / 16'`，边框色 `var(--story-hue)`，圆角 10px，`overflow: hidden`；
- 有 `posterUrl` → `MediaImage src={posterUrl} alt="" fill sizes="260px"`，无 → 虚线空态；
- 底部叠一层 42% 黑遮罩 + 玩法示意（纯 CSS，不用图）：tap 一个圆按钮显示 `N 次`；swipe 一个大箭头；timing 一条轨道 + 指针；hold 一个环；hotspot 两三个虚线框；choice 两三个小条（选项文案截断到 6 字）；
- 右上角一个角标显示限时秒数（`interaction.durationSec`），格式 `限时 3s`。

**R7 提醒**：预览里绝不放 `<video>`。`posterUrl` 一律经 `toVideoPosterUrl(url, 480)`（`src/lib/media/image-url.ts:79`）。

## C.3 难度预设行（玩法参数区顶部）

在 ⑤ 玩法参数的第一行插入：

```
难度  [ 简单 ] [ 普通 ] [ 困难 ]        （.nori-story-segmented.is-three）
```

点一下 = 一次性 patch 一组字段 + 一条 toast「已套用困难难度（可继续微调）」。具体数值见 §D.2。**只有一个 undo 记录**（`patch(preset, '套用难度预设')` 一次调用）。

难度不进 data：不存"当前难度"字段。创作者改过任一参数后，三个按钮都保持未选中（`aria-checked` 全 false），避免"显示困难但其实被改过"的谎言。

## C.4 结果分支区的微调（可选，做不完砍掉）

- 在 results 列表标题前加一行小字说明可预期的游玩节奏：tap/choice 显示 `限时 N 秒`，timing 显示 `完美 ±X%`，hold 显示 `蓄力 N 秒，松手 X–Y%`。全部从 spec 现算，纯展示。
- 未连线的结果口沿用现有 `result_unlinked` 校验，不在卡内重复报错。

**预算紧就整节砍掉**，C.1–C.3 已经解决"看不出玩家看到什么"。

## C.5 限时抉择节点同步加画面区

`src/features/canvas/story/StoryBranchNodes.tsx` 的 `StoryChoiceNode` 卡（29-44 行）：

- `StoryNodeShell` 调用加 `picture`（同 §B.3，抉择节点也是 `STORY_MEDIA_TARGET_TYPES` 成员）；
- 卡片内加同样的画面区（复用 §C.2 的组件，`mounted={false}` 恒真，因为抉择不能挂载）；
- CSS 同理：`.nori-story-node.is-choice > .is-media { left: calc(50% - 34px) }` —— 但抉择节点顶边只有画面口，没有 mount，**不需要偏移**，保持 `left: 50%` 居中即可。所以 C.5 的 CSS **零改动**。

---

# §D 玩法内容设计：参数与预设

这一节是给创作者的"数值感"。实现上只需要 §D.2 的一张表和一行 patch 调用。

## D.1 六种玩法的作者指南（写进本文，供实现者填 placeholder 与校验文案）

| 玩法 | 剧情位置建议 | 提示文字范例 | 时长建议 | 结果口必须连 |
|---|---|---|---|---|
| 快速点击 tap | 短促的紧张瞬间：砸门、拽绳、挣脱、疯狂按键 | `狂点！把门撞开` | 3 秒 / 5 秒 | `success` + `fail` |
| 方向滑动 swipe | 一瞬的闪避或动作：侧身、推门、甩出暗器 | `向左闪开！` | 1–1.5 秒 | `success` + `fail` |
| 时机点击 timing | 需要节奏的瞬间：格挡、踩点、点穴、跳上移动平台 | `指针进黄区时点！` | 3 秒 | `perfect` + `normal`（可同连）+ `miss` |
| 长按蓄力 hold | 蓄力动作：拉弓、屏息、蓄力重击 | `按住蓄满，绿区松手` | 4 秒 | `success` + `fail` |
| 隐藏热区 hotspot | 探索：找线索、翻抽屉、点药瓶标签 | `找出画面里的线索！` | 5–10 秒 | 每个 zone + `timeout` |
| 限时抉择 choice | 关键分岔：救谁、开不开门、说不说实话 | （选项本身就是提示） | 2–5 秒 | 每个选项；`超时可单独走向` 时加 `timeout` |

三条硬经验（也写进卡片的 hint）：

1. **tap 的时长与次数要一起调**：3 秒点 10 次约等于每秒 3.3 次，普通玩家刚好；3 秒点 18 次是"必须双手"。
2. **swipe 别超过 1.5 秒**：滑动是单次动作，给太久反而不紧张（现在的默认 1 秒是对的，别动 `DEFAULT_DURATION`）。
3. **hotspot 不要只放一个热区**：只有一个热区等于"点哪里都行"的猜谜，至少 2–3 个，其中一个必须是"错"的（连到 timeout 或轻惩罚分支）。

## D.2 难度预设表（`src/lib/interactive/presets.ts`，新文件）

```ts
export type StoryDifficulty = 'easy' | 'normal' | 'hard'
export const STORY_DIFFICULTY_LABEL: Record<StoryDifficulty, string> = { easy: '简单', normal: '普通', hard: '困难' }

/** 只产出编辑器字段，绝不产生新的 spec 语义；调用方一次 patch 完成一次 undo。 */
export function difficultyPreset(kind: StoryInteractionKind, difficulty: StoryDifficulty): Record<string, number | boolean>
```

| 玩法 | 字段 | 简单 | 普通 | 困难 |
|---|---|---|---|---|
| tap | `durationSec` / `count` | 5 / 5 | 3 / 10 | 2.5 / 18 |
| swipe | `durationSec` | 1.5 | 1 | 1 |
| timing | `durationSec` / `speed` / `perfectWidth` / `normalWidth` | 4 / 1 / 20 / 50 | 3 / 1.5 / 12 / 30 | 3 / 2.5 / 8 / 18 |
| hold | `durationSec` / `fillSec` / `rangeMin` / `rangeMax` / `overchargeFails` | 5 / 1.5 / 70 / 100 / false | 4 / 2 / 80 / 100 / false | 4 / 2.5 / 85 / 100 / true |
| hotspot | `durationSec` / `showZones` | 10 / true | 6 / false | 4 / false |
| choice | `durationSec` | 6 | 3 | 2 |

所有值都必须落在 `readSpec` 的既有上下界内（tap count 1–99、timing perfectWidth 2–50 / normalWidth 4–90 / speed 0.25–4、hold fillSec 0.5–20、`durationSec` 0.5–120），**上表已核对过**，实现时再加一层 clamp 兜底。

## D.3 「失败重来」的设计口径（补进 hint 与校验）

`retry`（现有字段）只对独立互动有意义（挂在片段里 `Results.when='after'` 会走完本段再切）。设计建议：

- 紧张类（tap/swipe/timing）→ 勾 `retry`，让手残玩家重试，不惩罚；
- 剧情类（choice/hotspot）→ 不勾，选错就是剧情，失败本身是内容；
- hold 的"过量失败"→ 越界即失败但可重来。

本文不改 `retry` 的任何行为，只是把这条建议写进部署记录的作者指南。

---

# §E 播放层：黑屏根治

## E.1 现状回顾（三个独立原因叠在一起，必须都修）

1. 独立互动/抉择停靠点，前面没有任何片段画面 → `lastSceneMedia`（`InteractivePlayer.tsx:93-101`）返回 `null` → `InteractionBackdrop` 渲染 `.nori-player-media.is-empty`（`PlayerStage.tsx:347`）→ 接近黑的一块。
2. 播放器所有 `<video>` 都没有 `onError` / `onWaiting` / `preload`，每个停靠点 `key={`stop-${stopId}`}` 都会新挂一个元素（`InteractivePlayer.tsx:479`），签名失效或首帧未就绪时是纯黑。
3. 播放器子树没有 `.nori-force-dark`，`.nori-player-media.is-empty` 用的是 `--nori-s-0b0b12`，浅色主题下会解析成接近白 —— 不是黑屏而是"白屏"，同样难看（`interactive.css:105`）。

## E.2 画面回退顺序（`PlayerStage.tsx`）

独立互动停靠点取画面的优先级，写成一个纯函数放进 `src/features/interactive/player/playback-plan.ts`（已有该文件，加一个导出）：

```ts
/** 独立互动的底图：自己的画面 → 上一段最后一帧 → 无。 */
export function standaloneBackdrop(node: StoryInteractionNode, previous: StoryMedia | null): { media: StoryMedia | null; freeze: boolean }
```

| 顺序 | 条件 | 行为 |
|---|---|---|
| 1 | `node.picture` 存在 | `{ media: node.picture, freeze: false }`，正常播放，`during` 生效 |
| 2 | `previous !== null`（上一段画面） | `{ media: previous, freeze: true }`，**定格在最后一帧** |
| 3 | 都没有 | `{ media: null, freeze: true }` → 渲染设计过的占位（§E.2.1） |

`InteractionBackdrop`（`PlayerStage.tsx:317-366`）改造：

- 接受 `freeze` 参数；
- `freeze === true` 时：`autoPlay={false}`，`onLoadedMetadata` 里 `currentTime = max(0, duration - 0.04)` 然后 `pause()`（现成逻辑在 `StageMedia.seekToEnd`，`PlayerStage.tsx:81-88`，抽成共享小函数 `seekToLastFrame(video)` 放 `player/playback-plan.ts`，两处都用）；
- **删掉 `loop`**。视频底图播完就停在最后一帧（`onEnded` 里 `pause()`），绝不回到第 0 秒重播 —— 现在的 `loop` 是"独立互动时上一段突然从头再播一遍"，玩家会觉得是 bug；
- `during === 'freeze'` 时整段暂停（现有 `pictureState` 已处理，确认 `freeze` 与 `during` 不打架：`during='freeze'` 优先，直接不播放）。

### E.2.1 占位（`media === null`）

不要 `.is-empty` 纯色块。改成：

```tsx
<div className="nori-player-media is-empty" data-testid="player-media-placeholder">
  <span className="nori-player-media-note">这一幕还没有画面</span>
</div>
```

CSS（`interactive.css`，`.nori-player-media.is-empty` 之后）：

```css
.nori-player-media.is-empty { display: grid; place-items: center; }
.nori-player-media-note { color: rgb(var(--nori-s-8b8b9a)); font-size: 13px; letter-spacing: .04em; }
```

文案刻意中性（观众视角，不是创作者视角）。观众不关心"你没接画面"。

## E.3 播放器硬化（`PlayerStage.tsx` 全部 `<video>`）

一个共享小改动，三层都要：`StageMedia`（58-130）、`InteractionBackdrop`（317-366）、场景视频。

1. **`onError`**：置一个 `failed` state，渲染 `角色区显示「画面加载失败」+ 一个「跳过这段」按钮`。`跳过这段` 调 `onContinue()`（场景）或对互动调超时 handle（`interactionTimeoutHandle(spec)`，`interaction.ts` 已有）。
2. **`onWaiting` / `onLoadedData`**：切片加载中显示极细的顶部进度条或一个小 spinner；不要遮住互动 UI（`z-index` 在互动层之下）。
3. **`preload="metadata"`** 显式写上（现在是缺省 `auto`，会拉全片头）。
4. **`playsInline` 已有，别删。**
5. 断点在哪：`src/features/interactive/player/` 下新建 `VideoSurface.tsx` 会牵动 3 处 props 传递，**代价大于收益**。本文选择在各处的 `<video>` 上就地加 3 个 handler + 一个卡内 `failed` state，**不抽组件**（R8：操作少一步让位于不出 bug，但不为了抽象而抽象）。

## E.4 用对 URL（`playback=1`）

`PlayerStage.tsx:32` 的 `display()` 是 `toDisplayImageUrl`（普通签名跳转）。画布侧用的是 `toPlayableVideoUrl`（`playback=1` 代理，带 gzip 与缓存策略）。播放器是消费最多流量的地方，**必须**用同一条路径：

- 视频 `src` 用 `toPlayableVideoUrl(media.url)`；
- `poster` 继续用 `toDisplayImageUrl`（图片不走代理，走 poster 分支已经带了 480 宽缩放）；
- 图片 `src` 继续 `toDisplayImageUrl`。

改法：`PlayerStage.tsx:32` 保留 `display`，新增 `const playback = (url: string | null | undefined) => (url ? toPlayableVideoUrl(url) || url : null)`，只在 `media.kind === 'video'` 的 `src` 上换用它（`StageMedia` 第 118 行、`InteractionBackdrop` 第 357 行）。

**验收方式**：DevTools Network 里播放器视频请求路径应含 `playback=1`。

## E.5 舞台恒深色

`InteractivePlayer.tsx:443` 的根节点 `<div className={`nori-player${compact ? ' is-compact' : ''}`}>` 追加 `nori-force-dark`：

```tsx
<div className={`nori-player nori-force-dark${compact ? ' is-compact' : ''}`} …>
```

理由：`--nori-s-*` 的浅色覆盖被限定在 `html[data-nori-theme="light"] :not(.nori-force-dark):not(.nori-force-dark *)`，画布全树都这么用，播放器漏了。影游播放几乎必然是全黑影院感，浅色主题下没有理由跟随。

## E.6 不做的事（明确划掉，避免实现者自发挥）

- **不做**下一个停靠点的视频预加载：会同时存在两个 `<video>`，违反 R7 的流量约束。
- **不做**抽帧生成海报（`<canvas>` 抓帧上传）：会引入新的服务端上传路径与流量。
- **不做**互动节点的"从这里试玩"：需要给 `startRun` 加新的起点方式，违反 R6。

---

# §F 实现清单与批次

## F.1 文件清单

| 文件 | 改动 | 批次 |
|---|---|---|
| `src/lib/interactive/types.ts` | `StoryInteractionNode.picture?`；`StoryChoiceNode.backdrop` 注释更新 | 一 |
| `src/lib/interactive/compile.ts` | `resolveNodeMedia`（排除 mount）、`resolveSceneMedia` 薄包装、interaction/choice 分支改用新函数 | 一 |
| `src/features/canvas/story/story-connection.ts` | `STORY_MEDIA_TARGET_TYPES` / `isStoryMediaTarget`；73-77、86-88 两处门禁与文案 | 一 |
| `src/features/canvas/story/story-geometry.ts` | 93 / 109 / 128 / 152 四处判定放宽 | 一 |
| `src/features/canvas/components/CanvasEdge.tsx` | 60 行判定、93 行删除文案 | 一 |
| `src/features/canvas/story/StoryNodeShell.tsx` | `picture` prop + 渲染；`mount` 口 title 补一句 | 一 |
| `src/features/canvas/story/StoryInteractionNodes.tsx` | 传 `picture`；§C 画面区、预览、难度行 | 一 / 二 |
| `src/features/canvas/story/story-canvas.css` | `.is-interaction` 顶边双口左右分站；预览样式；空态虚线框；`is-hinting` 脉冲 | 一 / 二 |
| `src/features/canvas/story/useStoryCanvasActions.ts` | `storyWireRefusal` 文案；221 行门禁；`createSceneMedia` → `createPictureNode` | 一 |
| `src/features/canvas/story/story-layout.ts` | `storyDropBox` 的 media/mount 落点对互动同样有效（确认 67 行不需改）；`layoutStoryChapter` 129-140/181-196 行把互动节点的画面纳入同列布局 | 三（可延后） |
| `src/features/canvas/editor-types.ts` | `STORY_INTERACTION_ADD_ITEMS` 的 hotspot 描述补"需要一张背景帧" | 二 |
| `src/lib/interactive/presets.ts`（新） | 难度预设表（§D.2） | 二 |
| `src/lib/interactive/validate.ts` | `interaction_no_picture`、`choice_no_picture`、`hotspot_picture_and_frame` | 二 |
| `src/features/canvas/story/StoryInteractionPreview.tsx`（新） | §C.2 预览组件 | 二 |
| `src/features/interactive/player/playback-plan.ts` | `standaloneBackdrop`、`seekToLastFrame` | 三 |
| `src/features/interactive/PlayerStage.tsx` | 画面回退、去 `loop`、`onError`/加载态、`playback=1`、占位文案 | 三 |
| `src/features/interactive/InteractivePlayer.tsx` | 根节点加 `nori-force-dark` | 三 |
| `src/features/interactive/interactive.css` | `.is-empty` 居中 + `note` 样式 | 三 |
| `tests/unit/canvas/*`、`tests/unit/interactive/*` | 见 §F.2 | 各批次 |

`src/features/canvas/story/story-layout.ts` 单独说明：`layoutStoryChapter` 的 `mediaOf`（129-140 行）与 `mediaLift`（181 行）目前只对 `story_scene` 认画面。**不纳入一批次是刻意的**：整章整理（organize）时互动节点的画面节点如果先在别处，整理后会留在原位，不构成 bug，只是不够整齐。批次三有余量再做，判据见 §F.4。

## F.2 单测

| 文件 | 断言 |
|---|---|
| `tests/unit/canvas/story-connection.test.ts`（追加） | 视频节点 ↔ 互动节点 media 线：`resolveStoryConnection` 返回 `kind:'media'`；图片 ↔ 抉择同理；线段 ↔ 互动仍拒；`applyStoryConnection` 一个 target 只留一条画面线；mount 边不被 media 分支删掉 |
| `tests/unit/canvas/story-geometry.test.ts`（追加） | `storyWireRole` 对 `story_interaction` 的 media 口返回 `'media-pick'`；`portsFor('media', 互动节点)` 返回 1 个 Top 端口；`storyEdgeEnds` 对 target 为互动返回非空 |
| `tests/unit/interactive/compile-*.test.ts`（新增或追加） | `resolveNodeMedia` 排除 mount 边；互动节点挂载时 `picture === null`；未挂载且有线时 `picture` 为视频优先于图片；`resolveSceneMedia` 全部旧断言原样通过（兼容性金标准） |
| `tests/unit/interactive/presets.test.ts`（新） | 6 × 3 = 18 组预设全部落在 `readSpec` 的合法区间；`difficultyPreset` 不返回 `spec` 之外的键 |
| `tests/unit/interactive/validate-*.test.ts`（追加） | 独立互动无画面 → `interaction_no_picture`；挂载互动无画面 → 不报；抉择无 backdrop → `choice_no_picture`；热区双图 → `hotspot_picture_and_frame` |
| `tests/unit/interactive/player-playback-plan.test.ts`（追加） | `standaloneBackdrop` 三级回退：有 picture → `freeze:false`；无 picture 有 previous → `freeze:true`；都无 → `media:null` |

跑法：

```bash
npx vitest run tests/unit/canvas/story-connection.test.ts tests/unit/canvas/story-geometry.test.ts
npx vitest run tests/unit/interactive
npx tsc --noEmit
```

## F.3 批次与提交顺序

**批次一（画面通电线）** —— 一次提交，主题 `feat(story): give interactions and choices their own picture port`

1. `story-connection.ts` 判定与文案
2. `story-geometry.ts` 四处放宽
3. `CanvasEdge.tsx` 判定与删除文案
4. `compile.ts` `resolveNodeMedia` + 包装
5. `StoryNodeShell.tsx` `picture` prop；`StoryInteractionNodes.tsx` / `StoryBranchNodes.tsx` 传参
6. `story-canvas.css` 双口分站
7. `useStoryCanvasActions.ts` 文案与门禁、`createPictureNode`
8. 单测

批次一验收（测试机）：视频节点拖到互动节点顶部「画面」口 → 连上、虚线样式与片段一致；拖动整章布局（organize）不崩；旧作品打开 3 个，试玩行为与线上一致。

**批次二（内容设计）** —— 一次提交，主题 `feat(story): interaction picture card, difficulty presets and picture checks`

1. `StoryInteractionPreview.tsx` + 卡片分区
2. `presets.ts` + 卡片难度行
3. `validate.ts` 三条
4. `editor-types.ts` hotspot 描述
5. 单测

**批次三（播放层）** —— 一次提交，主题 `fix(player): no more black stage for standalone interactions`

1. `playback-plan.ts` 两个纯函数
2. `PlayerStage.tsx` 回退 / 去 loop / onError / playback=1 / 占位
3. `InteractivePlayer.tsx` `nori-force-dark`
4. `interactive.css` 占位样式
5. 单测

三个批次都在**测试机**（45.76.215.9，见部署记录）验收后，合并成一次生产放行申请，**生产需要用户批准**。

## F.4 卡点判据（什么时候停下来问）

- 改了 `story-connection.ts` 之后 `tests/unit/canvas/story-connection.test.ts` 有既有用例失败，且失败原因不是"文案变了" → 停下来，说明门禁放宽动了不该动的东西。
- `resolveNodeMedia` 加上 `STORY_MOUNT_ROLE` 排除后，任何 `scene` 相关断言变化 → 停下来（片段不该有 mount 入线，变化说明有别的代码在用）。
- `CanvasEdge.tsx` 改完出现画面线错位（端点不在口上）→ 说明 `storyEdgeEnds` 的 `storyMediaAnchor` 对互动节点不合适（互动卡片比片段矮很多），此时**停下来回报**，不要自己在几何层加特判。
- `PlayerStage` 改完独立互动的互动 UI 被视频遮住 → `z-index` 问题，先检查是否误把 `autoPlay` 打开在 `freeze` 分支。

## F.5 部署记录里的「建议」（本次不做）

1. hotspot 视频底图的热区坐标：需要抽帧（服务端 ffmpeg 或浏览器 canvas 抓帧 + 上传），成本高于本次收益。现在用"背景帧定坐标 + 画面定底图，宽高比必须一致"来规避（§B.6.4）。
2. 「从这里试玩这个互动」：需要引擎支持从任意节点起跑并注入前序变量，属引擎 contract 变更（R6 禁止）。
3. 下一个停靠点预加载：违反 R7 流量约束，等有了明确的带宽预算再说。
4. 互动音效/震动反馈：`vibrate` / `Audio` 需要新的素材上传与设置项，本文不涉及。
5. `story-layout.ts` 的整章整理识别互动画面（§F.4 提到）：纯观感优化，量足了再做。

---

## 验收清单（测试机逐条过，横竖屏各一遍）

1. **画面接线**：视频节点 → 互动节点「画面」口连上；图片 → 抉择节点连上；从互动「画面」口反向拖到素材节点也能连上；拖到剧情节点上给出正确拒绝文案（`'画面接口只能连接视频或图片节点'`）。
2. **端口不重叠**：互动节点顶边两个口左右分开，鼠标悬停分别显示「画面」与「挂到片段」提示。
3. **卡片分态**：挂载互动显示"画面跟随片段视频 · 第 X–Y 秒"；独立互动有画面显示缩略图与素材名；独立互动无画面显示虚线空态 + 两个按钮，`新建画面` 能建出视频节点并自动连线、`已在片段上方腾出画面位置` 之类的 toast 文案读起来不别扭。
4. **难度预设**：每种玩法点三档各一次，字段按 §D.2 变化，一次 Cmd+Z 全回退。
5. **校验**：独立互动无画面 → 检查面板报 warning 且能定位；挂载互动不报；抉择无画面报 warning。
6. **黑屏**：剪一个只有「结局节点」的作品（前面没有任何片段），独立互动节点试玩 → 显示"这一幕还没有画面"，不再是纯黑块；给它接一个视频画面 → 正常播放，`继续/慢放/定格` 三档行为正确，视频播完停在最后一帧而不是回到开头重播。
7. **旧作品回归**：测试机 3 个既有作品（含挂载互动、含热区）播放、分支、数值、存档行为与线上一致。
8. **主题**：切到浅色主题试玩 → 舞台仍然深色，占位文字可读。
9. **流量**：DevTools 确认播放器视频请求带 `playback=1`；画布上互动卡预览不产生 `<video>` 请求。
