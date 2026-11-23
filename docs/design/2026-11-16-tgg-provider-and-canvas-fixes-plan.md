# 2026-11-16 接入 TGG 视频服务商 + 两个界面 Bug 修复 — 实现文档

> 读者：qwen4max（实现 agent）。本文自成一体：不需要读之前的会话，也不需要向用户确认。
> 角色边界：设计者只出本文；**所有代码由实现 agent 写**。生产上线是唯一需要用户点头的环节（见 §10、§11）。
> 项目根：`/Users/headmasterx/Desktop/NoriVideo`。文中 `file:line` 是 2026-11-16 的行号，改动前先用文中给的 grep 锚点重新定位。

---

## 0. 全部改动一览

| # | 事项 | 一句话 | 主要文件 | 批次 |
|---|---|---|---|---|
| A | 接入 TGG 视频服务商 | 新增第三个视频上游 `tgg`，管理员可在 Kuaizi / TGG 间一键切换；两家分别记账；进行中的任务不受影响 | `src/lib/providers/tgg/*`（新）、`config.ts`、`async-poll.ts`、`generator-api.ts`、`nori-model-catalog.ts`、`workers/shared.ts`、管理页 | A1–A4 |
| B | 无限画布入口页「可用作品」封面遮挡标题 | 网格第一列 42px，封面实际 58px，压住文字；规则还写给了不存在的 `> i` | `src/features/canvas/canvas.css`、`FosCanvasHubClient.tsx` | B |
| C | 影游画布连线歪、端点接不上圆点 | React Flow 在 `.fos-app{zoom:1.2}` 下量出的圆点偏移被放大 1.2 倍（待实测确认） | `src/features/interactive/StoryChapterMap.tsx`、`interactive.css`、`StoryChapterNode.tsx` | C |

**优先级**：B、C 各约半小时到两小时，先做（A 的实机验证要等用户给 key）。批次顺序：**B → C → A1 → A2 → A3 → A4**，每批一个 commit，每批末尾跑该批的测试（§9）。

---

## 1. 执行规则（决策已替你做完，不要回头问用户）

R1. **TGG API key 绝不进仓库、文档、日志、commit、测试快照、截图。** 它只通过管理页「API 连接」卡片粘贴保存，或环境变量 `TGG_API_KEY`。代码里任何测试用的 key 都用明显的假值（`tgg-test-secret-value`）。日志/错误里出现 `Authorization`、`sk-` 开头串必须脱敏（复用 `sanitizePublicError`，并按 §A.9 扩充）。

R2. **不要改任何生产环境，不要 SSH 生产机。** 测试机 45.76.215.9 只做测试，密码走 `SSHPASS` 环境变量，不落文件。不要动 `/data`。部署测试机的步骤见 §10，生产上线等用户。

R3. **只在无头环境验证**：不开可见窗口，不跑重型 dev server。浏览器测试一律用 `tests/browser/*.browser.mjs` 这套「fixture 打包 + headless playwright-core」模式（见 `tests/browser/README.md`）。

R4. **不要做真实视频生成来验证**（要花钱）。真实生成只允许在用户明确批准后、用一条最短（最小秒数、最低分辨率）的任务做一次，且只在 §A.10 的步骤里。其余全部用单元测试 + `fetch` mock。

R5. **不要自动重试 TGG 的创建请求（POST /v1/videos）**。官方文档明确：不保证幂等，重发会产生多个计费任务。超时且没拿到 task id 时，抛不可恢复错误，让任务失败，由用户重新点生成。本项目 worker 对 handler 失败已经是 `UnrecoverableError`（`src/lib/workers/shared.ts:731-734`），不会自动重试；你只要保证 `src/lib/providers/tgg/` 里没有任何 `retry` 循环。

R6. **只改本文列出的文件。** 工作区里有大量别人未提交的改动（`git status` 很长），不要 `git add -A`，不要还原别人的改动；按文件名 `git add`。**不要编辑带 ` 2`/` 3` 后缀的 Finder 副本**（如 `canvas 2.css`、`FosWorkPanels 2.tsx`）。
R7. **暗色主题像素不变**：B、C 只改布局，不改颜色 token；不要引入硬编码颜色（项目有 `scripts/theme/tokenize-colors.mjs` 检查，跑 `npm run` 里对应的 theme 检查，见 §9）。
R8. 全程一天内最多一次生产上线（跨所有文档）。你**不上线生产**，只产出「测试机已验证」记录：`docs/deployments/test-tgg-provider-20261116.md`（格式照 `docs/deployments/test-lanmiaotv-animated-home-20261116.md`）。

---

## 2. 事实依据（已核实，不要再猜）

### 2.1 TGG API（2026-11-16 从公开文档 `https://tggtoken.org/docs/videos/` v1.5.0 读取，无需 key）

- 站点是 New API 网关，**本文档范围内只接入「通用视频 API」**；聊天/图片不接（文档明确 "不表示聊天、图片…采用同一媒体参数"）。
- 鉴权：`Authorization: Bearer <TGG token>`（令牌形如 `sk-…`，放服务端）。
- 基地址：`https://tggtoken.org`。接口：

| 用途 | 请求 | 说明 |
|---|---|---|
| 模型列表 | `GET /v1/models` | `data[].id` 即创建任务时的 `model`；**只读、免费**，用它做健康检查 |
| 创建任务 | `POST /v1/videos` JSON | `model`、`prompt` 必填；`seconds`(int，建议显式)、`ratio`(如 `16:9`)；参考素材见下；成功返回 `{id, object:"video", model, status:"queued"}`，**保存这个 `id`（不是上游 id）** |
| 查询 | `GET /v1/videos/{id}` | `status ∈ queued|in_progress|completed|failed`；可含 `progress`(0–100)、`error`、`content_url`、`delivery_status`；建议 5 秒一查 |
| 成品 | `GET /v1/videos/{id}/content` | **需要 Bearer**，流式转发，不是匿名链接；跨域重定向不要转发认证头 |
| 素材上传 | `POST /v1/materials`（可选） | 本项目**不用**：参考素材一律传公网 URL |

- 参考素材：**公开可读的 HTTP(S) URL**，有效期要覆盖「排队 + 生成」全过程；不收 Base64/Data URL/multipart。字段按模型而异：
  - 分类数组（`vig` 及多数）：`images[]`、`videos[]`、`audios[]`，元素是 URL 字符串
  - `seedance_v2.5_full`：只用 `files:[{"url":…}]`；**不接收** `images/videos/audios`、`aspect_ratio`
  - `ml-sd2.5`：`files:[{"url":…,"name":"真实文件名.ext"}]`，`name` 必填
  - `duration` 是 `seconds` 的别名，同时给必须一致，**只传 `seconds`**
  - `resolution`、`aspect_ratio`、`generate_audio`、`mode` 是可选扩展，**只对声明支持的模型发送**；比例统一用 `ratio`
- 时长/比例/分辨率/素材数量/提示词长度都**按模型校验**，没有查询接口。→ 必须用我们自己的 capability 目录（§A.6）在本地预检，给用户可读的错误。
- 完成但 `delivery_status: "failed"`：成品交付异常，**不要重新创建任务**，只重试下载。
- 已确认三个文档里出现的模型名：`vig`、`seedance_v2.5_full`、`ml-sd2.5`。**它们是否真的出现在你们令牌的 `/v1/models` 里要等 key**（§A.10 步骤 1）。模型清单无固定枚举，以 `/v1/models` 为准。

### 2.2 本仓库现状（实现时的模板）

- **绘梦工坊(`huimengi`)就是现成的「第二个视频上游」**，接入范式完全一致。**照抄它的文件清单**：`grep -rli huimengi src standards tests` 命中的每个文件，TGG 都要有对应改动（本文 §A.3 已逐个列出）。
- 平台服务商是固定集合：`src/lib/platform-services/config.ts:36-47`（`PROVIDER_BASE_URLS`、`PLATFORM_PROVIDER_IDS = ['deepseek','openlux','kuaizi','huimengi']`、`PROVIDER_NAMES`）；`src/lib/model-provider-contract.ts:3-8,29-34,56-62`（`MODEL_PROVIDER`、`MODEL_PROVIDER_PRESETS`、`normalizeModelProviderKey`）。
- **业务模型 → 上游模型的路由已经存在**：`modelRouting`（`src/lib/nori-model-catalog.ts` 的 `resolveNoriModelRoute`，视频只允许 `['kuaizi','huimengi']`，约 `:226-232`），管理页「按用途选择模型」每个业务模型一个下拉（`src/components/admin/PlatformAdminServicesPanels.tsx:94-115`）。**所以「切换服务商」不是新概念，是批量改 `modelRouting`**。
- 配置文件按文件签名缓存（`src/lib/service-config.ts:254-266`，mtime+size+inode），原子写入；web 与 worker 读到新路由**无需重启**。
- 异步任务的服务商已经“钉”在 `externalId` 里：`KUAIZI:VIDEO:<providerId b64>:<modelId b64>:<taskId>`（`src/lib/providers/kuaizi/external-id.ts`、`src/lib/async-poll.ts:34-88`）。续接轮询只看 externalId，不看当前路由。**切换不会让在途任务轮询错服务商。**
- 用户计费走**业务模型零售价**（`standards/pricing/nori-kuaizi.pricing.json` 的 `provider:"nori"` 条目，`src/lib/model-pricing/lookup.ts:94-100` 注释写明 business price first）。**切换上游不改变用户扣费**。
- 上游成本记录：表 `serviceUsageRecord` **已有 `provider` 与 `modelKey` 字段**（`src/lib/platform-services/usage.ts:11-61`），管理页用量表已经按 `provider+modelKey+serviceType+operation` 分组（`:100-170`）。**分别记账的底层已经具备，只缺两处：一个会记错的地方（§A.7）和一个按服务商汇总的视图（§A.8）。**

### 2.3 ⚠ 必须修的「切换时记错账」隐患（已在代码里定位）

`src/lib/workers/shared.ts:487`：

