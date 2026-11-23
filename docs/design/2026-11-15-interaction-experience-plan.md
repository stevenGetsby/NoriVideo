# 影游画布：互动体验四项（热区 / 随机分支 / 画面定格验收 / 换类型不断线）实现文档

日期：2026-11-15　角色：设计 → 实现（kimi3.1）。本文自成一体，照做即可，不需要再问用户。

来源：体验玩家反馈表（14 条需求中 1–14 与 11-13 影游画布 spec 重合，本文覆盖增量 4 条）：

| 玩家原话 | 本文条目 |
|---|---|
| #15 触发点在屏幕任意位置，可隐藏（点墙上照片找线索） | **§A 热区互动 hotspot** |
| #16 石头剪刀布，纯随机，赢了输了两条剧情 | **§B 随机结果口 random** |
| #17 选项弹出时画面重新播放，没法定格/放慢 | **§C 定格回归验收**（功能是有的，被 bug 打掉了） |
| #18 想换互动类型要删节点、连线全得重连 | **§D 节点内换类型 + 断线吸附** |

## 执行规则

- **I-R1 顺序**：批次一 = §C（一行级修复 + 验收脚本，先让玩家能定格）→ 批次二 = §D（玩家最痛的制作体验）→ 批次三 = §A + §B。三个批次都在测试机验收后合并成一次生产放行申请。
- **I-R2 旧作品兼容**：所有新字段宽松读取（沿用 `read.ts` 的 `record/text/id/boundedNumber/oneOf` 风格）；旧作品没有这些字段，行为逐字节不变。不改动任何现有字段的含义。
- **I-R3 纯函数先行**：规格解析、端口列表、结果配置、映射逻辑全部进 `src/lib/interactive/`，配 vitest 单测；React 组件只渲染这些纯函数的结果，不在组件里写判定逻辑。
- **I-R4 本文没写到的细节**按这个优先级选：不产生逻辑 bug（分支走错、数值错、存档错）> 连线不丢 > 操作少一步 > 好看。冲突时砍后者。
- **I-R5 不许自己加功能**：不加本文没有的互动类型、不加「触发点样式商店」之类的延伸。觉得缺什么写进部署记录「建议」。
- **I-R6 数据零迁移**：全部改动在 `InteractiveStory.config` JSON 内部，无 DB schema 变更，不动 API 路由（热区图复用现有 `POST /api/interactive/[workId]/assets`）。
- **I-R7 引擎 contract 不动**：`engine.ts` 的 `resolveBeat(program, run, beatId, handle)` 签名不变。新子类型只是产出新的 handle 集合，引擎 already 按 handle 查 `beat.results[handle]` + `nextNodeId`，不需要为 hotspot/random 写新分支逻辑——**如果发现需要改引擎才能支持，说明规格设计错了，停下来回报。**

## 全局逻辑红线（每个批次验收都过一遍）

1. **handle 永不指向不存在的端口**：连线 (`flow.handle`) 必须在 `storySourceHandles(source)` 里。任何导致端口消失的操作（换类型、删选项、删热区结果口）必须在同一事务里处理连线——迁移、断开或明确提示，不允许静默留下悬空 handle（编译时这条 flow 会被 `nextNodeId` 忽略，玩家点了没反应，就是玩家骂的「逻辑 bug」）。
2. **同一时刻最多一个活跃互动**：播放循环（PlayerStage 的 rAF tick）在 `beat.startSec ≤ t < startSec+durationSec` 时激活该 beat；两个 beat 时间窗重叠由 validate 拦截（error），播放器遇到重叠时取 startSec 较小者，不叠加 UI。
3. **离开时间窗即结束**：tick 里 `t ≥ startSec + durationSec` 而互动仍未 resolve → 按超时路径结算一次（choice 走 `interactionTimeoutHandle`，tap/swipe/hold/timing 走 fail/miss 语义口，**hotspot 走 timeout 口，见 §A.4**）。结算只发生一次，用 `resolvedBeatIds` 之类的集合防重。
4. **读档不重放数值**：沿用 spec 既定红线——load save 不重新执行 segment/beat 的 effects（effects 必须记在 trail 里，回放按 trail 不按重算）。
5. **超时口语义统一**：凡是"时间到了没操作"，结算路径只有两种——有专属超时口（choice 的 `timeoutMode === 'exit'`、hotspot 的 timeout 口）就走它；没有就走该类型的失败语义口（fail/miss）；choice `timeoutMode === 'default'` 走默认选项。**不存在第三种隐藏路径。**
6. **端口断开必须可见**：任何「这条线断了」都走 CanvasDialogs 的确认弹窗或画布上的明显标记，不允许无声消失。