```ts
const runtimeModel = resolveRuntimeModelKey(billingInfo.model) || billingInfo.model   // 在任务【完成时】才解析路由
const parsedModel = parseModelKeyStrict(runtimeModel)
await recordServiceUsage({ provider: parsedModel?.provider ..., modelKey: ..., })    // :498
```

一条任务在 Kuaizi 提交、运行 3 分钟，期间管理员切到 TGG；任务完成时 `resolveRuntimeModelKey` 返回 TGG 路由 → **这条 Kuaizi 实际花的钱被记到 TGG 名下**。这违背「两个 api 分别记账」。§A.7 给出修法（用任务的 `externalId` 里钉住的服务商/模型记账）。

---

## 3. 事项 A：接入 TGG 视频服务商，并支持 Kuaizi ⇄ TGG 随时切换

### A.1 总体设计（先读这一节，再动手）

**目标**：管理员在管理页点一下，就能把「视频」的上游从 Kuaizi 切到 TGG（或切回），新任务立刻走新上游；已在跑的任务继续在原上游跑完并按原上游记账；两家的调用量/成本分别统计。

**不引入新的运行时概念**。运行时路由仍是 `modelRouting`（业务模型 → `provider::modelId`）。「切换」只是管理页的一个批量操作：把视频类业务模型的路由整体改到 TGG 的对应模型，或改回 `suggestedRoute`（Kuaizi）。

**状态**（由当前 `modelRouting` 推导，不另存）：
- `Kuaizi`：4 个视频业务模型全部路由到 `kuaizi::*`
- `TGG`：全部（有 TGG 对应模型的那些）路由到 `tgg::*`
- `混合`：两家都有（管理员也可以在「按用途选择模型」里逐个调）

**五条保证（实现和测试都要覆盖）**

| # | 保证 | 怎么做到 |
|---|---|---|
| G1 | 进行中的任务不受影响 | 服务商钉在 `externalId`（`TGG:VIDEO:…`），续接轮询只看它；**切换时不得清除任何一家的 key** |
| G2 | 尚未提交上游的任务走新上游 | 路由在提交时解析（`generateVideoInternal` → `resolveModelSelection`）；无需处理 |
| G3 | 用户扣费不变 | 业务模型零售价优先（`lookup.ts:94-100`）；不要给 tgg 模型建 `nori` 价格 |
| G4 | 两家分别记账 | `serviceUsageRecord.provider/modelKey` 记**实际执行**的服务商（§A.7 修隐患）；管理页按服务商汇总（§A.8） |
| G5 | 默认安全 | TGG 未配 key / 没有已验证定价的模型 → TGG 模型不可选、不可路由；持久化路由指向不可用模型时，`materializeEnvironmentConfig` 已有行为：回退到 `suggestedRoute`（Kuaizi）——不要改这个逻辑 |

**明确不做自动故障转移**（TGG 挂了不会悄悄回落 Kuaizi）：自动回落会让用户不知情地换上游、让记账口径模糊；本期提供「一键切回」+ 健康检查徽标即可。

### A.2 常量与类型

**`src/lib/model-provider-contract.ts`**
- `MODEL_PROVIDER` 增加 `TGG: 'tgg'`。
- `MODEL_PROVIDER_PRESETS` 增加 `{ id: MODEL_PROVIDER.TGG, name: 'TGG Token API', baseUrl: 'https://tggtoken.org' }`（**注意不带 `/v1`**，路径在 client 里拼）。
- `normalizeModelProviderKey`（`:56-62`）的 `||` 链追加 `|| rawKey === MODEL_PROVIDER.TGG`。

**`src/lib/platform-services/config.ts`**
- `PROVIDER_BASE_URLS`（`:36`）加 `tgg: 'https://tggtoken.org'`。
- `PLATFORM_PROVIDER_IDS`（`:42`）追加 `'tgg'`（放最后，管理页卡片顺序就是它）。
- `PROVIDER_NAMES`（`:43`）加 `tgg: 'TGG Token API'`。
- `environmentProviderKey`（`:132-137`）加 `if (providerKey === 'tgg') return string(process.env.TGG_API_KEY)`。
- `fixedPlatformModels()`（`:152`起）末尾追加（模式同 huimengi，**但只放「可选」的**）：
  ```ts
  ...listTggSelectableModels().map((model): ServiceConfigModel => ({
    modelId: model.modelId, name: model.name, type: 'video',
    provider: 'tgg', modelKey: `tgg::${model.modelId}`,
  })),
  ```
  `listTggSelectableModels()` 来自 `src/lib/providers/tgg/catalog.ts`（§A.4），规则：**同时存在 `tgg.catalog.json` 能力条目、`tgg.pricing.json` 定价条目、`model-profiles.json` 条目** 才算可选。这与 OpenLux 的 `listOpenLuxSelectableModels` 同一思路（`config.ts:146-150` 注释）。
- `savePlatformServiceConfig`（`:305-327`）：`rawProviders.length !== PLATFORM_PROVIDER_IDS.length` 与错误文案 `'DeepSeek, OpenLux, Kuaizi and HuiMeng are required'` 改为 `'… HuiMeng and TGG are required'`。**线上已存配置文件里没有 tgg**：`materializeEnvironmentConfig`（`:177-188`）按 `PLATFORM_PROVIDER_IDS` 重建 providers，所以旧配置读出来会自动多一个空 key 的 tgg，**不需要迁移脚本**；但要加测试证明（§9 `platform-service-config.test.ts`）。
- **路由守卫**（G5，新增）：在 `savePlatformServiceConfig` 里、`normalizeRoutingInput` 之后，检查结果路由里是否有 `tgg::` 且 `providers` 里 tgg 没有可用 key（`isUsableServiceSecret(apiKey)`，key 取自本次提交/已保存/环境变量）。有则 `throw new Error('SERVICE_CONFIG_INVALID: TGG 尚未配置 API Key，不能把视频路由到 TGG')`。管理页会把该消息原样展示（`route.ts:50-54` 已剥掉前缀）。

**`src/lib/providers/official/model-registry.ts:1`**：`OfficialProviderKey` 联合类型加 `'tgg'`（同 huimengi）。再 `grep -n "huimengi" src/lib/providers/official/model-registry.ts` 看是否还有对应分支，按需补。

### A.3 文件清单（逐个落实，打勾）

| 文件 | 动作 |
|---|---|
| `src/lib/providers/tgg/types.ts` | 新建（§A.4） |
| `src/lib/providers/tgg/client.ts` | 新建 |
| `src/lib/providers/tgg/external-id.ts` | 新建（照抄 `huimengi/external-id.ts`，前缀 `TGG`，`TggAsyncType = 'VIDEO'`） |
| `src/lib/providers/tgg/catalog.ts` | 新建（读 JSON 目录，导出 `listTggCatalogModels / listTggSelectableModels / getTggModelDefinition`） |
| `src/lib/providers/tgg/video.ts` | 新建（`generateTggVideo`） |
| `src/lib/providers/tgg/poll.ts` | 新建（`queryTggTaskStatus / pollTggTask`） |
| `src/lib/providers/tgg/routes.ts` | 新建（业务模型 → TGG 模型映射常量，§A.5） |
| `src/lib/providers/tgg/model-profiles.json` | 新建（TGG 专属：`referenceFormat`、`ratios`，§A.6；初始 `{}`） |
| `src/lib/providers/tgg/index.ts` | 新建（导出） |
| `src/lib/model-provider-contract.ts`、`src/lib/platform-services/config.ts`、`.../official/model-registry.ts` | 改（§A.2） |
| `src/lib/async-poll.ts` | 改：解析 `TGG` 命名空间、`pollAsyncTask` 分发（§A.5） |
| `src/lib/generator-api.ts` | 改：`VIDEO_PROVIDER_IDS`、分发分支（§A.5） |
| `src/lib/nori-model-catalog.ts` | 改：视频允许的服务商加 `tgg`（§A.5） |
| `src/lib/platform-services/discovery.ts` | 改：`tgg` 用 `listTggCatalogModels()`（照 `:74-77` 的 huimengi 分支） |
| `src/lib/platform-services/health.ts` | 改：`tgg` 用 `GET {base}/v1/models`（§A.4 末） |
| `src/lib/errors/sanitize-public-error.ts`、`src/lib/task/public-presentation.ts` | 改（§A.9） |
| `src/lib/errors/user-messages.ts` | 改：新增 `TGG_*` 错误码的中文文案（§A.9） |
| `src/lib/workers/shared.ts`、`src/lib/async-poll.ts` | 改：记账用实际服务商（§A.7） |
| `src/lib/platform-services/usage.ts`（+ 新增 `provider-report.ts` 可选） | 改：按服务商汇总（§A.8） |
| `standards/capabilities/tgg.catalog.json`、`standards/pricing/tgg.pricing.json` | 新建（§A.6）；两个目录都是 `readdirSync` 全量加载（`model-capabilities/catalog.ts:114`、`model-pricing/catalog.ts:188`），**放进去即生效，无需注册** |
| `src/components/admin/PlatformAdminServicesPanels.tsx`、`PlatformAdminServicesClient.tsx`、`platform-admin-services.ts` | 改：TGG 卡片、视频服务商切换卡片、按服务商对账（§A.8） |
| `tests/unit/providers/tgg-video.test.ts` 等 | 新建（§9） |

> 其余出现 `kuaizi` 的文件（`generator-options.ts:53`、`operation-task.ts`、`task-policy.ts:224`、`toolbox-video-task-handler.ts`、`media/seedance-reference.ts` 等）**本期不改**：它们是 Kuaizi 专属逻辑（Seedance 素材规范、画布视频编辑按 kuaizi 计价等）。`task-policy.ts:224` 的 `kuaizi::` 默认前缀只作用于「画布视频编辑」，保持不动。

### A.4 TGG 模块实现骨架

**`types.ts`**
```ts
export type TggModelModality = 'video'
export type TggReferenceFormat = 'categorized' | 'files' | 'files-named'

export interface TggModelDefinition {
  modelId: string                 // 必须与 GET /v1/models 的 id 完全一致
  name: string
  modality: 'video'
  referenceFormat: TggReferenceFormat
  supportsImages: boolean
  supportsVideos: boolean
  supportsAudios: boolean
  maxImages: number; maxVideos: number; maxAudios: number
  supportsResolution: boolean     // 为 false 时不得发送 resolution
  supportsGenerateAudio: boolean  // 为 false 时不得发送 generate_audio
  supportsAspectRatioField: boolean // false 时只发 ratio，永不发 aspect_ratio
  durationOptions: number[]       // 为空表示未核实 → 不可选
  ratios: string[]
  resolutions: string[]
}
export interface TggGenerateRequestOptions { provider: string; modelId: string; modelKey: string; [k: string]: unknown }
```
> 这些字段的**值**来自两份 JSON（§A.6）：通用能力来自 `standards/capabilities/tgg.catalog.json`（时长/分辨率/声音/首尾帧/素材数量），TGG 专属项（`referenceFormat`、`ratios`）来自 `src/lib/providers/tgg/model-profiles.json`。`catalog.ts` 负责合成 `TggModelDefinition`。**不要在 TS 里硬编码模型能力**，key 到手后只改 JSON。
> ⚠ **不能把 TGG 专属字段塞进能力 JSON**：`validateModelCapabilities`（`src/lib/model-config-contract.ts:123-133`，`VIDEO_ALLOWED_FIELDS`）拒绝未知字段，并且会让**整个**能力目录加载抛 `CAPABILITY_CATALOG_INVALID`，所有模型的能力查询都会坏。

**`client.ts`**（对照 `huimengi/client.ts`，差异见注释）
```ts
export const TGG_DEFAULT_BASE_URL = 'https://tggtoken.org'
export function buildTggUrl(baseUrl: string | undefined, path: string): string  // 同 buildHuimengiUrl，默认基址换成 TGG
export async function requestTgg(input: {
  apiKey: string; baseUrl?: string; path: string; method: 'GET' | 'POST'
  body?: Record<string, unknown>; timeoutMs?: number; signal?: AbortSignal
}): Promise<unknown>
```
- 头：`Authorization: Bearer ${apiKey}`；有 body 时 `Content-Type: application/json`。
- 超时：创建请求 60 s，查询 30 s。**创建请求超时/网络断开 → 抛 `TGG_SUBMIT_UNCONFIRMED`**（文案见 §A.9），**不得重试**（R5）。
- 非 2xx：从 `payload.error.message`（New API 标准结构 `{error:{message,type,code}}`）或 `payload.message` 取文案，经 `sanitizePublicError`，抛 `TGG_HTTP_ERROR(${status}): ${message}`。**402/403 含 “额度”** 单独映射为 `TGG_QUOTA_INSUFFICIENT`（余额不足要让管理员一眼看到）。429 → `TGG_RATE_LIMITED`。
- 永远不要把 `apiKey`、请求头写进日志或错误。

**`external-id.ts`**：`formatTggExternalId({providerId, modelId, taskId})` → `['TGG','VIDEO', b64(providerId), b64(modelId), taskId].join(':')`；`decodeTggExternalToken`。直接复制 huimengi 版本改名即可（含 `_MISSING/_INVALID` 错误码）。`taskId` 形如 `task_xxx`，即使含 `:` 也能被 `parts.slice(4).join(':')` 还原。

**`catalog.ts`**：读取 `standards/capabilities/tgg.catalog.json` 与 `standards/pricing/tgg.pricing.json`（复用现有 `findBuiltinCapabilityCatalogEntry('video','tgg',id)` 与 `findBuiltinPricingCatalogEntry('video','tgg',id)`，**不要自己再读文件**）。TGG 专属的 `referenceFormat/ratios` 放在 `src/lib/providers/tgg/model-profiles.json`（`import profiles from './model-profiles.json'`，`tsconfig` 已开 `resolveJsonModule`），**不要**放进能力 JSON 的 `capabilities.video`（会校验失败，见上）。
```ts
export function listTggCatalogModels(): TggModelDefinition[]      // JSON 里有能力条目的全部
export function listTggSelectableModels(): TggModelDefinition[]   // 同时有：能力条目 + 定价条目 + model-profiles 条目，且 durationOptions 非空
export function getTggModelDefinition(modelId: string): TggModelDefinition  // 不存在抛 MODEL_NOT_REGISTERED: tgg/video/<id>
```
> 刚落地时 JSON 里**没有**任何定价条目（价格要用户给），所以 `listTggSelectableModels()` 为空，管理页 TGG 卡片能存 key、能做健康检查，但没有可选模型——这是**预期的安全默认**，不是 bug。

**`video.ts`** — `generateTggVideo(params)`：入参与返回值**完全沿用** `generateHuimengiVideo` / `generateKuaiziVideo`（`{ userId, imageUrl, prompt?, options }` → `GenerateResult`：`{ success:true, async:true, requestId, externalId }`）。步骤：

1. `const model = getTggModelDefinition(params.options.modelId)`；`const config = await getProviderConfig(params.userId, params.options.provider)`。
2. 取值：`prompt = readString(params.prompt) || readString(params.options.prompt)`（空则抛 `TGG_VIDEO_PROMPT_REQUIRED`）。
3. **本地预检（用能力 JSON，给可读错误）**：
   - `seconds = options.duration`：必须是正整数且 ∈ `model.durationOptions`，否则抛 `TGG_VIDEO_DURATION_UNSUPPORTED: ${seconds}`（文案里列出该模型可选时长）。未传则**不发** `seconds`？——不行，文档建议显式；取 `model.durationOptions[0]`？**不要擅自改用户选择**：未传时抛 `TGG_VIDEO_DURATION_REQUIRED`（业务层 `generateVideo` 调用方总会传 `duration`，这是防御）。
   - `ratio = options.aspectRatio ?? options.ratio`：`adaptive`/空 → 不发；否则必须 ∈ `model.ratios`，否则 `TGG_VIDEO_RATIO_UNSUPPORTED`。
   - `resolution`：仅当 `model.supportsResolution` 才发；值不在 `model.resolutions` → `TGG_VIDEO_RESOLUTION_UNSUPPORTED`；不支持的模型**静默省略**（不要报错，业务 UI 默认会带分辨率）。
   - `generate_audio`：仅当 `model.supportsGenerateAudio && typeof options.generateAudio === 'boolean'` 才发。
4. **参考素材**（全部先转成公网 URL）：
   - 图片：`[imageUrl(首帧), ...options.referenceImages]` → `normalizeReferenceImagesForGeneration(list, { context:{provider, modelId} })`（huimengi video 同款，见 `huimengi/video.ts`）；视频/音频：`normalizeToOriginalMediaUrl(url)`，必须 `^https?://`，否则 `TGG_MEDIA_URL_PUBLIC_REQUIRED`。
   - **签名 URL 有效期**：TGG 要求链接在排队+生成全过程可读。先看 `normalizeToPublicImageUrlForGeneration` 与 `normalizeToOriginalMediaUrl`（`src/lib/media/outbound-image.ts`）生成的签名 TTL：**若 < 21600 秒（6 小时），给它们加一个可选参数 `ttlSeconds` 并在 TGG 路径传 21600**；若已 ≥ 6 小时则不用改。把核对结果写进部署记录。
   - 数量超过 `maxImages/maxVideos/maxAudios` → `TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED: images=N`。
   - 首/尾帧：TGG 文档没有首尾帧语义，**首帧当作 `images[0]`（参考图）**；`options.lastFrameImageUrl` 有值且模型能力 JSON 没声明 `supportsFirstLastFrame` → 抛 `TGG_VIDEO_FIRST_LAST_FRAME_UNSUPPORTED`（不要悄悄丢掉用户的尾帧）。
5. **按 `referenceFormat` 组装请求体**（`model` + `prompt` + 可选 `seconds/ratio/resolution/generate_audio` 为公共部分）：
   - `categorized`：`images/videos/audios`（空数组则**省略字段**）。
   - `files`：`files: urls.map(url => ({ url }))`（三类混在一个数组；不得同时带 `images/videos/audios`；`seedance_v2.5_full` **不发 `aspect_ratio`、不发 `resolution` 以外的别名**）。
   - `files-named`：同上但每项加 `name`：取 URL 路径最后一段并 `decodeURIComponent`；**必须带真实扩展名**，取不到扩展名则抛 `TGG_VIDEO_FILENAME_REQUIRED`（不要伪造扩展名，文档禁止）。
6. `POST /v1/videos`（`requestTgg`），`taskId = readString(record.id)`，空则 `TGG_VIDEO_TASK_ID_MISSING`。
7. 返回 `externalId: formatTggExternalId({ providerId: options.provider, modelId: model.modelId, taskId })`。**不要在这里记 usage**（异步任务在完成时记，见 §A.7；与 Kuaizi 一致，`generator-api.ts:268-272` 注释已说明）。

**`poll.ts`** — `queryTggTaskStatus({ taskId, apiKey, baseUrl, signal }) → PollResult`；`pollTggTask({ type, taskId, userId, providerToken, modelToken, signal })`（后者按 `huimengi/poll.ts:80+` 的结构：`decodeTggExternalToken` 取 providerId/modelId → `getProviderConfig(userId, providerId)` → 调 query）。映射：

| TGG 返回 | PollResult |
|---|---|
| `queued` / `in_progress` | `{ status:'pending' }`（`progress` 若有可忽略；轮询间隔沿用 `waitExternalResult` 现有节奏，不要在 poll 里 sleep） |
| `failed` | `{ status:'failed', error: sanitizePublicError(error.message ?? error ?? 'TGG task failed') }` |
| `completed` 且 `delivery_status==='failed'` | `{ status:'failed', error:'TGG_DELIVERY_FAILED' }`（**不要重新创建**；用户可手动重试生成） |
| `completed` | `{ status:'completed', resultUrl, videoUrl, downloadHeaders:{ Authorization:\`Bearer ${apiKey}\` }, ...pickVideoResultMetadata({ durationSeconds, resolution, aspectRatio }) }`，其中 `resultUrl = buildTggUrl(baseUrl, record.content_url \|\| \`/v1/videos/${taskId}/content\`)` |