---

## §A 热区互动（hotspot，玩家 #15）

### A.1 玩法定义

创作者在一张**背景帧图片**上拖出若干矩形热区；观众在互动时间窗内点中热区 → 走该热区的结果口；倒计时结束什么都没点中 → 走 `timeout` 口。热区默认对观众**不可见**（玩家原话「触发点可以隐藏看不到」），可选显示描边。

典型场景：侦探点墙上照片发现线索、仙侠点药瓶标签触发剧情。它**不替代** tap/swipe/timing/hold/choice，是第 6 个子类型。

### A.2 数据模型（全部进 config JSON，宽松读取）

`src/lib/interactive/types.ts`：

```ts
// STORY_INTERACTION_KINDS 追加 'hotspot'
export type StoryHotspotZone = {
  id: string
  label: string            // 创作者备注，如「带血的照片」，也作结果口标签
  x: number; y: number; w: number; h: number  // 相对背景图 0–1 归一化，左上有原点
}
```

`StoryInteractionSpec` 新增分支：

```ts
| { type: 'hotspot'; frameImageUrl: string | null; showZones: boolean; zones: StoryHotspotZone[] }
```

节点 data 新增字段（全部可缺省，缺省值如下）：

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `frameImageUrl` | string\|null | null | 背景帧图（走 assets 上传接口）。**为空时播放器直接叠在视频当前帧上**（不暂停抠帧，见 A.6 红线） |
| `showZones` | boolean | false | 观众是否看到热区描边 |
| `zones` | array | [] | 见上 |

`STORY_INTERACTION_LABEL.hotspot = '隐藏热区'`，`DEFAULT_DURATION.hotspot = 5`，默认 hint `'找出画面里的线索！'`。`defaultInteractionData('hotspot')` 返回 `{ ...base, frameImageUrl: null, showZones: false, zones: [默认一个居中热区 {x:.4,y:.4,w:.2,h:.2,label:'线索一'}] }`。

### A.3 端口

`interactionHandles` 的 hotspot 分支：

```ts
case 'hotspot':
  return [...spec.zones.map((zone) => zone.id), STORY_TIMEOUT_HANDLE]
```

- 热区结果口 id = zone.id（`opt_xxx`，与选项 id 同空间，不会撞语义口）。RESULT_LABEL 渲染时 hotspot 的 zone 口显示 `zone.label`。
- `STORY_TIMEOUT_HANDLE` 恒存在，不受 `timeoutMode` 影响（hotspot 没有 default 语义）。
- 结果配置沿用 `results[handle]`：`{ effects, when, retry }`，每个热区口和 timeout 口各自一份。不接线 = 播完继续（现有语义不变）。

### A.4 超时语义（红线 5 的落地）

hotspot 倒计时结束未点中 → handle = `STORY_TIMEOUT_HANDLE`。`interactionTimeoutHandle(spec)` 的 hotspot 分支直接返回它。timeout 口没连线 = 视频继续播放（现有「未连线口」语义），创作者想惩罚观众就连一条线去失败片段或配 `retry`。

### A.5 引擎与编译

- `compile.ts` 不改结构：hotspot beat 与现有 beat 一样进 `scene.beats`，按 startSec 排序。
- `engine.ts` **零改动**（红线 I-R7）：`resolveBeat` 收到 zone.id 或 timeout handle 即可走通现有分支/数值/重来逻辑。`interactionHandles` 校验已在 335–339 行挡住非法 handle。
- `validate.ts` 新增检查：
  - `hotspot_no_zone`（error）：zones 为空。
  - `hotspot_zone_out_of_frame`（error）：zone 的 x/y/w/h 任一不在 [0,1]，或 x+w>1、y+h>1。
  - `hotspot_timeout_unwired`（warning）：timeout 口无连线且无 retry——「观众找不到线索时剧情照样继续，确认这是你要的吗」。
  - 时间窗越界/重叠沿用现有 `beat_out_of_range` / `beat_overlap`。

### A.6 播放红线（不要在这里制造逻辑 bug）