> 成品下载走现有 `downloadAndUploadVideo(url, key, retries, requestHeaders)`（`src/lib/storage/index.ts:132`，已支持 `downloadHeaders`，`workers/utils.ts:152,547,653` 已透传）。它用 Node `fetch` 默认跟随重定向；Node 的 fetch 在**跨域**重定向时会丢弃 `Authorization`，符合 TGG 文档要求。**不要**改成手动转发头。
> `actualVideoTokens`：TGG 没有 token 计量，**不要返回**；成本走「时长×单价」（`usage-cost.ts` 里非 token 计价分支）。
> `durationSeconds`：`record.seconds`（若有）否则用提交时的秒数（业务层 `completedVideoDurationSeconds(data, result)` 会兜底，见 `shared.ts:489`）。

**`index.ts`**：像 `huimengi/index.ts` 一样导出。

**`health.ts`**（`src/lib/platform-services/health.ts:109-125,158`）：新增 `const isTgg = providerKey === 'tgg'`；探测 URL = `${baseUrl 去尾斜杠}/v1/models`，`GET`，头 `Authorization: Bearer`，15 s 超时；`healthy = response.ok`；`details.probe = 'models'`；`message` 沿用「连接正常，发现 N 个模型」。**这是只读免费接口，不会产生计费任务。** 注意文件里的 `isImageProvider`（用于记 `health-check` 用量的 serviceType）：tgg 记 `'video'`；先 `grep -n "isImageProvider" src/lib/platform-services/health.ts` 看它的定义再改。

### A.5 接线

**`src/lib/async-poll.ts`**
- 顶部：`import { pollTggTask } from './providers/tgg/poll'`、`import type { TggAsyncType } from './providers/tgg/external-id'`。
- `ParsedExternalId` 联合加 `| (BaseParsedExternalId & { provider: 'TGG'; type: TggAsyncType })`。
- `parseExternalId`：`if (namespace === 'TGG') { if (type !== 'VIDEO' || !providerToken || !modelKeyToken || !requestId) throw new Error(RETIRED_MESSAGE); return { provider:'TGG', type, providerToken, modelKeyToken, requestId } }`；`RETIRED_MESSAGE` 文案补上 TGG。
- `pollAsyncTask`：在 HUIMENGI 分支后加 TGG 分支，调用 `pollTggTask`。
- **新增导出（§A.7 要用）**：
  ```ts
  export function resolveExecutedModelKeyFromExternalId(externalId: string | null | undefined): string | null {
    if (!externalId) return null
    try {
      const p = parseExternalId(externalId)
      const provider = Buffer.from(p.providerToken, 'base64url').toString('utf8').trim()
      const modelId = Buffer.from(p.modelKeyToken, 'base64url').toString('utf8').trim()
      return provider && modelId ? `${provider}::${modelId}` : null
    } catch { return null }
  }
  ```
  三家的 providerToken/modelKeyToken 编码一致（base64url(providerId)/base64url(modelId)），所以不必按命名空间分别解码。

**`src/lib/generator-api.ts`**
- `:22` `const VIDEO_PROVIDER_IDS = ['kuaizi', 'huimengi', 'tgg'] as const`；`:27-28` 注释同步。
- 顶部 `import { generateTggVideo } from './providers/tgg'`。
- `generateVideoInternal`（`:195-216`）：在 huimengi 分支之后、`generateKuaiziVideo` 之前加：
  ```ts
  if (getProviderKey(selection.provider).toLowerCase() === 'tgg') {
    return await generateTggVideo({ userId, imageUrl, prompt: options?.prompt, options: providerOptions })
  }
  ```
- 同步同步路径的使用记录（`generateVideo` 里 `asyncSubmission` 判断）无需改：TGG 返回 `async:true`+`externalId`，不会在提交时重复记账。

**`src/lib/nori-model-catalog.ts`**（`resolveNoriModelRoute` 内 `:226-232`）：视频的 `allowedProviders` 改为 `['kuaizi', 'huimengi', 'tgg']`，注释同步。`resolveNoriModelRoute` 还要求业务模型或路由模型在定价目录里有条目——业务模型 `nori::*` 的零售价条目本来就存在，所以这条不会挡住 TGG 路由（G3）。

**`src/lib/providers/tgg/routes.ts`**（一键切换用的默认映射）
```ts
import type { NoriBusinessModelKey } from '@/lib/nori-model-catalog'
// 业务视频模型 → 默认 TGG 路由。只在“同一模型家族”时才填，跨家族一律留空（空 = 一键切换时该项保持 Kuaizi）。
export const TGG_VIDEO_ROUTE_BY_BUSINESS_KEY: Partial<Record<NoriBusinessModelKey, string>> = {
  // key 到手并核实 /v1/models 后再填，例如：
  // 'nori::norivideo2.5': 'tgg::seedance_v2.5_full',
}
export const VIDEO_BUSINESS_KEYS = ['nori::norivideo2.5','nori::seedance2.0-mini','nori::seedance2.0-fast','nori::seedance2.0'] as const
```
> **填写规则（不要问用户）**：只有当 `/v1/models` 里存在与业务模型**同一模型家族**的 TGG 模型才填（`norivideo2.5` ↔ Seedance 2.5 系；`seedance2.0*` ↔ Seedance 2.0 系）。`vig`、`ml-sd2.5` 等家族不明的**不要硬配**，留空并在部署记录里列出。映射值还必须同时出现在 `listTggSelectableModels()`，否则不生效（管理页会提示「暂无对应模型」）。
> `VIDEO_BUSINESS_KEYS` 不要手写：用 `listNoriBusinessModels('video').map(m => m.key)` 推导；上面这行只是说明含义。

### A.6 TGG 能力与定价数据（JSON，不是 TS）

**交付三份数据文件，初始内容都是「空」**（安全默认，G5）：

| 文件 | 初始内容 | 作用 |
|---|---|---|
| `standards/capabilities/tgg.catalog.json` | `[]` | 通用能力（时长、分辨率、声音、首尾帧、素材数量） |
| `standards/pricing/tgg.pricing.json` | `[]` | 上游成本定价（**只用于管理页成本统计，不是用户售价**，G3） |
| `src/lib/providers/tgg/model-profiles.json` | `{}` | TGG 专属：`referenceFormat`、`ratios` |

先写一个测试证明：三份文件为空时，应用启动、`listTggSelectableModels()` 返回 `[]`、能力目录与定价目录都能正常加载（`CAPABILITY_CATALOG_INVALID` 不出现）。

**key 与价格表到手后（§A.10）按下面的形状填，每个模型三处各一条；三处缺一不可，缺哪处该模型就不可选：**

> ⚠ 下面所有数字都是**占位示例**，不是事实。必须用 ① `GET /v1/models` 的真实 id ② 官方文档 `https://tggtoken.org/docs/videos/` 里该模型的取值范围 ③ 用户给的价格表 逐项核实后替换。**核实不了的字段宁可不填该模型，也不要猜。** 没有核实前，提交的 JSON 必须还是空的。

`tgg.catalog.json`（字段只能是 `VIDEO_ALLOWED_FIELDS` 里的那 9 个，见 `model-config-contract.ts:123`）：
```json
[
  {
    "modelType": "video",
    "provider": "tgg",
    "modelId": "seedance_v2.5_full",
    "capabilities": {
      "video": {
        "durationOptions": [5, 10],
        "resolutionOptions": ["720p"],
        "supportGenerateAudio": false,
        "firstlastframe": false,
        "inputSchema": {
          "image": { "min": 0, "max": 9 },
          "video": { "min": 0, "max": 3 },
          "audio": { "min": 0, "max": 3 }
        }
      }
    }
  }
]
```
- 模型不支持视频/音频参考 → `inputSchema.video`/`audio` 写 `{ "min": 0, "max": 0 }`（`catalog.ts` 据此推出 `supportsVideos/supportsAudios=false`、`maxVideos=0`）。
- 不支持分辨率字段 → **不写** `resolutionOptions`（`supportsResolution=false`，请求里就不会带 `resolution`）。
- 能否生成声音 → `supportGenerateAudio`；不确定就 `false`。

`model-profiles.json`：
```json
{
  "seedance_v2.5_full": { "referenceFormat": "files", "ratios": ["16:9", "9:16", "1:1"] }
}
```
`referenceFormat` ∈ `categorized | files | files-named`（含义见 §2.1）；`ratios` 是该模型 `ratio` 允许值，空数组表示「不发 ratio」。

`tgg.pricing.json`：用**每个时长一条显式档位**，不要依赖时长折算：
```json
[
  {
    "apiType": "video",
    "provider": "tgg",
    "modelId": "seedance_v2.5_full",
    "pricing": {
      "mode": "capability",
      "tiers": [
        { "when": { "duration": 5 }, "amount": 0 },
        { "when": { "duration": 10 }, "amount": 0 }
      ]
    }
  }
]
```
> `amount = 0` 只是占位，**写成 0 的档位等于没定价**：`catalog.ts` 的可选判断要求「`durationOptions` 里每个时长都能在 tiers 里找到 `amount > 0` 的档位」。原因：`calcVideoByDuration`（`src/lib/billing/cost.ts:814`）在有时长档位时直接按档位取价；没有时长档位时会按「5 秒基准价 × 秒数 ÷ 5」折算，对非线性定价会算错。金额单位与同目录 `huimengi.pricing.json` 一致（项目统一的计价单位，与 `calculateUsageCost` 输出同口径）；用户给的是人民币单价就直接填人民币，**不要自己做汇率换算**，换算不明时该模型保持不可选并写进部署记录。

**测试**（`tests/unit/providers/tgg-catalog.test.ts`，用 `vi.mock` 或临时目录注入夹具，不要改真实 JSON）：
1. 三处齐全 → 在 `listTggSelectableModels()` 里；缺任一处 → 不在。
2. 某个时长无 `amount>0` 档位 → 不在。
3. `calcVideoByDuration('tgg::<id>', 5, '720p')` 等于该档位金额（验证定价能被计费层读到）。

### A.7 修「切换时记错账」隐患（§2.3）