1. **背景帧图 vs 视频帧**：`frameImageUrl` 是创作者上传的静态图。播放器行为：互动激活时若有 frameImageUrl 且 `during !== 'play'`，画面切换为该静态图（配合 freeze 语义）；若为 null 或 during='play'，直接叠在当前视频帧上。**不做**「自动截取视频第 N 帧当背景」——截图与服务端帧不一致就是玩家会发现的货不对板。创作者要定格帧，自己截好传上来。
2. **坐标系**：热区坐标相对**背景图的显示框**（object-fit contain 的实际渲染矩形，不是视频元素全框）。播放器命中判定必须用渲染后的 contain 矩形换算，否则横竖屏/留边时点和判定错位。换算函数进 `src/lib/interactive/` 纯函数（输入：容器宽高、媒体宽高、pointer 坐标；输出：命中的 zone id 或 null），配单测覆盖留边、旋转两种情形。
3. **指针事件**：热区层用 Pointer Events，`touch-action: none`，避免手机滚动抢走事件。多个热区重叠时取数组靠后的（画布上后画的在上层），validate 给重叠热区一个 warning。
4. **倍速**（P4 既有红线）：hotspot 倒计时时长是真实秒，不随倍速变。

### A.7 编辑器

- `editor-types.ts` 的 add menu 加一项：`{ type: 'story_interaction', interaction: 'hotspot', label: '隐藏热区', description: '在画面上放看不见的触发点，点中走向不同剧情' }`。
- `StoryInteractionNodes.tsx` 加 hotspot 表单：背景帧上传（`StoryImageField` 复用）、showZones 开关、热区列表。热区编辑：一个按背景图比例渲染的预览框，可拖/可缩的矩形（React 里 pointer 拖拽 + 四角 handle，纯前端，不引库）。每个热区一行：label 输入、删除按钮。
- 挂载/时间窗编辑沿用现有 `story-beats.ts` 与 `StoryBeatTimeline`（hotspot 是普通 beat）。

---

## §B 随机结果口（random modifier，玩家 #16 的通用化解法）

**不做**独立「石头剪刀布」子类型。做通用随机结算：石头剪刀布 = swipe 三个方向各配 1/3 权重 + 文案包装；以后抽卡、轮盘零新增代码。

### B.1 数据模型

`StoryResultConfig` 加可选字段：

```ts
{ effects; when; retry; weight?: number }   // weight > 0 时该口参与随机
```

判定规则（进 `interaction.ts` 纯函数 `resolveRandomHandle(spec, results, roll)`，roll ∈ [0,1) 由调用方给）：

- 一个互动里**只要有一个结果口配了 weight**，该互动就是「随机互动」：结算时不再看观众操作成败，而是在**所有配了 weight 的口**里按权重抽一个。没配 weight 的口在随机互动里不生效（validate 给 warning）。
- 未配任何 weight 的互动行为完全不变（旧作品零影响）。
- 权重和不要求 = 1，按占比归一。`weight` 读取 `boundedNumber(raw, 0, 0, 999)`，0 视为未配。

### B.2 随机性红线（这里是逻辑 bug 重灾区，逐条照做）

1. **随机发生在「结果揭晓」的瞬间，且只发生一次**：观众完成操作（或倒计时结束）→ 抽一次 → 此后本次 run 里这个 beat 的结果固定。抽到的 handle 必须写进 `run.trail` 的该条 choice 记录（已有 trail 结构），**回放、继续播放、读档都从 trail 读，绝不重抽**。读档点在该 beat 之前 → 重新玩到它时才再抽（这是对的：命运重新来过）。
2. **进度条/慢放期间不抽**：`during` 阶段只是演出，roll 在结算 tick 进行。
3. **随机与 retry 的组合**：retry 口被抽中 → 按现有 retry 逻辑倒回 `startSec - 2s`，再次触发时**重新抽**（每次尝试独立命运）。
4. **随机与连线**：随机口照样遵循「连线=分支，不连线=继续」。validate 加 `random_no_destination`（warning）：随机互动的所有 weight 口都没连线——「抽了也白抽」。
5. **编辑器呈现**：结果口配置里加「权重」数字输入（0 或留空 = 不参与随机）。节点上有任一口 weight>0 时，节点标题下显示「随机」徽标；validate 加 `random_partial_weight`（warning）：部分口配了 weight 部分没配。
6. **单测必过**：roll=0/0.999 边界、权重 0 口永不命中、归一化、trail 记录后回放不重抽（构造 run 调 `resolveBeat` 两次断言同结果——注意：第二次调用应当被「已结算」防重逻辑挡住，如果没有这层防重，先补防重再跑这条测试）。