**目标**：`serviceUsageRecord.provider/modelKey` 记录的是**实际执行**的上游，而不是「任务完成时的当前路由」。

**改动 1 — `src/lib/workers/shared.ts`**（`:487-491`）。`workers/utils.ts` 已 import `shared.ts`，所以**不要**从 `utils.ts` 引入 `getTaskExistingExternalId`（会循环依赖）；`shared.ts` 已有 `prisma`，直接查：

```ts
import { resolveExecutedModelKeyFromExternalId } from '@/lib/async-poll'   // §A.5 新增导出

// 在 if (billingInfo?.billable && (billingInfo.apiType === 'video' || ...)) 内、原 runtimeModel 那行替换为：
const pinnedExternalId = (await prisma.task.findUnique({ where: { id: taskId }, select: { externalId: true } }))?.externalId ?? null
const pinnedModel = resolveExecutedModelKeyFromExternalId(pinnedExternalId)
const runtimeModel = pinnedModel || resolveRuntimeModelKey(billingInfo.model) || billingInfo.model
const parsedModel = parseModelKeyStrict(runtimeModel)
```
- `externalId` 在提交成功后立刻由 `trySetTaskExternalId` 写库（`workers/utils.ts:116`），任务完成时一定已存在；没有（同步型任务、语音等）则回退原逻辑——**行为对未切换的场景完全不变**。
- 先 `grep -n "from '@/lib/async-poll'" src/lib/workers/shared.ts` 确认没有循环导入；若 `async-poll` 间接 import 了 `shared`，把 `resolveExecutedModelKeyFromExternalId` 与 `parseExternalId` 抽到新文件 `src/lib/async-external-id.ts` 再导入。
- 同文件第二处 `serviceType:'audio'` 的记账（`:513` 起）**不要动**（语音只有 Kuaizi）。

**改动 2** — `grep -rn "recordServiceUsage" src` 逐个看是否还有「按当前路由而非实际执行」记视频用量的位置（例如 `async-poll.ts`、`generator-api.ts` 的同步路径）。同步成功路径记的是**提交时**解析的服务商，本来就对；只有「完成时重新解析路由」的才需要改。

**测试**（`tests/unit/workers/video-usage-pinned-provider.test.ts`，mock `prisma.task.findUnique`、`resolveRuntimeModelKey`、`recordServiceUsage`）：
1. externalId=`KUAIZI:VIDEO:<b64 kuaizi>:<b64 doubao-seedance-2-5-260628>:t1`，而当前路由已指向 `tgg::x` → `recordServiceUsage` 收到 `provider:'kuaizi'`、`modelKey:'kuaizi::doubao-seedance-2-5-260628'`。
2. externalId=`TGG:VIDEO:…` 而当前路由是 kuaizi → 记 `tgg`。
3. externalId 为空 → 走 `resolveRuntimeModelKey`（回归）。

### A.8 管理页（`/admin/...` 的「平台服务」页）

三处 UI 改动 + 一个后端接口。文件：`PlatformAdminServicesPanels.tsx`（面板）、`PlatformAdminServicesClient.tsx`（状态/调用）、`platform-admin-services.ts`（类型）。**所有文案简体中文，控件沿用现有 `fos-btn / fos-input / nori-admin-*` 类，不新增颜色。**

#### A.8.1 TGG 连接卡片（01 · API 连接）
- `PanelsProps` 不变；卡片由 `config.providers.map` 自动多出一张（`PLATFORM_PROVIDER_IDS` 已含 `tgg`）。在 `providerSummary` 三元链里加一支：
  `isTgg ? { icon: 'video' as const, description: '视频服务（可与 Kuaizi 切换）', capabilities: ['视频', '图生视频', '多模态参考'] }`。
- 面板说明文案 `:34` 改为「只需维护五套平台密钥。DeepSeek 负责文本，Kuaizi 负责语音；图片可在 OpenLux / 绘梦工坊 之间切换，视频可在 Kuaizi / 绘梦工坊 / TGG 之间切换。」
- 02 里视频用途的副标题（`:79`）改为 `Kuaizi / 绘梦工坊 / TGG API`。
- 卡片里 `API Key` 输入框沿用现有逻辑（`PasswordInput`、留空不改、已配置显示「已配置」）。**不要在任何地方回显 key。**

#### A.8.2 「视频服务商」切换卡片（02 · 按用途选择模型 的最上方，仅视频）
放在 `视频` 用途分区内、业务模型列表上方。布局（桌面）：
```
┌ 视频上游服务商 ─────────────────────────────────────────────┐
│ 当前： ● Kuaizi            健康：正常 · 近7天 123 次 ¥45.20   │
│ [ Kuaizi ] [ TGG ]        ← 分段按钮，当前项高亮、不可点      │
│ 进行中的任务：Kuaizi 3 个 · TGG 0 个（不受切换影响）          │
└─────────────────────────────────────────────────────────────┘
```
点击未选中的一项 → 向下展开「切换预览」（同卡内，不弹窗）：
```
切换到 TGG 后，新提交的视频任务改走 TGG：
 业务模型            现在                 切换后
 NoriVideo 2.5       Kuaizi · Seedance2.5 → TGG · seedance_v2.5_full
 Seedance 2.0 Mini   Kuaizi · …           保持 Kuaizi（TGG 暂无对应模型）
 …
⚠ 提示：进行中的任务继续在原服务商完成并按原服务商计成本；用户扣费不变。
⚠ 阻断：TGG 未配置 API Key / 暂无可用模型（若有，按钮置灰并说明原因）
[取消]   [确认切换并立即生效]
```
- 状态徽标：`Kuaizi` / `TGG` / `混合（部分 TGG）`；「混合」时分段按钮两项都可点。
- 「保持 Kuaizi」那一行要明确写出原因（`TGG 暂无对应模型` / `该模型 TGG 未定价`），**不要悄悄跳过**。
- 若切换预览里**没有任何一行会切到目标**（例如目标 TGG 但没有可用映射），按钮置灰，说明「TGG 暂无可用于视频的模型，请先完成模型与定价配置」。
- 提示条里的两条 ⚠ 是固定文案；再加一条固定提示：「TGG 路径下 Seedance 真人素材合规由 TGG 侧决定，Kuaizi 的私有素材库流程不会参与。」（`media/seedance-reference.ts` 只在 `provider === 'kuaizi'` 时生效，TGG 路由时不会走它。）
- 键盘可达：分段按钮用 `role="radiogroup"` + `role="radio" aria-checked`；确认按钮提交中显示「切换中…」并禁用；成功后在卡片顶部显示 `notice`「已切换到 TGG，新任务立即生效；进行中的 N 个任务不受影响」。

**数据流（服务端定方案，客户端只展示 + 点确认；避免客户端拼路由）**

新接口 `src/app/api/admin/services/video-provider/route.ts`（`requireSuperAdminAuth`，模式同 `../route.ts`）：
- `GET` → 当前状态：`{ current: 'kuaizi'|'tgg'|'mixed', inFlight: { kuaizi: number, tgg: number } }`。
  `inFlight` = `prisma.task.groupBy`/两次 `count`：`status in ('queued','processing')` 且 `externalId startsWith 'KUAIZI:VIDEO:'`（或 `'TGG:VIDEO:'`）。
- `POST { target: 'kuaizi'|'tgg', dryRun?: boolean }` → 返回 `plan`，`dryRun !== true` 时先校验再应用：
  ```ts
  type VideoSwitchPlan = {
    current: 'kuaizi' | 'tgg' | 'mixed'
    target: 'kuaizi' | 'tgg'
    rows: Array<{ businessKey: string; name: string; from: string; to: string; action: 'switch' | 'keep' | 'unavailable'; reason?: string }>
    blockers: string[]          // 非空 → 不应用，HTTP 409
    applied: boolean
  }
  ```
纯函数放 `src/lib/platform-services/video-provider-switch.ts`：
```ts
export function planVideoProviderSwitch(input: {
  routing: Record<string, string>                       // 当前 modelRouting
  businessModels: ReturnType<typeof listNoriBusinessModels>
  selectableTgg: string[]                               // listTggSelectableModels() 的 modelKey
  hasTggKey: boolean
  hasKuaiziKey: boolean
  target: 'kuaizi' | 'tgg'
}): VideoSwitchPlan
export function deriveVideoProvider(routing, videoBusinessKeys): 'kuaizi' | 'tgg' | 'mixed'
```
- 目标 `kuaizi`：每个视频业务模型的新路由 = 该模型的 `suggestedRoute`（`nori-model-catalog.ts` 里写死的 Kuaizi 路由）。已经是该值的 `action:'keep'`。
- 目标 `tgg`：新路由 = `TGG_VIDEO_ROUTE_BY_BUSINESS_KEY[businessKey]`，且在 `selectableTgg` 里才 `switch`；映射为空 → `keep` + `reason:'TGG 暂无对应模型'`；映射有但不可选 → `unavailable` + `reason:'该模型 TGG 未定价或能力未核实'`。
- blockers：目标 `tgg` 且 `!hasTggKey` → `'TGG 尚未配置 API Key'`；没有任何 `switch` 行且当前 ≠ 目标 → `'没有可切换的模型'`；目标 `kuaizi` 且 `!hasKuaiziKey` → `'Kuaizi 尚未配置 API Key'`。
- 应用：在 `config.ts` 新增并导出 `savePlatformModelRouting(patch: Record<string, string>)`：`readMaterializedPlatformServiceConfig()` → 只替换 `llm.modelRouting`（用同一个 `normalizeRoutingInput` 校验）→ 走**同一个**原子写盘（把 `savePlatformServiceConfig` 末尾 `:337-345` 的写盘抽成内部 `writeServiceConfigFile(next)` 复用）。**不要为切换去调用 `savePlatformServiceConfig`**（它要求完整 providers 载荷，且会重写 key）。
- 审计：`logInfo('[PlatformServices] 视频上游已切换', { audit: true, operatorUserId, from, to, changedKeys })`，**不记录任何 key**。
- 热加载：配置缓存按文件签名自动失效（§2.2），web 与 worker 无需重启；响应后另调 `resetStorageProvider` 之类**不需要**。

客户端（`PlatformAdminServicesClient.tsx`）：加状态 `videoPlan`、`switching`；点分段按钮 → `POST {target, dryRun:true}` 渲染预览；点确认 → `POST {target}`；成功后重新 `GET /api/admin/services` 刷新 `config`（把 `dirty` 保持不变，不要覆盖用户未保存的其它改动：只替换 `config.modelRouting`）。若页面 `dirty===true`，**在预览顶部提示**「页面有未保存的修改，切换只改视频路由，其它修改仍需点右上角保存」。

**测试**：`tests/unit/platform-services/video-provider-switch.test.ts`
1. 全 kuaizi → 目标 tgg，映射齐全 → 全部 `switch`；`deriveVideoProvider` 返回 `tgg`。
2. 映射只有 1 项 → 其余 `keep`，结果 `mixed`。
3. 无 key → `blockers` 含「TGG 尚未配置」，`applied:false`。
4. 目标 kuaizi → 回到 `suggestedRoute`；幂等（再切一次全 `keep`）。
5. `savePlatformModelRouting`（临时目录 + `SERVICE_CONFIG_PATH`，参照 `platform-service-config.test.ts` 的夹具）：只改 routing，providers/key/storage 字节不变；路由指向未配 key 的 tgg 抛 `SERVICE_CONFIG_INVALID`。

#### A.8.3 「按服务商对账」（04 · 调用用量 顶部）
目的：让管理员对着 Kuaizi / TGG 各自的后台账单核对。
- 后端：`getPlatformServiceUsageOverview` 返回值（`usage.ts` 的 `rows` 之后）新增 `byProvider`：
  ```ts
  byProvider: Array<{ provider: string; calls: number; success: number; failed: number; cost: number
    byType: Array<{ serviceType: string; calls: number; cost: number; units: number }> }>
  ```
  用已有的 `rows` 聚合即可（`cost` 已是 `calculateUsageCost` 的结果）；按 `cost` 降序。纯函数 `summarizeUsageRowsByProvider(rows)` 放在 `src/lib/platform-services/model-type-usage.ts` 旁边，便于单测。`UsageOverview` 类型同步加字段。
- 前端：在 `nori-admin-metrics` 与明细表之间加一张小表：
  | 服务商 | 调用 | 失败 | 视频(次 / 秒 / 成本) | 其它成本 | 合计成本 |
  视频行 `units` 是秒数（`recordServiceUsage` 里 `units: durationSeconds`）。表头旁加说明「金额为按上游定价估算的成本，不等于向用户收取的积分」。时间范围沿用右上角下拉。
- 测试：`summarizeUsageRowsByProvider` 一份：2 个服务商、含失败行（`cost=0`）、含同服务商多服务类型，断言合计。

### A.9 错误文案与脱敏

**`src/lib/errors/sanitize-public-error.ts`**（用户可见错误脱敏，不得泄漏上游品牌/密钥/地址）：
- 密钥：`/\b(?:kz|hm)-[A-Za-z0-9_-]{12,}/g` 扩为 `/\b(?:kz|hm|sk)-[A-Za-z0-9_-]{12,}/g`。
- 任务标识：`(?:KUAIZI|HUIMENGI):(?:VIDEO|IMAGE|AUDIO):` 加 `TGG`。
- 域名：`(kuaizi\.cn|openlux\.ai|huimengi\.com)` 加 `tggtoken\.org`。
- 品牌词：两处 `\b(?:KUAIZI|OPENLUX|HUIMENGI)…` 与 `\b(?:kuaizi|openlux|huimengi|筷子|…)\b` 加 `tgg`（注意 `\btgg\b` 只匹配独立词，不会误伤 `tgg_xxx` 以外的单词；加测试）。
- `tests/unit/` 里已有 sanitize 测试则就地加断言：输入 `Bearer sk-abcdefghijklmnop`、`https://tggtoken.org/v1/videos/x?token=1`、`TGG:VIDEO:YQ:Yg:task_1` 都被替换。

**`src/lib/task/public-presentation.ts`**（`publicGenerationTaskId`）：仿 HUIMENGI 分支加 `if (value.startsWith('TGG:'))`，`type` 只允许 `VIDEO`。**目的：用户界面只看到上游任务 id（`task_xxx`），看不到命名空间/服务商 token。** 加单测。

**`src/lib/errors/user-messages.ts`**（文件内按现有键值风格添加，中文，不含品牌名）：

| 错误码 | 文案 |
|---|---|
| `TGG_SUBMIT_UNCONFIRMED` | 视频生成服务响应超时，任务可能已提交也可能未提交；为避免重复扣费请不要立刻重试，稍后在作品里确认，仍无结果再重新生成。 |
| `TGG_QUOTA_INSUFFICIENT` | 视频生成服务额度不足，请联系管理员充值。 |
| `TGG_RATE_LIMITED` | 视频生成服务繁忙，请稍后再试。 |
| `TGG_VIDEO_DURATION_UNSUPPORTED` | 当前视频模型不支持所选时长。 |
| `TGG_VIDEO_RATIO_UNSUPPORTED` | 当前视频模型不支持所选画幅。 |
| `TGG_VIDEO_RESOLUTION_UNSUPPORTED` | 当前视频模型不支持所选分辨率。 |
| `TGG_VIDEO_REFERENCES_LIMIT_EXCEEDED` | 参考素材数量超出当前视频模型的上限。 |
| `TGG_VIDEO_FIRST_LAST_FRAME_UNSUPPORTED` | 当前视频模型不支持首尾帧。 |
| `TGG_VIDEO_PROMPT_REQUIRED` | 请先填写视频提示词。 |
| `TGG_VIDEO_FILENAME_REQUIRED` | 参考素材缺少带扩展名的文件名，请重新上传。 |
| `TGG_MEDIA_URL_PUBLIC_REQUIRED` | 参考素材需要可公开访问的地址，请重新上传。 |
| `TGG_DELIVERY_FAILED` | 视频已生成但交付失败，请稍后重试下载或联系管理员。 |
| `TGG_HTTP_ERROR` | 视频生成服务暂时不可用，请稍后再试。 |

先 `sed -n 1,60p src/lib/errors/user-messages.ts` 看键是怎么匹配的（精确匹配还是前缀匹配）再加，让 `TGG_HTTP_ERROR(502): …` 这类带后缀的消息也能命中，保持与 `KUAIZI_*`/`HUIMENGI_*` 现有条目一致的写法。

### A.10 key 到手之后的步骤（实现 agent 按序执行；每步写进部署记录）

0. **前置**：A1–A4 代码都已完成并通过单测；TGG key **只**通过管理页或环境变量提供，不要贴进对话/文件/终端历史（用 `read -s` 或管理页）。
1. **核对模型清单（只读免费）**：在管理页保存 key 后点「检测连接」。再写一个**一次性本地脚本**（放 `/tmp`，不入库，不回显 key，用 `read -s TGG_API_KEY`）调用 `GET https://tggtoken.org/v1/models`，把 `data[].id` 列表记录到部署记录。对照 §2.1 的三个候选 id 是否存在、是否还有其它视频模型。
2. **逐模型核实能力**：对要上线的模型，以官方文档为准写 `tgg.catalog.json` / `model-profiles.json`（§A.6）。**不要从别的模型照抄数值。**
3. **定价**：只用用户给的价格表写 `tgg.pricing.json`。**用户没给价格的模型保持不可选。**
4. **业务路由映射**：按 §A.5 的「同一模型家族才映射」规则填 `routes.ts`。
5. **跑全部单测**（§9）。
6. **最小真实生成验证（需用户事先批准，R4）**：用户批准后，在**测试机**上：管理页切到 TGG → 画布里用最短时长、最低分辨率、1 张参考图提交 1 条 → 观察：①任务进入 `processing` 且 `externalId` 以 `TGG:VIDEO:` 开头 ②完成后成品能播放 ③`serviceUsageRecord` 有 1 条 `provider='tgg'` ④管理页「按服务商对账」TGG 行 +1 ⑤随后切回 Kuaizi，再提交 1 条（同样最小）确认走 Kuaizi 且记 `kuaizi`。**不要批量测试。**
7. **切换并发验证**（可在步骤 6 的两条任务上做）：任务 A 提交到 Kuaizi 后立刻切到 TGG，等 A 完成 → A 的用量记在 `kuaizi`（验证 §A.7）。
8. 记录：测试机已验证项、模型清单、已填映射、未映射模型及原因、签名 URL TTL 核对结果（§A.4 第 4 点）。

### A.11 回滚

- **运行时回滚（秒级、不改代码）**：管理页点「Kuaizi」→ 确认切换；或把 `modelRouting` 视频项清掉，`materializeEnvironmentConfig` 会回落到 `suggestedRoute`（Kuaizi）。
- **彻底停用 TGG**：把路由切回 Kuaizi 即可，**不需要**清 key（管理页「API Key 留空」表示不修改，本来也没有清除入口）。TGG 不再被任何路由引用，也就不会产生调用。
- **进行中的 TGG 任务**：回滚后它们仍会轮询完成（只要 TGG key 还在）。**回滚前先看 §A.8.2 的「进行中的任务」计数**，非 0 时等它们结束再清 key。
- 代码回滚：A1–A4 各一个 commit，`git revert` 即可；本期无数据库迁移（`serviceUsageRecord.provider` 本就是自由字符串），回滚无数据风险。

---

## 4. 事项 B：无限画布入口页「可用作品」封面遮挡标题

### B.1 根因（已在源码里核实）

`src/components/frameos/FosCanvasHubClient.tsx:160` 渲染的是 `<WorkCover project compact />`——它是一个 `span.work-cover.is-compact`，**58×46 px**（`src/styles/frameos-replica.css:1541`，`.work-cover.is-compact { width:58px; height:46px }`，`position:relative; display:flex`）。

但 `src/features/canvas/canvas.css:3804-3817` 给按钮定义的网格是：
```css
.nori-canvas-hub-direct-projects > div > button { display:grid; grid-template-columns: 42px minmax(0,1fr) 16px; gap:12px; … }
```
第一列只有 **42px**，封面却是 58px：封面溢出列宽 16px，盖住 12px 的间距并再压住标题 4px；标题/副标题（`strong`/`small` 都是 `overflow:hidden; text-overflow:ellipsis`）被封面压住开头几个字。