---

## §C 选项弹出时画面定格/慢放——回归验收（玩家 #17）

功能是设计好的：`during: 'freeze' | 'slow' | 'play'`，choice 默认 freeze，慢放率 `STORY_SLOW_RATE = 0.25`。玩家在产品里看到「重新播放」，说明播放器管线有 bug（可能：切到 option 界面时 remount 了 video 元素导致从头播；或 freeze 用了「暂停 + 封面图」而封面图分辨率/帧不对像重播；或 beat 结束后 seek 回错了位置）。

### C.1 排查清单（按序执行，找到即修，修完继续验后面的）

1. beat 激活/结束时，`<video>` 元素的 React key 或 src 是否变化 → remount 从头播。修法：key 稳定、src 不变，只改 `playbackRate` / `paused`。
2. freeze 实现是 `video.pause()` 还是换静态图。若换图，静态图必须是「暂停那一帧的截图」而非视频首帧/海报图；若无可靠截图手段，**改为 pause()**（freeze 的及格线就是暂停，不需要截图）。
3. beat 结算后 `cut when 'after'`（本段播完再切）路径：seek 目标是否算错导致回到片段开头。对照 engine 的 `pendingHandle` 逻辑核对 PlayerStage 的 seek 调用。
4. choice 弹层出现/消失是否触发 video 的 `load()`（比如改了 crossOrigin 或 preload 属性）。

### C.2 验收脚本（测试机上逐条过）

- 60s 片段挂 57s 起 3s 的限时抉择，during=freeze：57s 画面停住、倒计时走、选完从 57s 继续（不从头、不跳帧）。
- 同上 during=slow：57s 起画面 0.25 倍速蠕动，倒计时 3 个真实秒。
- 同上 during=play：画面正常速度，倒计时走。
- 三种 during 下分别试「立即切」和「本段播完再切」：切点目标片段从头播是**对的**；本段继续时必须从切点续播。
- 回归：不挂互动的片段播放全程无 seek、无 remount（performance 面板无多余 load 事件）。

---

## §D 换互动类型不断线（玩家 #18，本批体验核心）

### D.1 交互

`story_interaction` 节点头部（类型名旁边）放下拉：六个子类型（含新 hotspot）。选中不同类型 → 走 `retargetInteraction(nodeId, nextKind)` 事务（useStoryCanvasActions 新增，内部一次 setNodes + setEdges，React 一批提交）。

### D.2 端口映射表（纯函数，进 `src/lib/interactive/interaction.ts`）

```ts
export function retargetHandleMap(prev: StoryInteractionSpec, next: StoryInteractionSpec): Map<string, string | null>
// value 为 null = 该口没有归宿，连线要断
```

| 旧 ↓ 新 → | tap/swipe/hold (success,fail) | timing (perfect,normal,miss) | choice (选项id…, timeout?) | hotspot (zoneid…, timeout) |
|---|---|---|---|---|
| **tap/swipe/hold** 互转 | success→success, fail→fail | success→normal, fail→miss；perfect 新口空 | fail→timeout（若 timeoutMode='exit'，否则断）；success→断 | fail→timeout；success→断 |
| **timing** | perfect→success, normal→success, miss→fail（perfect+normal 同撞 success：都保留，两条线共一口，合法） | — | miss→timeout（同上条件）；perfect/normal→断 | miss→timeout；perfect/normal→断 |
| **choice** | 选项口→断（除非旧选项 id 恰为 success/fail——不可能，选项是 opt_ 前缀）；timeout→fail | timeout→miss；选项→断 | — | timeout→timeout；选项→断 |
| **hotspot** | timeout→fail；zone→断 | timeout→miss；zone→断 | timeout→timeout（若 'exit'）；zone→断 | — |

规则一句话：**语义口对语义口（成功/完美→成功，失败/失误/超时互认），实体口（选项、热区）除了同为实体口否则必断。** timeout 只在目标是 choice/hotspot 或目标类型有 timeout 口时有归宿。

### D.3 事务流程（一次提交，红线 1 的落地）