规则里写的 `… > button > i`（`:3827-3844`，42px 方块 + `> i > b` + `> i > img`）是旧版「首字母方块」的样式，JSX 早已换成 `WorkCover`，**这三条规则现在匹配不到任何元素**，是死代码，也是上次修图时被改丢的地方。

### B.2 修改（只改 CSS，一个文件）

文件：`src/features/canvas/canvas.css`，先 `grep -n "nori-canvas-hub-direct-projects > div > button" src/features/canvas/canvas.css` 定位。

1. 网格第一列改为封面的实际宽度：
   ```css
   grid-template-columns: 58px minmax(0, 1fr) 16px;
   ```
2. **删除** `> button > i`、`> button > i > b`、`> button > i > img` 三条死规则（原 `:3827-3844`）。
3. 在原 `> button > svg` 规则之前加：
   ```css
   .nori-canvas-hub-direct-projects > div > button > .work-cover { width: 58px; height: 46px; min-width: 0; }
   ```
   （宽高重复声明是为了不依赖 `frameos-replica.css` 的加载顺序与特异性。）
4. 不改 `WorkCover.tsx`、不改 `frameos-replica.css`（它也被「作品」页的大封面使用）。
5. 不引入新颜色，不改 `--cover-a` 的 hover 逻辑。（顺带观察：`--cover-a` 写在封面 `span` 的内联样式上，按钮自身取不到，hover 描边会回退到品牌色，这是现有行为，**不要在本期改**。）
6. 手机宽度那条 `@media`（`:3942`，`> div { grid-template-columns: 1fr }`）不动。

### B.3 验收

新增 `tests/browser/canvas-hub-direct-projects.browser.mjs` + `canvas-hub-direct-projects.fixture.tsx`，模式照 `tests/browser/canvas-picker-scroll.*`（真实 CSS + 假数据 + 无头 Chromium，不连后端）。fixture 渲染与 `FosCanvasHubClient.tsx:140-167` **同样的结构**（`section.nori-canvas-hub-direct-projects` → `div` → 多个 `button`，里面放真实 `WorkCover compact`），外层包一层 `div.fos-app`（带 `zoom: 1.2`，因为线上就在这个缩放下）。用例（视口 1280×800 与 390×844 各一遍）：

- 数据：含**有封面图**、**无封面（生成式封面）**、**超长标题**（30 个汉字）、**英文长串无空格** 四种作品。
- 对每个按钮断言：
  1. `cover.right + 8 <= titleBlock.left`（封面与文字至少 8px 间距；用 `getBoundingClientRect`，两者在同一缩放下可直接比较）。
  2. 标题 `strong` 左侧内点的 `document.elementFromPoint(x + 4, y)` 命中的是标题自己（不是封面）。
  3. 封面完全在按钮内（`cover.left >= button.left`，`cover.bottom <= button.bottom`）。
  4. 标题与副标题都出现省略（`scrollWidth > clientWidth` 时 `text-overflow: ellipsis`），按钮高度一致，无换行撑高。
  5. 右侧箭头 `svg` 不与文字重叠。
- 截图存 `test-results/canvas-hub-direct-projects/`（已在 `.gitignore` 的 `test-results/` 里）。
- 先在**未改 CSS**时跑一遍，应当失败（断言 1、2 报重叠）；改完再跑通过——这是证明修的是真问题。

另加一条轻量单测 `tests/unit/canvas/hub-direct-project-css.test.ts`：读取 `canvas.css` 文本，断言 ①不存在 `.nori-canvas-hub-direct-projects > div > button > i` ②该按钮规则含 `grid-template-columns: 58px`。（项目里 CSS 字符串断言的写法见 `tests/unit/css-viewport-units.test.ts`。）

---

## 5. 事项 C：影游画布章节连线歪、端点接不上圆点

### C.1 现象
`/interactive/<workId>` 总览的章节图（`src/features/interactive/StoryChapterMap.tsx`，React Flow）里，粉色连线不是落在绿色入口圆点（`StoryChapterNode.tsx` 的 `Handle … nori-ix-handle is-entry`）上，而是落在它下面一截，看起来线歪了，也拖不上去。

### C.2 根因（2026-11-16 已用 Chrome 152 实测确认，不是猜测）

整个应用在 `.fos-app { zoom: var(--nori-interface-scale, 1.2) }`（`frameos-replica.css:125`）下渲染。Chrome 的标准化 CSS zoom 下：

| 量 | 取值方式 | 在 1.2 倍 zoom 里的结果 |
|---|---|---|
| 元素尺寸 | `offsetWidth/offsetHeight` | **布局像素（未放大）** |
| 位置差 | `getBoundingClientRect()` | **视觉像素（×1.2）** |

实测（本机 Chrome 152，把一个 `200×300` 节点放进 `zoom:1.2` 容器，圆点在节点内 `top:150px`）：
`offsetWidth = 200`，`BCR.width = 240`，**圆点相对节点的纵向偏移 BCR 差 = 180（应为 150）**。

`@xyflow/system` 的 `getHandleBounds`（`node_modules/@xyflow/system/dist/esm/index.js` 约 `:870`）用的正是 `(handleBCR.top - nodeBCR.top) / flowZoom`，而节点的宽高与 `transform` 位置用布局像素。所以**每个圆点的偏移量都被放大了 1.2 倍**：圆点在节点内越靠下，连线端点就越往下偏（节点内 150px 处偏 30px）。拖拽连线时的命中检测同样用这份偏移，因此「点也接不上」。

### C.3 先量再改（必须按顺序）

1. **写复现测试，先看它失败。** 新增 `tests/browser/story-chapter-map-edges.browser.mjs` + `story-chapter-map-edges.fixture.tsx`（照 `story-p1-acceptance.*`：同样的 esbuild 打包、`next-intl` 桩、真实 `interactive.css`，fixture 数据可直接参考 `story-p1-acceptance.fixture.tsx` 里章节总览的数据构造；需要 ≥2 个章节、1 条 `story.config.links`、每章至少 1 个入口与 1 个出口）。外层包 `div.fos-app`（`zoom:1.2`）。
2. **度量方法**（必须是视觉坐标，下面这个办法在缩放下是对的）：
   ```js
   // 在页面里执行
   function endPoints(edgeEl) {            // edgeEl = .react-flow__edge.nori-ix-link
     const path = edgeEl.querySelector('.react-flow__edge-path')
     const m = path.getScreenCTM()
     const toScreen = (p) => { const pt = new DOMPoint(p.x, p.y).matrixTransform(m); return { x: pt.x, y: pt.y } }
     return { start: toScreen(path.getPointAtLength(0)), end: toScreen(path.getPointAtLength(path.getTotalLength())) }
   }
   const center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
   ```
   端点对象：`start` ↔ 源章节出口 `.react-flow__handle.is-exit`；`end` ↔ 目标章节入口 `.react-flow__handle.is-entry`（用 `data-handleid`/`data-nodeid` 选）。
3. **断言**：`distance(end, entryHandleCenter) <= 3` 且 `distance(start, exitHandleCenter) <= 3`（单位：视觉 px）。覆盖：`zoom:1.2`；`html[data-zoom-mode="legacy"]`（`--nori-interface-scale:1`，相当于无缩放，应本来就通过）；对流程缩放 `flow.setViewport({zoom: 0.6})`、`1.4` 各做一次（端点偏移与流程缩放无关，但要确认）。
4. **改之前跑：期望失败**，且 `end` 与圆点中心的竖直距离大约是 `(圆点在节点内的 y) × 0.2 × 流程缩放`（几十 px）。**如果改之前就通过了**，说明本文的根因在你们当前环境下不成立——此时**停止修改**，把度量数据写进部署记录并回报，不要硬改（见 C.5 的备选）。

### C.4 修改（主方案，纯 CSS，不改 React Flow）

思路：让 React Flow 子树里的有效缩放回到 1，再把节点卡片自己放大回去，保持视觉大小不变。React Flow 内部（画布容器、节点包装层、连线 SVG、命中检测）全部在「有效缩放 = 1」下工作，`offsetWidth` 与 BCR 一致；节点卡片内的缩放对它外面的 `.react-flow__node` 包装层是「内容变大」，包装层的 `offsetWidth` 随之变大，与视觉一致。

文件 `src/features/interactive/interactive.css`（先 `grep -n "nori-ix-map" src/features/interactive/interactive.css`）：

```css
/* 抵消应用级 CSS zoom：React Flow 用 getBoundingClientRect 量圆点偏移（视觉像素），
   却用 offsetWidth 量节点（布局像素），两者在 zoom 下不一致。 */
.nori-ix-map .react-flow { zoom: calc(1 / var(--nori-interface-scale, 1.2)); }
/* 卡片自己放大回去，视觉尺寸与改动前一致 */
.nori-ix-map .nori-ix-chapter { zoom: var(--nori-interface-scale, 1.2); }
/* 控件在 .react-flow 内，同样放大回去 */
.nori-ix-map .react-flow__controls { zoom: var(--nori-interface-scale, 1.2); }
```
- `--nori-interface-scale` 由 `:root/html` 提供（`globals.css:59`，legacy 模式为 1），`.nori-ix-map` 在 `.fos-app` 里，变量继承可用。**不要**把 `1.2` 写死。
- 提示条 `.nori-ix-map-hint` 在 `.react-flow` 外面，不受影响，不要动。
- 不改 `StoryChapterNode.tsx` 的圆点位置规则（`left:-14.5px` / `right:-14.5px` 等）。
- 本改动让 `Handle` 的 `offsetWidth`(12) 与 BCR 宽度(14.4) 仍有 1.2 倍差，导致端点最多偏 ~1.2px，在容差内；不要为此再加补偿。
- **亮色主题像素不变**：只加 `zoom`，不碰颜色。

### C.5 备选（仅当 C.4 做完后 C.3 的断言仍不过）
按顺序试，每试一步重新跑 C.3 的测试，通过即停：
1. 检查是否还有别的祖先带 `zoom`（`getComputedStyle(el).zoom` 逐级向上；`frameos-replica.css:766` 是 admin 外壳，与本页无关）。把抵消放到那一级而不是 `.react-flow`。
2. 把抵消改到 `.nori-ix-map`（整个地图区，含提示条），提示条和控件各自再放大回去。
3. 最后手段：对本页用 `.fos-app:has(.nori-ix-map) { zoom: 1 }`，整页回到 1 倍（文字会比其它页小 1/6）。**只有这一条会改变页面视觉，用了要写进部署记录。**

### C.6 同类问题排查（只报告，不在本期修）
主无限画布（`CanvasGraph.tsx`）同样在 `.fos-app` 里。用同一套度量脚本在它的 fixture 上量一遍（`tests/browser/canvas-ui-regression.browser.mjs` 的数据可复用）：若连线端点偏差 > 3px，**不要在本期动手修**，把结果与截图写进部署记录交给用户决定（该画布线上没有被反馈过歪线，可能节点内圆点位置正好抵消，也可能已被别处补偿）。

### C.7 验收
- `story-chapter-map-edges.browser.mjs` 全部通过（C.3 的全部场景），并附修前失败、修后通过的数字（部署记录里列表）。
- 肉眼：拖一条新连线，圆点高亮 `.connectingto` 出现、松手能连上；选中连线粉色高亮仍在；`Delete` 能删。
- 回归：`tests/browser/story-p1-acceptance.browser.mjs`、`story-interaction-nodes.browser.mjs` 仍通过；章节卡片视觉宽度与修前一致（288 CSS px × 缩放 = 视觉 345.6px，误差 ≤ 1px）。
- §9 末尾的「新增行无颜色字面量」检查通过。

---

## 6. 批次与提交顺序

| 批次 | 内容 | 提交信息 | 本批测试 |
|---|---|---|---|
| **B** | §4 | `fix(canvas): stop hub project covers overlapping titles` | B.3 的浏览器测试 + CSS 单测 |
| **C** | §5 | `fix(interactive): keep chapter edges on their handles under CSS zoom` | C.3 浏览器测试 + story 回归 |
| **A1** | §A.2 常量/类型、§A.4 TGG 模块、§A.5 接线、§A.6 空数据文件、`discovery/health` | `feat(tgg): add TGG video provider` | `tgg-*.test.ts`、`platform-service-config.test.ts`、`nori-model-catalog.test.ts` |
| **A2** | §A.7 记账修复、§A.9 脱敏与文案 | `fix(billing): attribute video usage to the executing provider` | `video-usage-pinned-provider.test.ts`、sanitize 测试 |
| **A3** | §A.8 后端：路由守卫、`savePlatformModelRouting`、`video-provider` 接口、`byProvider` 用量 | `feat(admin): switch video provider and report usage per provider` | `video-provider-switch.test.ts`、`usage` 相关单测 |
| **A4** | §A.8 前端：TGG 卡片、切换卡片、对账表 | `feat(admin): video provider switch UI` | `admin-services.browser.mjs` 更新并通过 |

规则：每批独立可回滚；一批没过测试不进入下一批；按文件名 `git add`（R6）；**不 push**。

---

## 7. 明确不做

- 不接 TGG 的聊天/图片/音频接口；不用 TGG 的素材上传接口 `/v1/materials`。
- 不做自动故障转移（TGG 失败自动回落 Kuaizi）：会让用户不知情地换上游，记账口径也会模糊。
- 不改用户端售价与积分扣费（业务模型零售价不变）；不给 `tgg` 建 `provider:"nori"` 价格。
- 不改 `workers/shared.ts` 里语音（audio）记账，不改 Kuaizi 的 Seedance 素材库流程。
- 不修主无限画布可能存在的同类缩放偏差（只报告，C.6）。
- 不动登录/首页/计费/配额代码，不动 Finder ` 2`/` 3` 副本，不动 `zhanghongbo`/`duhongbo` 数据。
- 不提交 TGG key、价格表原件、`/v1/models` 的完整响应到仓库（部署记录里只写 id 清单）。

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| TGG 创建任务超时但其实已建（重复计费） | R5：不自动重试，抛 `TGG_SUBMIT_UNCONFIRMED` 并提示用户先别重试 |
| TGG 模型能力/价格靠人工核实，填错会错扣成本、错放选项 | 三处缺一不可选；写入前对照官方文档；部署记录里列出每个模型的来源 |
| 参考素材 URL 在排队期间过期 | §A.4 第 4 点核对签名 TTL，必要时 TGG 路径传 6 小时 |
| 管理员误切到 TGG 导致用户体验变化 | 切换卡片预览 + 二次确认；「进行中任务」计数；一键切回 |
| 在途任务轮询时 TGG key 被换/清 | key 只增不清（A.11）；`getProviderConfig` 取最新 key，更换后新旧任务都用新 key，TGG 令牌一般同账号通用，换 key 后先看「进行中」计数 |
| `check:no-hardcoded-model-capabilities` 等守卫误报 TS 里的模型 id/数值 | TS 里**不出现任何具体 TGG 模型 id 或能力数值**（全部来自 JSON，§A.6）；`routes.ts` 里的示例映射保持注释；若仍报错，**不要改守卫脚本**，改代码迁到 JSON |
| C 方案的 `zoom` 抵消在某些浏览器行为不同 | `data-zoom-mode="legacy"`（Chrome<128）时 `--nori-interface-scale=1`，抵消为 1；C.3 测试覆盖 legacy 分支 |
| 工作区里别人的未提交改动被带入提交 | R6：按文件名 `git add`，提交前 `git diff --cached --stat` 对照本文清单 |

---

## 9. 测试与检查命令

单测（先单文件，再整目录）：
```sh
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/providers/tgg-*.test.ts \
  tests/unit/platform-service-config.test.ts tests/unit/nori-model-catalog.test.ts \
  tests/unit/platform-services tests/unit/workers tests/unit/canvas/hub-direct-project-css.test.ts
npm run test:billing:unit
```
新增的单测清单：`tgg-catalog`、`tgg-video`（请求体三种 `referenceFormat`、预检错误、不重试）、`tgg-poll`（五种状态映射、`delivery_status:'failed'`、`downloadHeaders`）、`tgg-external-id`、`tgg-client`（超时→`TGG_SUBMIT_UNCONFIRMED`、402→额度、脱敏）、`video-usage-pinned-provider`、`video-provider-switch`、sanitize / `publicGenerationTaskId` 增量、`platform-service-config`（旧配置文件无 tgg 时自动补出空 key 的 tgg）、`summarizeUsageRowsByProvider`。**`fetch` 一律 mock，绝不真发请求。**

守卫与类型：
```sh
npm run check:config-center-guards   # 含 capability/pricing 目录校验，必须通过
npm run check:no-provider-guessing
npm run check:model-config-contract
npm run check:api-handler            # 新增的 API 路由要符合 apiHandler 约定
npm run check:logs                   # 不得出现 console.*
npx tsc --noEmit 2>&1 | grep -v " 2\.\| 3\." # 仓库里有 Finder 副本造成的既有错误，只看本次改动文件有无新增
git diff --check
```
主题颜色检查：`scripts/theme/tokenize-colors.mjs` 是迁移脚本，不要运行它改文件；B、C 只改布局，没有颜色字面量，提交前 `git diff -U0 -- src/features | grep -E "#[0-9a-fA-F]{3,8}\b|rgb\("` 确认本次新增行里没有新的颜色字面量。

浏览器回归（无头，R3）：
```sh
node tests/browser/canvas-hub-direct-projects.browser.mjs
node tests/browser/story-chapter-map-edges.browser.mjs
node tests/browser/story-p1-acceptance.browser.mjs
node tests/browser/story-interaction-nodes.browser.mjs
node tests/browser/admin-services.browser.mjs     # A4 后需更新：多了 TGG 卡片与切换卡片
```
浏览器工具目录用 `NORI_BROWSER_TOOLS_DIR`（见 `tests/browser/README.md`）；Chrome 路径默认 `/Applications/Google Chrome.app/…`，可用 `NORI_CHROME_EXECUTABLE` 覆盖。

---

## 10. 测试机部署与部署记录

- 只部署测试机 `45.76.215.9`（R2）。具体 SSH/同步/构建步骤沿用 `docs/deployments/test-lanmiaotv-animated-home-20261116.md` 里的做法，**密码走 `SSHPASS` 环境变量**。
- 构建要通过 `npm run build`（含 `build:workers`——TGG 轮询跑在 worker 里，worker 包必须重建）。
- 部署后在测试机复验：B（入口页）、C（影游画布）、A 的管理页（保存 key、检测连接、切换预览/切换/切回、对账表）。真实生成只有用户批准后做一条最短的（§A.10 步骤 6）。
- 写 `docs/deployments/test-tgg-provider-20261116.md`：实现范围、`/v1/models` id 清单、每个已启用模型的能力与价格来源、`routes.ts` 映射与未映射原因、签名 URL TTL 核对、C 的修前/修后度量数字、C.6 的同类排查结果、测试与守卫结果、**未做的事**（未上生产、未提交推送）。**不得包含任何 key。**

---

## 11. 用户待办（只有这些需要用户）

1. **TGG API key**：到手后只填进管理页「API 连接 · TGG Token API」卡片，或部署时放环境变量 `TGG_API_KEY`；**不要发给 agent，也不要贴进文档/聊天**。
2. **TGG 价格表**：每个要用的视频模型、每个时长的单价（说明币种与计费单位）。没有价格的模型保持不可选。
3. **最小真实生成测试批准**：同意在测试机用最短时长 + 最低分辨率各跑 1 条（TGG 一条、切回 Kuaizi 一条），否则只做 mock 验证。
4. **生产上线批准**：测试机验收通过后，由用户决定是否上线；一天只上线一次。
5. （可选）哪些业务视频模型应映射到哪个 TGG 模型——不给则按「同一模型家族才映射」自动决定，其余保持 Kuaizi。