1. 用旧 data 读 `prevSpec`，用 `defaultInteractionData(nextKind)` 生成新 data 的**类型专属部分**；**通用字段全部保留**：`title`（若等于旧类型默认名则更新为新默认名，否则保留创作者改的）、`startSec`、`durationSec`（保留，除非超出新类型上下界则 clamp）、`during`、`hint`、`results`（按映射表迁 key）、挂载线（mount edge 不涉及端口变化，天然保留）。
2. 算 `retargetHandleMap`，遍历以该节点为 source 的 flow 边：
   - handle 有归宿 → 改 `sourceHandle` 为新 handle，**边 id、target 不变**（画面不动）；
   - 无归宿 → 收集进 `dropped` 列表，先不删。
3. `dropped` 为空 → 直接提交，无弹窗。
4. `dropped` 非空 → 弹确认（CanvasDialogs 现有确认模式）：「换成『时机点击』后，3 条分支线没有对应的出口，将断开：选项一→片段B、选项二→片段C、超时→片段D」。**确认才提交**；取消则整个事务不发生，画布零变化。断开的边在提交时删除（不留悬空边，React Flow 里悬空 sourceHandle 的边会导致连线渲染异常）。
5. **Undo**：整个事务是一次 history 记录，Cmd+Z 一步回到换类型前（节点 data + 全部边）。如果现有 history 按 setNodes/setEdges 分开记，把这两步包进同一个 history batch；没有这个能力就先做 history batch 再做本功能，否则 undo 撤一半 = 新的逻辑 bug。

### D.4 端口映射记忆（可选增强，做不起就砍）

节点 data 加 `handleMemory: Record<string, { target: string; edgeId: string }>`：断开时记下「handle X 曾连到 Y」。换回来时若该 handle 存在且 Y 还在，提示「恢复之前的 2 条连线？」一键接回。**预算紧就整节砍掉，D.1–D.3 已经解决玩家痛点。**

### D.5 吸附不做

之前讨论过 React Flow 的 `reconnectEdge` 自动吸附悬空线头——本批**不做**，D.3 的映射 + 确认已经覆盖玩家场景，吸附引入新的意外连线风险。

### D.6 单测

- 映射表 4×4 全组合快照；
- 事务：全保留场景无弹窗（mock dialog 断言未调用）、部分断开弹窗文案列出正确边、取消后 nodes/edges 引用相等（零变化）、undo 一步还原；
- `results` 迁 key 后 effects/when/retry 逐字段相等；
- 挂载边、媒体边、与该节点无关的边在事务前后引用相等。

---

## 文件清单

| 文件 | 改动 |
|---|---|
| `src/lib/interactive/types.ts` | `hotspot` 枚举、`StoryHotspotZone`、spec 新分支、`StoryResultConfig.weight` |
| `src/lib/interactive/interaction.ts` | readSpec/handles/default/label 的 hotspot 分支；`resolveRandomHandle`；`retargetHandleMap` |
| `src/lib/interactive/validate.ts` | A.5、B.2.4/5 的新检查 |
| `src/lib/interactive/engine.ts` | **预期零改动**（I-R7）；随机性若需 trail 支持先看现有 trail 结构够不够，不够再动并回报 |
| `src/features/canvas/editor-types.ts` | add menu 加 hotspot |
| `src/features/canvas/story/StoryInteractionNodes.tsx` | hotspot 表单 + 热区拖拽编辑器 + 权重输入 + 类型下拉入口 |
| `src/features/canvas/story/useStoryCanvasActions.ts` | `retargetInteraction` 事务 |
| `src/features/canvas/components/CanvasDialogs.tsx` | 断线确认弹窗（复用现有确认壳） |
| `src/features/interactive/PlayerStage.tsx` 及互动组件 | hotspot 播放层 + 命中换算；§C 修复；随机结算接入 |
| `src/lib/interactive/__tests__/` | 本文所有纯函数单测 |

## 验收（测试机，逐条过）

1. **热区**：侦探场景——背景帧上 3 个隐藏热区，点中照片 → 线索片段；点中花瓶 → 彩蛋数值 +1 继续；5s 没点中 → timeout 到「错过线索」结局。横竖屏各一遍，热区判定不偏移。
2. **随机**：swipe 三口各 weight 1，连三个不同片段；玩 10 次统计分布大致均匀；中途退出读档，已结算的随机结果不重抽。
3. **定格**：§C.2 五条全过。
4. **换类型**：tap→swipe 连线全保留零弹窗；choice(3 选项全连线)→tap 弹窗列 3+1 条边、取消零变化、确认后 fail 口继承 timeout 那条线；undo 一步还原。
5. **旧作品回归**：测试机上打开 3 个既有作品，播放、分支、数值、存档行为与线上一致。
