# 蓝猫剧场：互动影游微信小程序内容平台完整实现方案

日期：2026-11-16 · 角色：产品 / 架构设计 → 由 qwen4max 实现。本文自成一体，照做即可，不需要再问用户。

---

## 0. 这份文档在解决什么

**现状（已核对代码）**

- 一部影游由三部分组成：一个 `Work`（`productLine = 'story'`，`prisma/schema.prisma:422`）、一条 `InteractiveStory`（`:448`，故事配置存在 `config` JSON 里，类型是 `InteractiveStoryConfig`），以及多个章节 `Project`。
- 服务端 `getInteractiveStory`（`src/lib/interactive/service.ts`）把每章的第一张画布编译成 `StoryChapterGraph`。客户端再用 `buildStoryProgram`（`src/features/interactive/story-overview-model.ts:52`）拼成 `StoryProgram`，交给纯函数引擎（`src/lib/interactive/engine.ts`：`startRun :258` / `advanceRun :279` / `resolveBeat :343` / `purchaseShopItem :431`）。
- 作品**只能**在 B 端编辑器的「全剧试玩」（`src/features/interactive/StoryOverview.tsx:122`）里玩。这里没有「发布」或「版本」的概念，试玩读的是草稿，编辑器一改，内容就变了。
- 媒体引用是原始字符串，有三种：storage key（`images/…`、`video/…`）、`/api/storage/sign?key=…`、供应商的绝对 URL。其中有些是会过期的签名 URL。编译后的媒体有 `durationSec` 和 `posterUrl`，没有宽高。
- 进度只存在 `localStorage`（`src/features/interactive/player/viewer-store.ts`），没有任何服务端进度。
- 下面这些全都没有：微信登录、C 端账号、支付、内容审核、CDN、转码、埋点、公开目录接口。
- 视频代理 `sign?playback=1` 占了约 87% 的出网流量，按 0.8 元/GB 计费。**C 端视频绝不能再走 app 代理。**

**目标**

做一个完整的内容平台，链路是：

1. 创作者在 B 端一键「发布到小程序」，系统生成一个**不可变版本**。
2. 平台审核。
3. 小程序上架。
4. 观众发现、游玩、收集结局和成就、云存档、评分、分享。
5. 宣发链路（预约、订阅提醒、分享卡、结局海报、渠道码、榜单、专题、推荐位、社交证明）把流量带回来。
6. 数据回流给创作者和运营。

**产品名**：「蓝猫剧场」。品牌名只在 `miniprogram/miniprogram/config.ts` 的 `BRAND_NAME` 定义一次，用户以后可以自己改。

**总体架构**

```
B 端 lanmiaoai.com（现有 Next）               运营后台 :8080（super_admin）
  影游总览 →「发布到小程序」                     内容审核 / 内容运营 / 小程序数据
      │ POST /api/interactive/:workId/publish/releases      │ /api/admin/mp/*
      ▼                                                       ▼
  Task story_release_build（text worker）──► StoryRelease（不可变快照）──► MpWork（上架条目）
      │ ffmpeg 转码 / 末帧 / 封面 / 联系表 / 预告片
      ▼
  TOS  mp/releases/<releaseId>/…  ──►  CDN media.lanmiaoai.com（A 型鉴权）
                                              ▲  视频 / 图片 / program.json 直连，永不经 app
小程序（原生 + TypeScript）── /api/mp/* ──► Next（同一个 app 容器）── Redis（缓存/限流/锁）── MySQL
  runtime/story-runtime.js ← esbuild 打包 src/lib/interactive 纯函数（与 B 端同一份引擎）
watchdog（scripts/watchdog.ts）：定时上线 / 统计聚合 / 订阅消息发送 / 事件清理
```

---

## 1. 全部功能改动一览

| # | 模块 | 改动 | 主要位置 | 批次 |
|---|---|---|---|---|
| 1 | 配置隔离 | 根 tsconfig/eslint/.dockerignore 排除 `miniprogram/`；新增 env | `tsconfig.json`、`eslint.config.mjs:15-30`、`.dockerignore`、`.env.example` | B1 |
| 2 | 数据模型 | 新增 17 张表（§B） | `prisma/schema.prisma` 末尾 | B1 |
| 3 | 发布入口 | 影游总览头部加「发布到小程序」按钮 | `StoryOverview.tsx` 头部 `nori-ix-ov-head` | B1 |
| 4 | 发布页 | 上架信息 / 发布前检查 / 版本 / 上线设置 / 推广 / 数据 | `src/app/[locale]/interactive/[workId]/publish/page.tsx` + `src/features/mp-publish/*` | B1（推广、数据在 B5） |
| 5 | 版本生成任务 | `TASK_TYPE.STORY_RELEASE_BUILD`：快照、媒体收集、转码、清单、program.json | `src/lib/task/types.ts`、`src/lib/workers/text.worker.ts`、`src/lib/mp/release/*` | B1 |
| 6 | 审核 | 运营后台「内容审核」：文本清单、联系表、通过/驳回 | `src/app/[locale]/admin/mp-review/*`、`/api/admin/mp/releases/*` | B1 |
| 7 | C 端账号 | 微信静默登录、自有 JWT、昵称和内置头像 | `/api/mp/auth/login`、`src/lib/mp/auth.ts` | B2 |
| 8 | C 端 API | 首页、列表、榜单、搜索、详情、播放、存档、收藏、评分、埋点、举报 | `src/app/api/mp/**` | B2 |
| 9 | CDN 签名 | A 型鉴权 URL，未配置时测试机回退 TOS 直链 | `src/lib/storage/cdn.ts` | B2 |
| 10 | 小程序工程 | 原生 TS 工程、运行时打包、请求封装、埋点队列 | `miniprogram/` | B3 |
| 11 | 小程序页面 | 首页、发现、搜索、详情、专题、榜单、我的、图鉴、记录、收藏、设置 | `miniprogram/miniprogram/pages/*` | B3 |
| 12 | 播放器 | `story-player`：双视频槽、节拍时钟、6 种互动、商店、存档、成就、人格、地图、结局卡 | `miniprogram/miniprogram/pkg-play/*` | B4 |
| 13 | 云存档 | 本地优先 + 云端合并 | `/api/mp/saves/*`、`miniprogram/.../lib/save-sync.ts` | B4 |
| 14 | 分享与海报 | 会话卡片、朋友圈单页、结局海报（带小程序码） | `/api/mp/shares`、`/api/mp/wxacode` | B5 |
| 15 | 渠道码与归因 | 创作者/运营渠道码、首触归因、每次游玩归因 | `MpChannel`、登录接口 `launch` 字段 | B5 |
| 16 | 预约与订阅消息 | 定时上线、预约、上线提醒、更新提醒 | `MpSubscription`、`src/lib/mp/jobs.ts` | B5 |
| 17 | 运营位 | 推荐位、专题、榜单 | `MpFeatureSlot`、`MpTopic`、`/admin/mp-ops` | B5 |
| 18 | 社交证明 | 选择分歧、结局稀有度 | `MpBranchStat`、`/api/mp/releases/:id/stats` | B5 |
| 19 | 数据看板 | 创作者数据（发布页）+ 运营总览（后台） | `MpWorkDailyStat` | B5 |
| 20 | AIGC 标识 | 详情页徽标、播放器常驻角标、转码写入元数据 | 详情页、播放器、转码参数 | B1/B3/B4 |
| 21 | 付费 | 虚拟支付 / 激励视频：**只设计不实现**，用户明确开通后才做 B6 | §I | B6（待定） |

---

## 2. 执行规则

- **R1 引擎语义不改。** `src/lib/interactive/*` 只允许一处改动：在 `service.ts` 按 §C.3 抽出一个不需要 session 的内部函数，`getInteractiveStory` 的对外行为保持不变。
  - 小程序运行时的打包入口放在 `src/lib/mp/runtime-entry.ts`（§F.2），只做 re-export。
  - 其余已有函数的签名和行为一律不动。
  - B 端试玩器现有单测必须全绿。
- **R2 版本不可变。** `StoryRelease` 生成成功后，它的 `program`、`manifest` 和 `mp/releases/<releaseId>/` 下的文件永不修改、永不覆盖、永不删除。要改内容就发新版本。
- **R3 B 端权限模型不动。** 只有 `getInteractiveStory` 返回 `story.canManage === true` 的人能发布、下架、生成渠道码。不新增角色，不改 `getWorkAccess`。
- **R4 C 端账号与 B 端完全隔离。**
  - `ConsumerUser` 是独立的表，JWT 用独立秘钥 `MP_JWT_SECRET`。
  - `requireConsumerAuth` 只认 `Authorization: Bearer <token>`。
  - `/api/mp/*` 不读 next-auth session，B 端接口也不认 C 端 token。
- **R5 媒体永不经 app 代理。** 视频、图片、program.json 不得经过 `/api/storage/sign` 或任何 app 代理。
  - C 端只返回 CDN URL。
  - 未配置 `MEDIA_CDN_BASE_URL` 时，若 `MP_ALLOW_TOS_DIRECT=1`（只在测试机设置），回退为 TOS 预签名直链；否则 `/play` 返回 503 `MP_CDN_NOT_CONFIGURED`。
- **R6 不做诱导分享**（微信小程序平台运营规范）。
  - 分享不给任何奖励，不用分享解锁内容。
  - 不出现「分享后继续」「邀请好友解锁」「助力」之类的文案或逻辑。
  - 归因只用于统计。
- **R7 秘钥只在 env。** `MP_APP_SECRET`、`MP_JWT_SECRET`、`MEDIA_CDN_AUTH_KEY`、`MP_CI_PRIVATE_KEY_PATH` 不得出现在代码、文档、提交、日志或聊天里。日志里的 openid 只打前 6 位。
- **R8 部署纪律。**
  - 先上测试机 45.76.215.9，密码只通过 `SSHPASS` 环境变量传入。
  - 生产上线必须等用户确认。
  - 永远不用 `lanmiao-prod` 别名。
  - 永远不删 `/data` 下任何东西。
- **R9 跳过 Finder 复制出的 「 2」 文件**（例如 `engine 2.ts`）：不读、不改、不打包、不提交。
- **R10 只做无头操作。**
  - 不打开微信开发者工具 GUI，不起可见浏览器或重型 dev server。
  - 小程序的验证手段是 `tsc`、vitest，以及 `miniprogram-ci preview`。preview 生成的二维码 PNG 交给用户扫码。
- **R11 依赖隔离。** 小程序依赖只装在 `miniprogram/package.json`。根 `package.json` 不新增任何依赖。
- **R12 文案逐字实现。** 本文给了文案的，一字不改。本文没写的，按同页风格写最短的中文，不加 emoji。
- **R13 不自行加功能。** 评论、弹幕、私信、关注创作者、充值、签到、任务体系都不做。
- **R14 提交纪律。** 每批结束先跑本批 DoD 命令，全绿才提交。提交信息用 `feat(mp): …` 或 `fix(mp): …`。同一批可以多次提交，但不跨批混提。
- **R15 文档与代码不一致就停。** 锚点 grep 不到、函数签名不同、表或字段已存在，都要停下来问用户，不要猜。

## 3. 全局逻辑红线

1. C 端能看到的作品必须满足 `MpWork.status ∈ {'live','scheduled'}`，并且 `work.deletedAt IS NULL`。能玩的作品必须满足 `MpWork.status = 'live'` 且 `liveReleaseId` 不为空。
2. C 端响应里永不出现：`workId`、`workspaceOwnerId`、`createdById`、任何 storage key 原文、审核备注、B 端用户信息。对外的作品标识只有 `slug`（8 位 base62）。
3. 封禁（`banned`）或下架（`offline`）立即生效：清掉该作品相关的 Redis 缓存键（§E.6），`/play` 和详情都返回 404 `MP_WORK_NOT_FOUND`。
4. 埋点和云存档失败对观众**静默**，不弹错，不影响播放。
5. 本地存档优先：播放器只读写本地，云端只做后台合并同步（§F.7）。
6. 任何金额或真实货币逻辑都不在 B1–B5 出现。商店仍然只是游戏内货币（`currencyVariableId`），为空时就是免费模拟。

---

## §A 产品设计

### A.1 角色

| 角色 | 是谁 | 能做什么 |
|---|---|---|
| 观众 | 小程序用户（`ConsumerUser`） | 浏览、游玩、存档、收藏、评分、预约、订阅、分享、举报 |
| 创作者 | B 端账号中对该影游 `canManage` 的人 | 编辑上架信息、生成版本、上线/下架、定时上线、渠道码、看本作品数据 |
| 运营 | `super_admin`（只在 :8080 后台） | 审核通过/驳回、封禁/解封、推荐位、专题、运营渠道码、全站数据、处理举报 |

### A.2 生命周期

版本 `StoryRelease.status` 的流转：

```
building ──► build_failed
    └──► reviewing ──► rejected
              └──► approved ──► live ──► retired（被更新的版本替换）
```

- 如果上线设置为「定时上线」，且时间未到，版本停在 `approved`。时间一到，由 watchdog 推到 `live`。
- 同一作品同一时刻最多一个 `live` 版本，最多一个 `building` 或 `reviewing` 的版本。新提交会被拒绝，返回 409 `MP_RELEASE_IN_PROGRESS`。

上架条目 `MpWork.status` 的流转：

```
draft ──► scheduled ──► live ⇄ offline
任意状态 ──► banned（运营）；banned ──解封──► offline
```

- `draft`：已创建上架信息，但从未通过审核。
- `scheduled`：已有 `approved` 版本，且 `scheduledAt` 在未来。对外可见，可以预约，不能玩。
- `live`：有 `live` 版本，可玩。
- `offline`：创作者主动下架，对外不可见。重新上线时沿用当前 `liveReleaseId`。

### A.3 小程序信息架构

**tabBar**（3 个）

| tab | 页面 |
|---|---|
| 首页 | `pages/home/index` |
| 发现 | `pages/discover/index` |
| 我的 | `pages/me/index` |

**主包非 tab 页**

| 页面 | 用途 |
|---|---|
| `pages/work/index?w=<slug>` | 作品详情；同时是分享、扫码、朋友圈的落地页 |
| `pages/search/index` | 搜索 |
| `pages/ranking/index?k=hot\|rating\|new\|reserve` | 完整榜单 |
| `pages/topic/index?t=<topicSlug>` | 专题 |
| `pages/collection/index?w=<slug>` | 单部作品的结局图鉴和成就 |
| `pages/history/index` | 游玩记录 |
| `pages/favorites/index` | 我的收藏 |
| `pages/reservations/index` | 我的预约 |
| `pages/profile-edit/index` | 编辑资料 |
| `pages/settings/index` | 设置 |
| `pages/doc/index?k=terms\|privacy\|about` | 协议和说明（静态文本） |

**分包 `pkg-play`**

- `pkg-play/play-portrait/index?w=<slug>&from=<resume|new|slot:N|checkpoint:<key>>`：`pageOrientation: portrait`
- `pkg-play/play-landscape/index?…`：同样的参数，`pageOrientation: landscape`
- 两个页面都只渲染 `<story-player>` 组件。按 `release.aspectRatio` 选页面：`9:16` / `3:4` 进 portrait，`16:9` / `4:3` 进 landscape，其他进 portrait。

### A.4 视觉系统

用户已明确否定「暗房」单色风格，要的是**彩色、高级、一套统一体系**。

- **基调**是深靛色剧场：背景 `#0E0F1A`，表面 `#181A2B`，表面 2 `#22253A`，描边 `rgba(255,255,255,0.08)`。
- **文字**：主色 `#F5F6FF`，次色 `#A3A8C3`，弱化 `#6B7090`。
- **品牌色**是蓝猫蓝 `#4C7DFF`。强调渐变为 `linear-gradient(135deg,#7B5CFF 0%,#FF5CA8 100%)`，只用于主 CTA 和榜单前三。
- **作品主题色**：每部作品都有 `accentColor`，由版本生成时从竖版封面取主色（sharp `stats().dominant`），并把 HSL 亮度钳到 35%–55%。详情页顶部渐变 `linear-gradient(180deg, <accentColor> 0%, #0E0F1A 70%)`，让每部作品的详情页颜色都不同。
- **结局类型色**：good `#38D39F`、normal `#4C7DFF`、bad `#FF6B6B`、hidden `#FFB547`。
- **圆角与间距**：圆角 卡片 16 / 按钮 12 / 标签 8。页面左右边距 32rpx，栅格间距 24rpx。
- **字体**：系统字体。标题 40rpx/600，卡片标题 30rpx/600，正文 28rpx，辅助 24rpx。
- **比例**：卡片封面统一 3:4，Hero 4:5，分享卡 5:4。
- **动效**：卡片按下 `scale(0.97)` 120ms，页面切换用系统默认，Hero 自动轮播 5s，结局卡入场 `opacity + translateY(24rpx)` 320ms。
- **导航栏**：首页用 `navigationStyle: custom`，用 `wx.getMenuButtonBoundingClientRect()` 避让胶囊按钮。其他页面用默认导航栏，`navigationBarBackgroundColor: #0E0F1A`，`navigationBarTextStyle: white`。

### A.5 页面规格与文案

**首页 `pages/home/index`**（数据来自 `GET /api/mp/home`）

1. 顶栏：左侧字标「蓝猫剧场」，右侧搜索胶囊「搜索作品、题材」，点击进入 search。
2. Hero 轮播：数据是 `hero[]`，最多 5 张，4:5。卡片是封面，加底部 `accentColor→透明` 渐变，叠标题、一句话简介和按钮「立即游玩」。如果作品是 `scheduled`，按钮改为「预约上线提醒」。
3. 「继续游玩」横滑：只在有云存档或本地存档时出现，数据是 `continue[]`。卡片下方是进度条，文案「已解锁 {got}/{total} 个结局」，点击直接进播放页，`from=resume`。
4. 「编辑精选」：`picks[]`，2 列。
5. 「热玩榜」：前 5 名，行内显示排名、封面、标题和「{players} 人玩过」。右上角「完整榜单」进 ranking `k=hot`。
6. 「新作上线」：`newest[]`，横滑。
7. 「即将上线」：`upcoming[]`。卡片显示「{M月D日} 上线 · {reserveCount} 人已预约」，按钮「预约」或「已预约」。
8. 「专题」：`topics[]`，大图卡 16:9，显示标题和副标题。
9. 支持下拉刷新。空数据的区块整块不渲染。

`{players}` 的格式规则：小于 1 万显示原数，大于等于 1 万显示「{x.y} 万」。`reserveCount`、`playCount` 同样处理。

**发现 `pages/discover/index`**

- 顶部两个 tab：「榜单」「分类」。
- 榜单 tab：分段控件「热玩榜」「好评榜」「新作榜」「预约榜」，每榜前 50 名。
  - 第 1–3 名的排名数字用强调渐变。
  - 每行指标：热玩「{players} 人玩过」，好评「{score} 分 · {ratingCount} 人评分」，新作「{M月D日} 上线」，预约「{reserveCount} 人预约」。
- 分类 tab：横滑标签条，固定 12 个：悬疑、恋爱、奇幻、科幻、都市、古风、惊悚、喜剧、冒险、治愈、职场、校园。
  - 标签下面是排序「最热」「最新」「好评」，然后是 2 列卡片，无限滚动，每页 20 条。
  - 空状态文案「这个分类还没有作品」。

**搜索 `pages/search/index`**

- 输入框占位「搜索作品、题材」，最多 30 字，300ms 防抖。
- 空输入时显示「热门搜索」，取热玩榜前 8 名的作品标题。
- 无结果文案「没有找到相关作品，换个关键词试试」。

**作品详情 `pages/work/index?w=<slug>`**（数据来自 `GET /api/mp/works/:slug`）

1. **沉浸头部**：
   - 有预告片时，静音循环自动播放；`settings.autoplayOnCellular = false` 且当前不是 wifi 时只显示封面。
   - 没有预告片时显示封面。
   - 右下角是静音切换按钮。
   - 头部背景是作品主题色渐变。
2. 标题，下方写「出品 · {creatorName}」。
3. 标签 chips，最多 3 个，加一个徽标「AI 生成内容」（灰底，**必须显示**，属于合规要求）。
4. 数据行：「{players} 人玩过 · {chapterCount} 章 · 约 {minutes} 分钟 · {endingCount} 个结局」。
   - `minutes = ceil(totalDurationSec/60)`。
   - 评分行：`ratingCount ≥ 10` 时显示「{score} 分」，否则显示「评分人数不足」。
5. **简介**：默认折叠 3 行，可点「展开」或「收起」。
6. **结局图鉴**，标题「结局图鉴 {got}/{total}」。
   - 4 列网格，每格是结局类型色边框加结局名。
   - 未达成的显示「???」。
   - 未达成的隐藏结局显示锁图标加「隐藏结局」。
   - 点「查看全部」进 collection。
7. **章节**：「第 {n} 章 · {title}」，右侧显示「{mm}:{ss}」。只展示，不能点击跳章。
8. **成就**：「成就 {got}/{total}」，横滑展示图标。达成为彩色，未达成为灰色。
9. **底部固定栏**：「收藏」或「已收藏」、「分享」（`button open-type="share"`）、主按钮。主按钮：
   - 无存档时「开始游玩」，有自动存档时「继续游玩」。
   - `scheduled` 状态未预约时「预约上线提醒」，已预约时「已预约 · {M月D日} 上线」。
   - 有自动存档时，主按钮左侧多一个次按钮「重新开始」，点击弹确认框「重新开始会覆盖自动存档，手动存档保留。」，按钮「重新开始」「取消」。
10. 右上角菜单「…」里有「举报」，见 §H.10。
11. 从播放页返回时，如果本次达成了结局，并且观众从未给这部作品评过分，就弹一次评分半屏：标题「给《{title}》打个分」，5 颗星，按钮「提交」，右上角「跳过」。每部作品最多弹 1 次（本地键 `mp.rated.prompted:<slug>`）。
12. **朋友圈单页模式**（`wx.getLaunchOptionsSync().scene === 1154`）：只渲染 1–7 项（这时没有登录态，不调用任何需要 token 的接口），底部显示系统提供的「前往小程序」。

**我的 `pages/me/index`**

- 头部：头像（8 款内置蓝猫头像之一）、昵称（默认「观众{openid 前 6 位的 base62 化}」，由服务端生成），右侧「编辑资料」。
- 数据行：「玩过 {n} 部 · 结局 {n} · 成就 {n}」。
- 列表：「游玩记录」「我的收藏」「我的预约」「设置」。
- 设置页：
  - 「播放画质」：自动、流畅 480P、高清 720P。
  - 「非 Wi-Fi 下自动播放预告」：开关，默认关。
  - 「清除缓存」：只清 program 缓存，不清存档。确认文案「只清除作品缓存，不会删除你的存档。」
  - 「用户协议」「隐私政策」「关于蓝猫剧场」。

**编辑资料 `pages/profile-edit/index`**

- 8 个内置头像，4×2 网格，选中有描边。
- `<input type="nickname" placeholder="输入昵称">`，2–16 字。
- 按钮「保存」。
- 服务端审核不通过时 toast「昵称包含不合适的内容，请修改」。
- 不做自定义头像上传，这样就不存在 UGC 图片，也就不需要图片审核。

**通用状态文案**

| 场景 | 文案 |
|---|---|
| 网络错误 | 「网络开小差了，点击重试」 |
| 作品不存在或已下架 | 「作品已下架或不存在」，按钮「去首页看看」 |
| 游玩记录空 | 「还没有玩过的作品，去首页看看吧」 |
| 收藏空 | 「还没有收藏的作品」 |
| 预约空 | 「还没有预约的作品」 |

### A.6 宣发机制总览（细节见 §H）

| # | 机制 | 作用 | 谁来用 |
|---|---|---|---|
| 1 | 定时上线 + 预约 | 上线前蓄水，「{n} 人已预约」做社交证明 | 创作者 |
| 2 | 订阅消息：上线提醒 / 更新提醒 | 上线或出新章当天召回 | 系统自动 |
| 3 | 会话分享卡 | 动态标题加 5:4 分享封面，结局后分享带结局名 | 观众 |
| 4 | 朋友圈分享 | 单页模式落地 | 观众 |
| 5 | 结局海报 | Canvas 生成，带小程序码，`wx.showShareImageMenu` 一键发送或保存 | 观众 |
| 6 | 渠道码 | 小程序码、页面路径、URL Link，用于公众号、视频号、社群、线下物料、外部投放 | 创作者 / 运营 |
| 7 | 归因 | 首触归因（拉新）加每次游玩归因（召回） | 系统 |
| 8 | 推荐位、专题、活动 | 运营编排首页 Hero、精选、专题页 | 运营 |
| 9 | 榜单 | 热玩、好评、新作、预约 | 系统 |
| 10 | 社交证明 | 「{pct}% 的玩家和你一样」「仅 {pct}% 的玩家达成」 | 系统 |
| 11 | 自动预告片 | 版本生成时从开场片段剪 15 秒预告，用于详情页头部 | 系统 / 创作者可关 |
| 12 | 创作者数据 | 漏斗、结局分布、选择分歧、流失点、渠道表现 | 创作者 |

---

## §B 数据模型

### B.1 约定

- 追加到 `prisma/schema.prisma` 末尾，沿用现有风格：`@id @default(uuid())`，枚举用 `String @db.VarChar(16)`，`@@map` 用蛇形复数。
- 上线方式和现有部署一致：`npx prisma db push --skip-generate`。全部是新表，`Work` 只加反向关系字段，不产生任何破坏性变更。
- 高频表（`MpEvent`、各种统计表）**不建外键关系**，只存 id 字符串，避免写放大。
- `Work` 模型（`:422`）在 `interactiveStory InteractiveStory?` 下面加两行：

```prisma
  mpWork           MpWork?
  storyReleases    StoryRelease[]
```

### B.2 Prisma 模型（照抄）

```prisma
// ───────────── 小程序内容平台 ─────────────

// 影游发布版本：生成成功后不可变（program / manifest / 派生文件永不修改）
model StoryRelease {
  id               String    @id @default(uuid())
  workId           String
  version          Int
  // building | build_failed | reviewing | rejected | approved | live | retired
  status           String    @default("building") @db.VarChar(16)
  taskId           String?   @db.VarChar(191)
  progress         Int       @default(0)
  pipelineVersion  Int       @default(1)
  program          Json?
  manifest         Json?
  meta             Json?
  issues           Json?
  failure          String?   @db.VarChar(500)
  programKey       String?   @db.VarChar(255)
  programHash      String?   @db.VarChar(64)
  aspectRatio      String    @default("9:16") @db.VarChar(16)
  chapterCount     Int       @default(0)
  endingCount      Int       @default(0)
  totalDurationSec Int       @default(0)
  sizeBytes        BigInt    @default(0)
  note             String?   @db.VarChar(200)
  createdById      String
  reviewNote       String?   @db.VarChar(200)
  reviewedById     String?   @db.VarChar(191)
  reviewedAt       DateTime?
  liveAt           DateTime?
  retiredAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @default(now()) @updatedAt

  work Work @relation(fields: [workId], references: [id], onDelete: Cascade)

  @@unique([workId, version])
  @@index([status, createdAt])
  @@map("story_releases")
}

// 上架条目：创作者编辑的上架信息草稿 + 状态 + 计数（对外展示一律读版本 meta，见 B.3）
model MpWork {
  id               String    @id @default(uuid())
  workId           String    @unique
  slug             String    @unique @db.VarChar(16)
  // draft | scheduled | live | offline | banned
  status           String    @default("draft") @db.VarChar(16)
  title            String    @db.VarChar(40)
  tagline          String    @default("") @db.VarChar(60)
  synopsis         String    @db.Text
  tags             Json
  creatorName      String    @default("") @db.VarChar(24)
  coverKey         String?   @db.VarChar(255)
  shareCoverKey    String?   @db.VarChar(255)
  trailerEnabled   Boolean   @default(true)
  reservable       Boolean   @default(true)
  scheduledAt      DateTime?
  liveReleaseId    String?   @unique @db.VarChar(191)
  pendingReleaseId String?   @db.VarChar(191)
  firstLiveAt      DateTime?
  bannedReason     String?   @db.VarChar(200)
  playerCount      Int       @default(0)
  players7d        Int       @default(0)
  hotScore         Float     @default(0)
  favoriteCount    Int       @default(0)
  reserveCount     Int       @default(0)
  ratingCount      Int       @default(0)
  ratingSum        Int       @default(0)
  ratingScore      Float     @default(0)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @default(now()) @updatedAt

  work Work @relation(fields: [workId], references: [id], onDelete: Cascade)

  @@index([status, hotScore])
  @@index([status, firstLiveAt])
  @@index([status, ratingScore])
  @@index([status, reserveCount])
  @@map("mp_works")
}

model ConsumerUser {
  id             String   @id @default(uuid())
  openid         String   @unique @db.VarChar(64)
  unionid        String?  @unique @db.VarChar(64)
  nickname       String   @db.VarChar(32)
  avatarIndex    Int      @default(0)
  // active | banned
  status         String   @default("active") @db.VarChar(16)
  tokenVersion   Int      @default(0)
  firstSource    String?  @db.VarChar(24)
  firstChannelId String?  @db.VarChar(191)
  firstShareId   String?  @db.VarChar(16)
  firstMpWorkId  String?  @db.VarChar(191)
  createdAt      DateTime @default(now())
  lastSeenAt     DateTime @default(now())

  @@index([createdAt])
  @@index([firstChannelId])
  @@map("consumer_users")
}

// 一人一作品一行：云存档 + 游玩记录（行数 = 该作品累计玩家数）
model ConsumerSave {
  id           String   @id @default(uuid())
  consumerId   String   @db.VarChar(191)
  mpWorkId     String   @db.VarChar(191)
  releaseId    String   @db.VarChar(191)
  profile      Json
  saves        Json
  permanent    Json
  rev          Int      @default(0)
  progress     Float    @default(0)
  endingsGot   Int      @default(0)
  lastPlayedAt DateTime @default(now())
  createdAt    DateTime @default(now())
  updatedAt    DateTime @default(now()) @updatedAt

  @@unique([consumerId, mpWorkId])
  @@index([consumerId, lastPlayedAt])
  @@index([mpWorkId])
  @@map("consumer_saves")
}

model ConsumerFavorite {
  id         String   @id @default(uuid())
  consumerId String   @db.VarChar(191)
  mpWorkId   String   @db.VarChar(191)
  createdAt  DateTime @default(now())

  @@unique([consumerId, mpWorkId])
  @@index([consumerId, createdAt])
  @@map("consumer_favorites")
}

model ConsumerRating {
  id         String   @id @default(uuid())
  consumerId String   @db.VarChar(191)
  mpWorkId   String   @db.VarChar(191)
  score      Int
  createdAt  DateTime @default(now())
  updatedAt  DateTime @default(now()) @updatedAt

  @@unique([consumerId, mpWorkId])
  @@index([mpWorkId])
  @@map("consumer_ratings")
}

model MpReservation {
  id         String   @id @default(uuid())
  consumerId String   @db.VarChar(191)
  mpWorkId   String   @db.VarChar(191)
  createdAt  DateTime @default(now())

  @@unique([consumerId, mpWorkId])
  @@index([mpWorkId])
  @@map("mp_reservations")
}

// 订阅消息额度：每次用户在 requestSubscribeMessage 里点「允许」= credits + 1，发一条 = credits - 1
model MpSubscription {
  id         String   @id @default(uuid())
  consumerId String   @db.VarChar(191)
  mpWorkId   String   @db.VarChar(191)
  // work_live | chapter_update
  kind       String   @db.VarChar(16)
  credits    Int      @default(0)
  lastSentRef String? @db.VarChar(191)
  updatedAt  DateTime @default(now()) @updatedAt

  @@unique([consumerId, mpWorkId, kind])
  @@index([mpWorkId, kind])
  @@map("mp_subscriptions")
}

model MpShare {
  id           String   @id @db.VarChar(16)
  consumerId   String   @db.VarChar(191)
  mpWorkId     String   @db.VarChar(191)
  // work | ending | timeline | poster
  kind         String   @db.VarChar(16)
  endingNodeId String?  @db.VarChar(64)
  channelId    String?  @db.VarChar(191)
  opens        Int      @default(0)
  newUsers     Int      @default(0)
  createdAt    DateTime @default(now())

  @@index([mpWorkId, createdAt])
  @@index([consumerId])
  @@map("mp_shares")
}

model MpChannel {
  id               String    @id @default(uuid())
  code             String    @unique @db.VarChar(8)
  name             String    @db.VarChar(40)
  // creator | ops
  kind             String    @db.VarChar(16)
  mpWorkId         String?   @db.VarChar(191)
  topicId          String?   @db.VarChar(191)
  createdByUserId  String    @db.VarChar(191)
  wxacodeKey       String?   @db.VarChar(255)
  urlLink          String?   @db.VarChar(255)
  urlLinkExpiresAt DateTime?
  archived         Boolean   @default(false)
  createdAt        DateTime  @default(now())

  @@index([mpWorkId])
  @@map("mp_channels")
}

model MpEvent {
  id         BigInt   @id @default(autoincrement())
  name       String   @db.VarChar(32)
  consumerId String?  @db.VarChar(191)
  anonId     String   @db.VarChar(32)
  sessionId  String   @db.VarChar(32)
  mpWorkId   String?  @db.VarChar(191)
  releaseId  String?  @db.VarChar(191)
  nodeId     String?  @db.VarChar(64)
  optionId   String?  @db.VarChar(64)
  value      Int?
  flag       Boolean?
  source     String?  @db.VarChar(24)
  channelId  String?  @db.VarChar(191)
  shareId    String?  @db.VarChar(16)
  clientTs   DateTime
  createdAt  DateTime @default(now())

  @@index([createdAt])
  @@index([mpWorkId, name, createdAt])
  @@index([channelId, createdAt])
  @@map("mp_events")
}

model MpWorkDailyStat {
  id          String   @id @default(uuid())
  mpWorkId    String   @db.VarChar(191)
  date        DateTime @db.Date
  views       Int      @default(0)
  starts      Int      @default(0)
  players     Int      @default(0)
  completions Int      @default(0)
  shares      Int      @default(0)
  shareOpens  Int      @default(0)
  newUsers    Int      @default(0)
  watchSec    Int      @default(0)
  favorites   Int      @default(0)
  reserves    Int      @default(0)

  @@unique([mpWorkId, date])
  @@map("mp_work_daily_stats")
}

// 选择分歧 / 结局稀有度；optionId = '' 表示「到达该结局的玩家数（首次）」
model MpBranchStat {
  id       String @id @default(uuid())
  mpWorkId String @db.VarChar(191)
  nodeId   String @db.VarChar(64)
  optionId String @default("") @db.VarChar(64)
  count    Int    @default(0)

  @@unique([mpWorkId, nodeId, optionId])
  @@map("mp_branch_stats")
}

model MpFeatureSlot {
  id        String    @id @default(uuid())
  // home_hero | home_pick
  placement String    @db.VarChar(16)
  mpWorkId  String?   @db.VarChar(191)
  topicId   String?   @db.VarChar(191)
  title     String?   @db.VarChar(30)
  subtitle  String?   @db.VarChar(40)
  imageKey  String?   @db.VarChar(255)
  sort      Int       @default(0)
  startsAt  DateTime?
  endsAt    DateTime?
  enabled   Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @default(now()) @updatedAt

  @@index([placement, enabled, sort])
  @@map("mp_feature_slots")
}

model MpTopic {
  id          String    @id @default(uuid())
  slug        String    @unique @db.VarChar(16)
  title       String    @db.VarChar(30)
  subtitle    String    @default("") @db.VarChar(60)
  description String    @db.Text
  coverKey    String?   @db.VarChar(255)
  mpWorkIds   Json
  // draft | live | ended
  status      String    @default("draft") @db.VarChar(16)
  startsAt    DateTime?
  endsAt      DateTime?
  sort        Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @default(now()) @updatedAt

  @@index([status, sort])
  @@map("mp_topics")
}

model MpReport {
  id          String    @id @default(uuid())
  consumerId  String    @db.VarChar(191)
  mpWorkId    String    @db.VarChar(191)
  // vulgar | violence | politics | copyright | minor | other
  reason      String    @db.VarChar(16)
  detail      String    @default("") @db.VarChar(200)
  // open | resolved | dismissed
  status      String    @default("open") @db.VarChar(16)
  handledById String?   @db.VarChar(191)
  handledAt   DateTime?
  createdAt   DateTime  @default(now())

  @@index([status, createdAt])
  @@map("mp_reports")
}

// 定时任务的持久化水位（统计聚合的 lastEventId 等）。不放在 Redis，Redis 重启丢了会导致重复累加
model MpJobState {
  key       String   @id @db.VarChar(64)
  value     String   @db.VarChar(191)
  updatedAt DateTime @default(now()) @updatedAt

  @@map("mp_job_states")
}
```

### B.3 「上架信息」与「版本」的关系（关键决定）

- `MpWork` 上的 `title`、`tagline`、`synopsis`、`tags`、`creatorName`、`coverKey`、`shareCoverKey`、`trailerEnabled` 都是**草稿**。
- 生成版本时，这些字段被快照进 `StoryRelease.meta`，随版本一起审核。
- C 端展示**只读**版本的 meta：`live` 状态读 `liveReleaseId` 对应的版本，`scheduled` 状态读 `pendingReleaseId` 对应的版本。
- 所以改上架信息必须重新生成版本，B 端提示文案见 §C.5。这样未经审核的文字和图片永远到不了线上。

### B.4 JSON 形状（`src/lib/mp/release/types.ts`）

```ts
export const MP_PIPELINE_VERSION = 1

export interface ReleaseMediaFiles {
  v720?: string   // 视频 720P mp4 的 storage key
  v480?: string   // 视频 480P mp4
  poster?: string // 视频首帧 jpg
  last?: string   // 视频末帧 jpg（互动停在片尾时盖在画面上，防安卓黑屏）
  sheet?: string  // 4×4 联系表 jpg，只给审核用
  img?: string    // 图片：jpg，带透明通道时为 png
}

export interface ReleaseMediaEntry {
  id: string                // sha1(源 key 或源 URL) 前 16 位 hex
  kind: 'video' | 'image'
  source: string            // 源 storage key —— 仅服务端，绝不下发 C 端
  w: number
  h: number
  durationSec?: number
  hasAudio?: boolean
  bytes: number             // 派生文件字节数之和
  files: ReleaseMediaFiles
  refs: string[]            // program 内的 JSON Pointer，例如 /chapters/0/nodes/3/media/url
}

export interface ReleaseManifest {
  pipelineVersion: number
  media: Record<string, ReleaseMediaEntry>
}

export interface ReleaseMeta {
  title: string
  tagline: string
  synopsis: string
  tags: string[]
  creatorName: string
  accentColor: string       // #RRGGBB
  cover: string             // key：mp/releases/<rid>/cover.jpg（720×960）
  shareCover: string        // key：mp/releases/<rid>/share.jpg（1000×800）
  trailer: string | null    // key：mp/releases/<rid>/trailer.mp4
  trailerPoster: string | null
  chapters: { projectId: string; order: number; title: string; durationSec: number }[]
  endings: { projectId: string; nodeId: string; title: string; endingType: 'good' | 'normal' | 'bad' | 'hidden'; chapterOrder: number }[]
  achievements: { id: string; name: string; description: string; icon: string | null }[]
  segmentCount: number      // scene 节点总数（进度分母）
  texts: { where: string; text: string }[]  // 审核用，C 端不下发
}
```

### B.5 常量（`src/lib/mp/constants.ts`）

```ts
export const MP_TAGS = ['悬疑','恋爱','奇幻','科幻','都市','古风','惊悚','喜剧','冒险','治愈','职场','校园'] as const
export const MP_AVATAR_COUNT = 8
export const MP_SLUG_LENGTH = 8           // base62
export const MP_SHARE_ID_LENGTH = 10      // base62
export const MP_CHANNEL_CODE_LENGTH = 6   // 小写 base32（去掉 0/1/l/o）
export const MP_SAVE_MAX_BYTES = 256 * 1024
export const MP_EVENT_BATCH_MAX = 50
export const MP_EVENT_RETENTION_DAYS = 90
export const MP_BRANCH_MIN_SAMPLES = 30   // 选择分歧最少样本
export const MP_ENDING_MIN_SAMPLES = 50   // 结局稀有度最少样本
export const MP_RATING_MIN_COUNT = 10
export const MP_RATING_PRIOR_M = 20       // 贝叶斯平均先验权重
export const MP_JWT_TTL_DAYS = 30
```

---

## §C 发布流水线（B1）

### C.1 新文件

```
src/lib/mp/constants.ts
src/lib/mp/ids.ts                  // slug / shareId / channelCode 生成（crypto.randomBytes → base62/base32）
src/lib/mp/release/types.ts        // B.4
src/lib/mp/release/preflight.ts    // 平台级发布前检查（C.4）
src/lib/mp/release/media-refs.ts   // 收集与改写媒体引用（C.6）
src/lib/mp/release/texts.ts        // 收集审核文本
src/lib/mp/release/transcode.ts    // ffmpeg / ffprobe / sharp 封装（§G.2）
src/lib/mp/release/trailer.ts      // 自动预告片
src/lib/mp/release/build.ts        // handleStoryReleaseBuildTask（C.7）
src/lib/mp/release/lifecycle.ts    // approve / reject / goLive / offline / online / ban（§D.3）
src/lib/mp/listing.ts              // MpWork 草稿读写 + 校验
src/features/mp-publish/*          // 发布页 UI
src/app/[locale]/interactive/[workId]/publish/page.tsx
src/app/api/interactive/[workId]/publish/**   // §E.2
```

### C.2 任务类型接入（4 处，照改）

1. **`src/lib/task/types.ts:91`**：在 `EXPORT_DELIVERY: 'export_delivery',` 后面加一行 `STORY_RELEASE_BUILD: 'story_release_build',`。
2. **`src/lib/task/queues.ts:58`**：把 `TASK_TYPE.STORY_RELEASE_BUILD` 加进 `SINGLE_ATTEMPT_TASK_TYPES`。不要加进 IMAGE/VIDEO/VOICE 集合，它默认就走 text 队列。
3. **`src/lib/task/submitter.ts:193`**：把条件改成下面这样，这个任务不扣积分：

   ```ts
   if (!deduped && params.type !== TASK_TYPE.EXPORT_DELIVERY && params.type !== TASK_TYPE.STORY_RELEASE_BUILD) {
   ```

4. **`src/lib/workers/text.worker.ts:728`**：在 `case TASK_TYPE.EXPORT_DELIVERY:` 这一组后面加：

   ```ts
   case TASK_TYPE.STORY_RELEASE_BUILD:
     return await handleStoryReleaseBuildTask(job)
   ```

   处理函数的入参、进度上报和心跳写法，**完全照抄** `handleExportDeliveryTask` 的模式（先读它的实现）。每处理完一个媒体都要上报一次进度，保证心跳间隔小于 30s，否则会被 watchdog 判成卡死。

任务的 payload 是 `{ releaseId: string }`，`targetType` 和 `targetId` 与 EXPORT_DELIVERY 的用法保持一致，指向 `workId`。

### C.3 抽出无 session 的加载函数（R1 允许的唯一改动）

当前 `getInteractiveStory(session, workId)`（`service.ts` 约 :291-341）在权限检查之后会读取 config、编译每章第一张画布，再返回 `{ story, chapters }`。

把「权限检查之后」的那部分原样抽成：

```ts
export async function loadStoryForRelease(workId: string): Promise<{
  story: { workId: string; name: string; aspectRatio: string; resolution: string; config: InteractiveStoryConfig & { sequence: unknown } }
  chapters: Array<{ projectId: string; name: string; canvasId: string | null; nodeCount: number; runningCount: number; updatedAt: string; graph: StoryChapterGraph }>
}>
```

- `getInteractiveStory` 改为：先做原来的访问检查，再调用 `loadStoryForRelease`，最后补回 `canManage`、`canCreateChapters`、`canManageMembers` 三个字段。
- 改完 `tests/unit/interactive/service*.test.ts` 必须全绿。
- 如果实际代码结构和这里描述的不一样（比如编译不在这个函数里），按 R15 停下来问。

worker 里拿到数据后，用 `buildStoryProgram(data)`（`src/features/interactive/story-overview-model.ts:52`）生成 `StoryProgram`。这个文件没有 `'use client'`，服务端可以直接 import。

### C.4 发布前检查（`preflight.ts`）

```ts
export interface PreflightResult {
  issues: StoryIssue[]   // 引擎 validateStory 的结果 + 平台检查，已 sortIssues
  errors: number
  warnings: number
}
export async function preflightRelease(workId: string): Promise<PreflightResult>
```

检查分两类。

**引擎检查**：`validateStory(program)`，见 `validate.ts:419`。它的 error 全部阻塞发布。

**平台检查**：用现有 `StoryIssue` 的形状产出。`level` 和 `message` 如下；如果 `StoryIssue` 必填 `code` 之类的字段，用 `mp_*` 前缀。

| 条件 | level | message |
|---|---|---|
| 上架信息缺作品名，或超过 20 字 | error | 「请填写作品名（20 字以内）」 |
| 一句话简介为空，或超过 30 字 | error | 「请填写一句话简介（30 字以内）」 |
| 详细介绍少于 10 字或超过 300 字 | error | 「详细介绍需要 10–300 字」 |
| 标签为 0 个，超过 3 个，或不在 `MP_TAGS` 里 | error | 「请选择 1–3 个题材标签」 |
| 出品署名为空，或超过 12 字 | error | 「请填写出品署名（12 字以内）」 |
| 结局节点数为 0 | error | 「至少需要一个结局」 |
| 任一章节 `runningCount > 0` | error | 「还有 {n} 个生成任务未完成，完成后再发布」 |
| 媒体总数超过 500 | error | 「素材超过 500 个，请拆分作品」 |
| 视频总时长超过 4 小时 | error | 「视频总时长超过 4 小时」 |
| 某个 scene 没有媒体 | warning | 「「{节点名}」没有画面，观众只会看到文字」 |
| 某个视频的 `durationSec` 缺失 | warning | 「「{节点名}」的视频时长未知，生成版本时会自动检测」 |
| 未上传竖版封面 | warning | 「未上传竖版封面，将使用开场画面」 |
| 本作品已有 `building` 或 `reviewing` 状态的版本 | error | 「已有一个版本在生成或审核中」 |

worker 在开始生成时会再跑一次 preflight。只要有任何 error，版本直接进 `build_failed`，`failure` 写「发布前检查未通过」，`issues` 写入完整列表。

### C.5 B 端发布页 UI（`/interactive/[workId]/publish`）

**入口**：`StoryOverview.tsx` 的 `nori-ix-ov-actions` 区（约 :108-122）里，在「全剧试玩」按钮**前面**加一个按钮：

```tsx
{story.canManage === true ? (
  <button type="button" className="fos-btn fos-btn-ghost" onClick={() => router.push(`/interactive/${encodeURIComponent(workId)}/publish`)}>
    <Send />发布到小程序
  </button>
) : null}
```

- `Send` 图标从 `lucide-react` 引入。
- 路由要用该文件或同目录已经在用的 locale 感知导航工具（grep `useRouter` 或 `Link`）。目录里没有的话，grep `createNavigation` 找 `src/i18n` 下的导出。
- 页面的服务端组件要校验 `canManage`。不满足时，按现有 interactive 页面的做法渲染 404。

**页面结构**：单列布局，`max-width: 960px`，6 个卡片区块，组件放在 `src/features/mp-publish/`。顶部复用 `StoryLayerNav`（`active="story"`），保持和影游其他页面同一套外框。

**页头**：标题「发布到小程序」，右侧是状态胶囊：

| MpWork.status | 胶囊文案 | 右侧操作 |
|---|---|---|
| 无 MpWork / draft | 「未上架」 | — |
| scheduled | 「待上线 · {M月D日 HH:mm}」 | — |
| live | 「已上线」 | 「下架」 |
| offline | 「已下架」 | 「重新上线」 |
| banned | 「已被平台下架」 | 无，另起一行「原因：{bannedReason}」 |

- 点「下架」弹确认框：「下架后观众将无法看到和游玩这部作品，已有存档会保留。」，按钮「下架」「取消」。
- 点「重新上线」直接执行，成功后 toast「已重新上线」。

**① 上架信息**

| 字段 | 控件 | 规则 | 占位 / 说明 |
|---|---|---|---|
| 作品名 | input | 1–20 字，默认取 `Work.name` 前 20 字 | 「观众在小程序里看到的名字」 |
| 一句话简介 | input | 1–30 字 | 「出现在卡片和分享里，一句话勾住观众」 |
| 详细介绍 | textarea | 10–300 字，带字数统计 | 「讲讲故事背景和玩法」 |
| 题材标签 | chips 多选 | 1–3 个 | 「最多选 3 个」 |
| 竖版封面 | 上传 | 3:4，jpg/png，最大 10MB | 「建议 1080×1440，不上传则使用开场画面」 |
| 分享封面 | 上传 | 5:4，jpg/png，最大 10MB | 「用于微信分享卡片，建议 1000×800，不上传则从竖版封面裁切」 |
| 出品署名 | input | 1–12 字 | 「例如：蓝猫工作室」 |
| 预告片 | 开关，默认开 | — | 「自动生成 15 秒预告片」 |

- 上传复用现有的 `POST /api/interactive/[workId]/assets`（multipart，返回 `{ success, key, url }`），只保存 `key`。
- 区块底部固定一行说明：「上架信息随版本一起审核，修改后需要重新生成版本才会在小程序里生效。」
- 按钮「保存」→ `PATCH …/publish/listing`，成功 toast「已保存，下次生成版本时生效」。

**② 发布前检查**

- 标题行「发布前检查」，右侧显示「{errors} 个错误 · {warnings} 个警告」和按钮「重新检查」。
- 列表按章节分组。如果 issue 带 `projectId`，行尾放「去修改」，链接为 `chapterHref(workId, projectId)`（`src/lib/interactive/routes.ts`）。
- 已有的 issue 渲染组件优先复用：grep `countIssues(` 找到 `src/features/interactive` 里的现成组件。
- 零问题时显示绿色「全部通过」。

**③ 版本**

- 主按钮「生成新版本」。preflight 有 error 时置灰，悬浮提示「先修复所有错误」。
- 点击后弹窗：
  - 标题「生成新版本」
  - textarea「版本说明（选填，审核人员可见）」，最多 200 字
  - 说明「生成需要几分钟，期间可以离开本页。」
  - 按钮「开始生成」「取消」
- 版本表格的列：「版本」(v{n})、「状态」、「生成时间」、「时长」({mm}:{ss})、「说明」。状态文案：

| status | 文案 | 附加信息 |
|---|---|---|
| building | 「生成中 {progress}%」 | — |
| build_failed | 「生成失败」 | 下一行灰字显示 `failure`，再加链接「查看问题」，点开展开 issues |
| reviewing | 「审核中」 | — |
| rejected | 「未通过」 | 下一行「驳回原因：{reviewNote}」 |
| approved | 「已通过 · 待上线」 | 有 `scheduledAt` 时追加「· {M月D日 HH:mm}」，操作列放「立即上线」 |
| live | 「线上版本」 | — |
| retired | 「历史版本」 | — |

- 只要存在 `building` 的版本，就每 3s 轮询 `GET …/publish`，没有就停止轮询。

**④ 上线设置**（只在 `MpWork.firstLiveAt == null` 时显示；已上线作品的新版本审核通过后立即替换线上版本）

- 单选「审核通过后立即上线」或「定时上线」。
- 选定时上线后出现日期时间选择器，范围是现在 +1 小时到现在 +60 天，按北京时间显示。
- 复选「开放预约（上线前观众可以预约，并在上线时收到提醒）」，默认勾选，对应 `MpWork.reservable`。
- 这些设置和上架信息共用同一个「保存」。

**⑤ 推广（B5）与 ⑥ 数据（B5）**：见 §H.4 和 §H.9。B1 阶段这两块显示占位文字「作品上线后可用」。

### C.6 媒体引用收集与改写（`media-refs.ts`）

```ts
export interface MediaRef { pointer: string; key: string; raw: string }
export function isMediaField(fieldName: string): boolean      // name === 'url' || name.endsWith('Url') || name === 'icon'
export function collectMediaRefs(program: StoryProgram): MediaRef[]
export function rewriteMediaRefs(program: StoryProgram, idByRaw: Map<string, string>): StoryProgram   // 返回深拷贝
export function assertNoRawMedia(program: StoryProgram): string[]   // 返回违规 pointer，空数组 = 通过
export function describePointer(program: StoryProgram, pointer: string): string  // 「第 2 章「雨夜」·「巷口」」
```

**判定规则**：深度遍历 program 的每个字符串叶子。满足以下两条的，就是一个媒体引用：

1. 字段名满足 `isMediaField`；
2. 值非空，并且符合下面任一情况：
   - `extractStorageKey(value)` 返回非空（`src/lib/storage/index.ts:71`）；
   - 值匹配 `^https?://`。

额外判断：

- `icon` 字段的值如果不含 `/`、`.`、`:`，视为 emoji，**不是**媒体。
- `raw` 是原始字符串，`key` 是解析出来的 storage key。绝对 URL 的 `key` 先留空，由 build 下载后再补上。

**改写规则**：把每个媒体字符串替换为 `mp:<mediaId>`。`posterUrl` 有值时，它自己就是一个 image 媒体。

**安全网**：改写之后，媒体字段的值只能是以下几种，出现任何其他值，版本就进 `build_failed`，`failure` 写「存在未处理的素材：{describePointer}」：

- `null`
- `''`
- 匹配 `^mp:[0-9a-f]{16}$` 的字符串
- emoji（只限 `icon` 字段）

**单测要求**：fixture 必须覆盖 types.ts 里所有的媒体字段：`StoryMedia.url/posterUrl`、`StoryChoiceOption.imageUrl`、各互动的 `buttonImageUrl/propImageUrl/frameImageUrl`、`StoryPersonalityResult.imageUrl`、`StoryReward.frameUrl`、`StorySavePoint.coverUrl`、`StoryAchievement.icon`（emoji 和 URL 两种），以及 choice 节点的背景字段（字段名以实际 types.ts 为准）。

### C.7 版本生成步骤（`build.ts` → `handleStoryReleaseBuildTask`）

```
 0. 读取 release（status 必须是 building，否则直接返回），读取 MpWork 草稿
 1. data = loadStoryForRelease(workId)；program = buildStoryProgram(data)
 2. preflight —— 有 error 就 build_failed
 3. refs = collectMediaRefs(program)，按 raw 去重；mediaId = sha1(key 或 raw).slice(0,16)
 4. 复用：在本作品所有历史版本的 manifest 里，找 source 相同且 pipelineVersion 相同的 entry
          → 直接复用 files / w / h / durationSec（不重新转码）
 5. 逐个处理未复用的媒体（串行，progress = 5 + 80 × i/n）：
      绝对 URL → fetch（120s 超时，最大 1GB）→ uploadObject 到 mp/releases/<rid>/src/<id>.<ext> → 得到 key
      视频 → transcode.processVideo(key)（§G.2）
      图片 → transcode.processImage(key)（§G.2）
      任何一步失败 → build_failed，failure =「素材处理失败：{describePointer(第一个 ref)}」
 6. 上架素材：
      竖版封面源 = MpWork.coverKey ?? 开场第一个视频的 poster ?? 第一张图片
      cover.jpg = sharp 720×960 fit cover position 'attention' jpeg q85
      share.jpg = (shareCoverKey ?? 封面源) → 1000×800 fit cover
      accentColor = sharp(cover).stats().dominant → 转 HSL，亮度钳到 [0.35,0.55] → #RRGGBB
      trailerEnabled → trailer.ts（C.8），失败只加 warning「预告片生成失败，已跳过」
 7. rewritten = rewriteMediaRefs(program, idByRaw)；assertNoRawMedia(rewritten) 必须为空
 8. meta：
      chapters  = 每章 scene 视频时长之和（取 manifest 里的 durationSec）
      endings   = 所有 kind === 'ending' 的节点
      segmentCount = scene 节点数
      texts     = texts.ts 收集
 9. body = JSON.stringify({ v: 1, releaseId, aspectRatio, program: rewritten })
    programHash = sha256(body)
    uploadObject(Buffer.from(body), `mp/releases/<rid>/program.json`, undefined, 'application/json')
10. 一次 update：status='reviewing', progress=100, program, manifest, meta, issues（只含 warning）,
    counts, sizeBytes, programKey, programHash
11. finally：删除本地临时目录 os.tmpdir()/mp-build/<rid>（只删本地 tmp，绝不碰 /data）
```

**错误文案规则**：`failure` 一律写给创作者看的中文，不放堆栈。堆栈只进服务端日志。

### C.8 自动预告片（`trailer.ts`）

1. 用引擎走一遍开场：`run = startRun(program, { mode: 'story' })`。`StoryRunMode` 的定义在 `engine.ts:49`；参数写法照 `InteractivePlayer.tsx:112` 的 `begin`。
2. 循环最多 12 次，每次：
   - 停在 `scene` 且有视频时，收集它的 720 文件；
   - 停在 `choice` 时，用第一个选项 `advanceRun(program, run, options[0].id)`；
   - 停在 `interaction`、`ending`、`exit` 或 `halt` 时结束；
   - 其他情况调用 `advanceRun(program, run)`。
   - 累计时长达到 15s 就停。
3. 用 ffmpeg concat filter 重编码，截到 15s，最后 1s 做淡出（`fade=t=out:st=14:d=1`、`afade=t=out:st=14:d=1`），参数同 720 档。
4. 输出 `trailer.mp4`，再取首帧作为 `trailer_poster.jpg`。
5. 收集到的视频不足 3s 时不生成，`trailer` 置为 null。

---

## §D 审核与运营后台（B1 审核；B5 运营）

### D.1 导航

`src/components/admin/PlatformAdminShell.tsx` 要改两处：

1. `:10` 改成 `type AdminNavKey = 'accounts' | 'services' | 'mp-review' | 'mp-ops' | 'mp-stats'`。
2. `NAV`（:12）里追加三项：

```ts
{ key: 'mp-review', href: 'mp-review', label: '内容审核', caption: '小程序作品版本审核', icon: <现有可用图标> },
{ key: 'mp-ops',    href: 'mp-ops',    label: '内容运营', caption: '推荐位、专题、渠道、举报', icon: <现有可用图标> },
{ key: 'mp-stats',  href: 'mp-stats',  label: '小程序数据', caption: '用户、游玩与渠道', icon: <现有可用图标> },
```

补充要求：

- `icon` 从 `AppIconName` 里已有的名字中挑，不新增图标。
- `SIDEBAR_NOTES` 是 `Record<AdminNavKey, …>`，三个新 key 都要补一条说明，否则类型不过。
- 页面放在 `src/app/[locale]/admin/mp-review|mp-ops|mp-stats/`，鉴权完全照抄 `admin/services` 页面：`session.user.role !== 'super_admin'` 就拒绝。
- 接口一律放在 `/api/admin/mp/*`。因为后台入口的 API 白名单只放行 `/api/auth*` 和 `/api/admin*`（`src/lib/app-surface.ts:69`），放别处会被拦。每个接口都用 `requireSuperAdminAuth`（`src/lib/api-auth.ts:494`）。

### D.2 内容审核页

**列表 `/admin/mp-review`**

- 两个 tab：「待审核（{n}）」「已处理」。
- 每行字段：作品名、版本号、出品署名、提交人、提交时间、时长、素材数。
- 待审核的行按提交时间升序排列，先到先审。

**详情 `/admin/mp-review/[releaseId]`**

1. **头部**：「{title} · v{version}」，下面一行写「{creatorName} · 提交人 {用户名} · {提交时间}」，再下一行写「版本说明：{note}」（没有就不显示）。
2. **上架信息预览**：竖版封面、分享封面、作品名、一句话简介、详细介绍、标签、主题色色块、预告片播放器。
3. **文本**：`meta.texts` 列表，每行显示「位置 + 文本」，顶部有搜索框「搜索文本」。
4. **视频**：网格，每项是联系表（`sheet`）、时长、所在位置，点击用 480 档播放。
   - 播放地址由后台接口用 `getSignedObjectUrl` 生成 TOS 直链。
   - 这里也不走 `/api/storage/sign` 的代理。
5. **图片**：网格，每项是缩略图和所在位置。
6. **检查结果**：`issues` 中的 warning。
7. **审核要点**（固定文案，灰色）：「审核要点：政治敏感、色情低俗、暴力血腥、侵权（明星脸、知名 IP、未授权音乐）、未成年人不宜、诱导分享或诱导关注的文案。」
8. **底部吸附操作栏**：
   - 「通过」：确认框「通过后将按创作者的上线设置上线。」，按钮「通过」「取消」。
   - 「驳回」：弹窗，标题「驳回原因（创作者可见）」，textarea 5–200 字必填，按钮「驳回」「取消」。

### D.3 状态流转（`lifecycle.ts`，全部用 `prisma.$transaction`）

```ts
approveRelease(releaseId, adminId)
  校验 release.status === 'reviewing'
  release.status = 'approved'; reviewedById/At
  若 MpWork.firstLiveAt == null 且 scheduledAt > now：
      MpWork.pendingReleaseId = releaseId
      MpWork.status = reservable ? 'scheduled' : 'draft'
  否则 goLive(releaseId)

goLive(releaseId)  // 也被定时任务和「立即上线」调用
  旧 live 版本 → 'retired', retiredAt=now
  release.status = 'live', liveAt = now
  MpWork.liveReleaseId = releaseId; pendingReleaseId = null; status = 'live'
  firstLiveAt ??= now
  事务提交后：清缓存（E.6）；
    若这是首次上线 → enqueueNotify('work_live', mpWorkId, releaseId)
    若 release.chapterCount > 旧 live 的 chapterCount → enqueueNotify('chapter_update', mpWorkId, releaseId)

rejectRelease(releaseId, adminId, note)   // 'reviewing' → 'rejected'
offlineWork(mpWorkId)  // live → offline（创作者）
onlineWork(mpWorkId)   // offline → live，要求 liveReleaseId 不为空
banWork(mpWorkId, reason, adminId)   // 任意 → banned，bannedReason
unbanWork(mpWorkId)                  // banned → offline
```

非法的状态流转一律抛 `ApiError` 409，code 为 `MP_INVALID_STATE`，提示文案「当前状态不能执行此操作」。

### D.4 运营页 `/admin/mp-ops`（B5）

5 个 tab：

1. **推荐位**
   - 选 placement（「首页大图」= `home_hero`，「编辑精选」= `home_pick`）。
   - 列表可拖拽排序（只用上下箭头按钮，不引入拖拽库）。
   - 字段：作品（用 slug 或作品名搜索，只能选 live 或 scheduled 的作品）或专题，二选一；标题（可选，覆盖作品名）、副标题（可选）、图片（可选，不传就用作品封面）、开始和结束时间、启用开关。
   - `home_hero` 最多 5 个同时生效，`home_pick` 最多 8 个。超出时保存报错「同时生效的推荐位不能超过 {n} 个」。
2. **专题**
   - CRUD 字段：slug（自动生成）、标题、副标题、介绍、封面（16:9）、作品列表（有序，2–30 部）、状态、起止时间。
   - 状态为 live 且在时间窗口内的专题，才出现在首页「专题」区块。
3. **渠道码**：运营渠道（`kind='ops'`），可以指向首页（`mpWorkId=null`）、某部作品或某个专题。生成和展示的方式同 §H.4。
4. **作品管理**
   - 所有 MpWork 列表，可按状态筛选。
   - 每行显示作品名、状态、线上版本、玩家数、评分。
   - 操作：「封禁」（填原因，必填）或「解封」。
5. **举报**
   - open 状态的举报列表，显示作品、理由、描述、时间。
   - 操作「已处理」或「忽略」。
   - 同一作品被举报次数 ≥ 5 时，行首加红点。

管理员上传的图片走 `POST /api/admin/mp/uploads`：sharp 转成 jpg，存到 `mp/ops/<uuid>.jpg`，返回 `{ key }`。

### D.5 数据页 `/admin/mp-stats`（B5）

- 时间范围「近 7 天」「近 30 天」。
- KPI：新增用户、活跃用户（有任意事件的去重 consumer）、开始游玩、完成数、分享数、分享带来的新用户。
- 每日柱状图：用 SVG 自绘，不引入图表库。
- 「作品排行」表：玩家、完成率、分享、评分。
- 「来源分布」表：按 `ConsumerUser.firstSource` 分组统计新增用户。
- 「渠道表现」表：渠道名、新用户、游玩人数。

---

## §E 接口契约

### E.1 通用约定

- **路由写法**完全照抄 `src/app/api/interactive/[workId]/route.ts`：`apiHandler` 包裹、抛 `ApiError`（`src/lib/api-errors.ts:404`）、用 `NextResponse.json` 返回。错误体沿用 `apiHandler` 的现有格式；小程序的 `lib/api.ts` 先读 `api-errors.ts:448-577`，再按这个格式解析 `code`。
- **C 端鉴权**放在 `src/lib/mp/auth.ts`，导出三个函数：
  - `requireConsumerAuth(req)`：没有 token 或 token 无效时返回 401 `MP_UNAUTHORIZED`；用户被封禁时返回 403 `MP_USER_BANNED`。
  - `optionalConsumer(req)`：取不到用户就返回 `null`，不报错。
  - 实现方式：解析 Bearer → 验 JWT → 读用户，读用户的结果在 Redis 缓存 60s，键为 `mp:cu:<id>` → 校验 `status === 'active'`，并且 JWT 里的 `ver` 等于库里的 `tokenVersion`。
  - `lastSeenAt` 每小时最多更新一次，用 Redis 键 `mp:seen:<id>` 门控，`EX 3600 NX`。
- **JWT** 在 `src/lib/mp/token.ts` 自己实现 HS256，用 `crypto.createHmac`，签名比较用 `timingSafeEqual`，不加依赖。
  - payload 为 `{ sub, ver, aud: 'mp', iat, exp }`。
  - 有效期 30 天。
  - 剩余有效期不足 7 天时，响应头带 `X-Mp-Token: <新 token>`，客户端看到就替换本地 token。
- **限流**复用 `src/lib/rate-limit.ts:58-118` 的 Redis 滑动窗口（就是登录用的那个函数），键前缀 `mp:rl:`。超限返回 429 `MP_RATE_LIMITED`。
- **时间格式**：所有时间字段都是 ISO 字符串，展示统一用北京时间。
- **URL 字段**：一律由 `src/lib/storage/cdn.ts` 生成（§G.1），不允许出现 storage key 原文。

### E.2 B 端接口（session + `requireUserPermission(['canvasWrite'])` + `canManage`）

| 方法 | 路径 | 请求 | 响应 / 说明 |
|---|---|---|---|
| GET | `/api/interactive/[workId]/publish` | — | `{ listing: MpWorkDraft \| null, releases: ReleaseRow[], preflight: PreflightResult }`。`ReleaseRow` 为 `{ id, version, status, progress, failure, issues, note, reviewNote, totalDurationSec, createdAt, liveAt, scheduledAt? }` |
| PATCH | `/api/interactive/[workId]/publish/listing` | `{ title, tagline, synopsis, tags, creatorName, coverKey?, shareCoverKey?, trailerEnabled, scheduleMode: 'now'\|'at', scheduledAt?, reservable }` | 首次调用时创建 MpWork（生成 slug），返回 `{ listing }`。逐字段校验同 C.4，不通过返回 400 `MP_VALIDATION`，并带 `fields` |
| POST | `/api/interactive/[workId]/publish/releases` | `{ note? }`，需要 `Idempotency-Key` 头（`getIdempotencyKey`，`api-errors.ts:350`） | 先跑 preflight，有 error 返回 422 `MP_PREFLIGHT_FAILED`。已有 building 或 reviewing 版本返回 409 `MP_RELEASE_IN_PROGRESS`。成功时建 release（version = max+1）并 `submitTask`，返回 `{ releaseId, taskId }` |
| POST | `/api/interactive/[workId]/publish/releases/[releaseId]/go-live` | — | 只对 `approved` 状态有效，执行 `goLive` |
| POST | `/api/interactive/[workId]/publish/offline` | — | `offlineWork` |
| POST | `/api/interactive/[workId]/publish/online` | — | `onlineWork` |
| GET | `/api/interactive/[workId]/publish/stats?range=7d\|30d` | — | B5，§H.9 |
| GET/POST | `/api/interactive/[workId]/publish/channels` | POST 体 `{ name }` | B5，§H.4。每部作品最多 50 个未归档渠道 |
| POST | `/api/interactive/[workId]/publish/channels/[id]/archive` | — | B5 |

### E.3 C 端接口（`/api/mp/*`）

| 方法 | 路径 | 鉴权 | 请求 | 响应 |
|---|---|---|---|---|
| POST | `/api/mp/auth/login` | 匿名（限流 20/分钟/IP） | `{ code, launch: { scene, path, query } }` | `{ token, expiresAt, user: MpMe, isNew }` |
| GET | `/api/mp/me` | token | — | `MpMe` = `{ id, nickname, avatarIndex, stats: { played, endings, achievements } }` |
| PATCH | `/api/mp/me` | token（10 次/小时） | `{ nickname?, avatarIndex? }` | `MpMe`。昵称先过 msg_sec_check（§E.5），不通过返回 422 `MP_CONTENT_RISKY` |
| GET | `/api/mp/home` | 可选 | — | `{ hero: Slot[], picks: Slot[], continue: ContinueCard[], hot: Card[5], newest: Card[10], upcoming: Card[10], topics: TopicCard[] }`。`continue` 只在带 token 时返回 |
| GET | `/api/mp/works?sort=hot\|new\|rating&tag=&cursor=&limit=20` | 匿名 | — | `{ items: Card[], nextCursor: string \| null }`。只返回 live 作品，cursor 是不透明的 base64 |
| GET | `/api/mp/rankings/[kind]` | 匿名 | kind 为 `hot\|rating\|new\|reserve` | `{ items: Card[50] }` |
| GET | `/api/mp/search?q=` | 匿名（30 次/分钟/IP） | q 长度 1–30 | `{ items: Card[20] }`，对 title、tagline、tags 做 `LIKE`。q 里的 `%` 和 `_` 要转义 |
| GET | `/api/mp/topics/[slug]` | 匿名 | — | `{ topic: { slug, title, subtitle, description, cover }, items: Card[] }` |
| GET | `/api/mp/works/[slug]` | 可选 | — | `WorkDetail`（见下） |
| GET | `/api/mp/works/[slug]/play` | token | — | `PlayManifest`（见下）。只有 live 可玩，scheduled 返回 409 `MP_NOT_PLAYABLE`。首次调用 upsert 一行空的 `ConsumerSave`（profile、saves、permanent 用引擎的空值） |
| GET | `/api/mp/releases/[releaseId]/stats` | 匿名 | — | `{ choices: Record<nodeId, Record<optionId, pct>>, endings: Record<nodeId, pct> }`。样本不足的节点不返回，Redis 缓存 600s |
| GET | `/api/mp/saves/[slug]` | token | — | `{ rev, releaseId, profile, saves, permanent }`，没有存档时 `rev = 0` |
| PUT | `/api/mp/saves/[slug]` | token（30 次/分钟） | `{ baseRev, releaseId, profile, saves, permanent, progress, endingsGot }`，体积上限 256KB，超了返回 413 `MP_PAYLOAD_TOO_LARGE` | `{ rev, profile, saves, permanent, merged: boolean }`（§F.7） |
| PUT / DELETE | `/api/mp/works/[slug]/favorite` | token | — | `{ favorited }` |
| PUT | `/api/mp/works/[slug]/rating` | token | `{ score: 1..5 }` | `{ score }`。同时更新 MpWork 的 `ratingCount`、`ratingSum`、`ratingScore` |
| PUT / DELETE | `/api/mp/works/[slug]/reservation` | token | — | `{ reserved, reserveCount }`。只对 scheduled 作品有效 |
| POST | `/api/mp/subscriptions` | token | `{ slug, kind: 'work_live'\|'chapter_update', accepted: boolean }` | `{ credits }`。`accepted = true` 时 credits + 1，上限 20 |
| POST | `/api/mp/shares` | token（30 次/分钟） | `{ id, slug, kind: 'work'\|'ending'\|'timeline'\|'poster', endingNodeId? }`。`id` 是客户端生成的 10 位 base62 | `{ ok: true }`。幂等：id 已存在且属于本人时直接返回 ok，属于他人时返回 409（§H.2） |
| POST | `/api/mp/wxacode` | token（20 次/分钟） | `{ shareId }` | `{ url }`（§H.3） |
| POST | `/api/mp/track` | 可选（60 次/分钟/anonId） | `{ anonId, events: MpEventIn[] }`，最多 50 条 | 204（§H.8） |
| POST | `/api/mp/reports` | token（10 次/天） | `{ slug, reason, detail? }` | `{ ok: true }` |
| GET | `/api/mp/me/history?cursor=` | token | — | `{ items: ContinueCard[] }`，按 `lastPlayedAt` 降序 |
| GET | `/api/mp/me/favorites?cursor=` | token | — | `{ items: Card[] }` |
| GET | `/api/mp/me/reservations` | token | — | `{ items: Card[] }` |

**核心类型**（`src/lib/mp/dto.ts`，小程序侧在 `miniprogram/miniprogram/lib/types.ts` 手工保持一致）：

```ts
interface Card {
  slug: string; title: string; tagline: string; cover: string; accentColor: string
  tags: string[]; status: 'live' | 'scheduled'
  players: number; endingCount: number; ratingScore: number | null   // ratingCount < 10 时为 null
  scheduledAt?: string; reserveCount?: number
}
interface Slot { title: string; subtitle: string; image: string; target: { type: 'work' | 'topic'; slug: string }; card?: Card }
interface ContinueCard { card: Card; progress: number; endingsGot: number; lastPlayedAt: string }
interface TopicCard { slug: string; title: string; subtitle: string; cover: string }

interface WorkDetail {
  work: Card & {
    synopsis: string; creatorName: string; shareCover: string
    trailer: { url: string; poster: string } | null
    chapterCount: number; totalDurationSec: number; ratingCount: number
    aspectRatio: string; releaseId: string | null; version: number | null
  }
  chapters: { order: number; title: string; durationSec: number }[]
  endings: { nodeId: string; endingType: 'good' | 'normal' | 'bad' | 'hidden'; title: string | null }[]  // 未收集的 title 一律为 null
  achievements: { id: string; name: string; description: string; icon: string | null }[]              // icon：emoji 原样返回，图片换成 CDN URL
  viewer: null | {
    favorited: boolean; rating: number | null; reserved: boolean; hasSave: boolean
    endingsGot: string[]; achievementsGot: string[]; progress: number
  }
}

interface PlayManifest {
  releaseId: string; version: number; aspectRatio: string
  programUrl: string; programHash: string
  media: Record<string, {
    kind: 'video' | 'image'; w: number; h: number; dur?: number
    v720?: string; v480?: string; poster?: string; last?: string; img?: string
  }>
  expiresAt: string   // URL 签名的到期时间；客户端在到期前 10 分钟重新拉取
  stats: string       // /api/mp/releases/<id>/stats 的绝对路径
}
```

**`endingsGot` 的键格式**和 `StoryProfile.endings` 里存的格式**完全一致**。先读 `src/lib/interactive/achievements.ts` 和 `src/features/interactive/player/records.ts`，确认 profile 是怎么给结局编键的，服务端照同样的方式比对。

### E.4 后台接口（`/api/admin/mp/*`，全部 `requireSuperAdminAuth`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/mp/releases?status=reviewing\|done&cursor=` | 审核列表 |
| GET | `/api/admin/mp/releases/[id]` | 详情：meta（含 texts）、manifest（媒体换成 TOS 直链）、issues |
| POST | `/api/admin/mp/releases/[id]/approve` | `approveRelease` |
| POST | `/api/admin/mp/releases/[id]/reject` | `{ note }`，5–200 字 |
| GET | `/api/admin/mp/works?status=&q=` | 作品管理 |
| POST | `/api/admin/mp/works/[id]/ban` | `{ reason }`，2–200 字 |
| POST | `/api/admin/mp/works/[id]/unban` | — |
| GET / POST / PATCH / DELETE | `/api/admin/mp/slots[/id]` | 推荐位 |
| GET / POST / PATCH / DELETE | `/api/admin/mp/topics[/id]` | 专题 |
| GET / POST | `/api/admin/mp/channels` | 运营渠道码 |
| POST | `/api/admin/mp/channels/[id]/archive` | — |
| GET / PATCH | `/api/admin/mp/reports[/id]` | `{ status: 'resolved'\|'dismissed' }` |
| GET | `/api/admin/mp/stats?range=7d\|30d` | §D.5 |
| POST | `/api/admin/mp/uploads` | multipart，返回 `{ key }` |

后台的推荐位和专题不需要审核，运营自己负责内容。删除只针对推荐位和专题这两类**数据库行**，不删任何存储文件。

### E.5 微信服务端调用（`src/lib/mp/wx.ts`）

| 函数 | 微信接口 | 说明 |
|---|---|---|
| `code2Session(code)` | `GET https://api.weixin.qq.com/sns/jscode2session?appid&secret&js_code&grant_type=authorization_code` | 超时 5s。`errcode` 为 40029 或 40163 时返回 400 `MP_VALIDATION`「登录凭证无效，请重试」；其他错误返回 502 `MP_WX_UNAVAILABLE`。**不保存** session_key |
| `getAccessToken(force=false)` | `POST https://api.weixin.qq.com/cgi-bin/stable_token`，body 为 `{ grant_type: 'client_credential', appid, secret, force_refresh }` | 缓存在 Redis `mp:wx:token`，TTL = `expires_in - 300`。刷新时用 `SET mp:wx:token:lock NX EX 10` 防止击穿 |
| `msgSecCheck(openid, content)` | `POST /wxa/msg_sec_check?access_token=`，body 为 `{ content, version: 2, scene: 1, openid }` | 只有 `result.suggest === 'pass'` 才放行 |
| `getUnlimitedWxacode(scene, page)` | `POST /wxa/getwxacodeunlimit?access_token=`，body 为 `{ scene, page, check_path: false, env_version: MP_ENV_VERSION, width: 430, is_hyaline: false }` | 返回 PNG Buffer。如果响应 content-type 是 json，说明出错了 |
| `generateUrlLink(path, query)` | `POST /wxa/generate_urllink?access_token=`，body 为 `{ path, query, expire_type: 1, expire_interval: 30, env_version }` | 只在 `MP_URL_LINK_ENABLED=1` 时调用 |
| `sendSubscribe(openid, templateId, page, data)` | `POST /cgi-bin/message/subscribe/send?access_token=`，body 为 `{ touser, template_id, page, data, miniprogram_state: MP_ENV_VERSION === 'release' ? 'formal' : 'trial' }` | `errcode` 43101（用户拒收）视为消耗了额度 |

通用规则：

- 任何接口返回 `errcode` 40001 或 42001 时，用 `getAccessToken(true)` 刷新，然后**只重试一次**。
- 所有请求用全局 `fetch`，配 `AbortSignal.timeout(8000)`。

### E.6 缓存（Redis）

- **版本号**：所有目录类缓存键都带同一个版本号 `mp:cache:ver`。失效时只需 `INCR mp:cache:ver`，不用 `SCAN`。
- **触发失效的操作**：`goLive`、`offlineWork`、`onlineWork`、`banWork`、`unbanWork`，推荐位或专题的任何写操作，以及统计聚合结束后（§H.8）。

| 键 | TTL |
|---|---|
| `mp:cache:<ver>:home`（不含 `continue`，`continue` 每次实时查） | 60s |
| `mp:cache:<ver>:list:<sort>:<tag>:<cursor>` | 60s |
| `mp:cache:<ver>:rank:<kind>` | 300s |
| `mp:cache:<ver>:work:<slug>`（不含 `viewer`） | 300s |
| `mp:cache:<ver>:topic:<slug>` | 300s |
| `mp:cache:stats:<mpWorkId>` | 600s |
| `mp:slug:<slug>` → mpWorkId | 600s |

缓存里**不存**签过名的 URL。签名在读出缓存之后、写响应之前现做。签名按 6 小时分桶（§G.1），所以同一个桶内生成的 URL 相同，CDN 能命中缓存。

### E.7 权限矩阵

| 能力 | 匿名 | 观众 | 创作者（canManage） | 同工作区其他成员 | super_admin |
|---|---|---|---|---|---|
| 浏览目录 / 详情 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 游玩、存档、收藏、评分、预约、分享、举报 | — | ✓ | ✓（需要先在小程序登录） | ✓（同左） | ✓（同左） |
| 编辑上架信息、生成版本、上线 / 下架、渠道码、看本作品数据 | — | — | ✓ | — | — |
| 审核、封禁、推荐位、专题、运营渠道、举报处理、全站数据 | — | — | — | — | ✓（只在 :8080 后台） |

---

## §F 小程序客户端（B3 工程 + 页面；B4 播放器）

### F.1 技术选型（已定，不要换）

- **框架**：原生小程序 + TypeScript，WebView 渲染（不用 Skyline）。原因：
  - `<video>` 的同层渲染和各项能力最稳定；
  - 引擎是纯 TS，可以直接复用；
  - 不引入 Taro 或 uni-app 的运行时开销。
- **TS 编译**：`project.config.json` 里设 `setting.useCompilerPlugins: ["typescript"]`。类型检查用 `npx tsc -p miniprogram/tsconfig.json --noEmit`。
- **基础库**：最低 3.0.0（`app.json` 不写，在小程序后台「设置 → 基本设置 → 基础库最低版本」由用户设置，见 §M）。

### F.2 工程结构

```
miniprogram/
  package.json            devDependencies：typescript、miniprogram-api-typings、miniprogram-ci、esbuild（R11）
  tsconfig.json           strict；lib ["ES2020","DOM"]；types ["miniprogram-api-typings"]；
                          baseUrl "."；paths { "@/*": ["../src/*"] }；
                          include ["miniprogram/**/*.ts"]
  project.config.json     appid 写 "touristappid"，CI 脚本运行时从 env MP_APP_ID 注入；miniprogramRoot "miniprogram/"
  .gitignore              node_modules/、miniprogram/runtime/story-runtime.js、project.private.config.json、dist-preview/
  scripts/
    build-runtime.mjs     esbuild 打包运行时（见下）
    preview.mjs           miniprogram-ci preview → dist-preview/preview-<时间>.png（二维码）
    upload.mjs            miniprogram-ci upload（体验版，版本号取 package.json version）
  miniprogram/
    app.ts  app.json  app.wxss
    config.ts             BRAND_NAME、API_BASE（按 envVersion）、CDN 无关
    runtime/
      story-runtime.js    生成物（不提交）
      story-runtime.d.ts  提交：export * from '../../../src/lib/mp/runtime-entry'
    lib/                  api auth storage track attribution share format settings save-sync program-cache network privacy types
    styles/tokens.wxss    A.4 的全部色值、圆角、字号 → CSS 变量
    components/           nav-bar work-card rank-row section-header ending-grid achievement-row rating-sheet
                          privacy-popup empty-state report-sheet
    pages/                A.3 主包页面
    assets/               avatars/a0.png…a7.png（每张 ≤15KB）、logo.png、tab/*.png（81×81）
    pkg-play/
      play-portrait/  play-landscape/
      components/         story-player video-stage scene-text choice-panel interaction-layer
                          ix-tap ix-swipe ix-timing ix-hold ix-hotspot hud shop-sheet saves-sheet
                          map-sheet achievement-sheet ending-card toast-layer continue-prompt poster-maker
      lib/                player-controller clock preload rates hotspot-geo poster
```

**根仓库的配置隔离**（B1 第一步就做）：

- `tsconfig.json` 的 `exclude` 加 `"miniprogram"`。
- `eslint.config.mjs`（:15-30）的 ignores 加 `"miniprogram/**"`。
- `.dockerignore` 加 `/miniprogram`。

**运行时入口 `src/lib/mp/runtime-entry.ts`**：只做 re-export，不写逻辑。

```ts
export { startRun, advanceRun, resolveBeat, purchaseShopItem, isRunFinished, visibleOptions, permanentValues, isPermanentVariable } from '@/lib/interactive/engine'
export type { StoryRun, StoryStop, StoryRunMode, BeatOutcome } from '@/lib/interactive/engine'
export * from '@/lib/interactive/interaction'
export * from '@/lib/interactive/saves'
export * from '@/lib/interactive/achievements'
export * from '@/lib/interactive/achievement-text'
export * from '@/lib/interactive/personality'
export * from '@/lib/interactive/playback'
export * from '@/lib/interactive/hotspot'
export * from '@/lib/interactive/places'
export * from '@/lib/interactive/scene-text'
export * from '@/features/interactive/player/beat-scheduler'
export * from '@/features/interactive/player/interaction-sessions'
export * from '@/features/interactive/player/locked-choice'
export * from '@/features/interactive/player/records'
export * from '@/features/interactive/player/viewer-store'
export { PERMANENT_STORAGE_PREFIX, permanentStorageKey, readPermanentValues, writePermanentValues, clearPermanentValues } from '@/features/interactive/player/permanent-store'
export type { PermanentStorage } from '@/features/interactive/player/permanent-store'
export type * from '@/lib/interactive/types'
export * from '@/lib/mp/save-merge'
```

- **不导出**：`player-clock`（依赖 `performance`）、`playback-plan`（依赖 `HTMLVideoElement`）、`validate`、`compile`、`service`、`config`。
- 如果 `export *` 之间出现重名冲突，改成显式具名导出，**不改源文件**。

**`build-runtime.mjs`**：

```js
await esbuild.build({
  entryPoints: ['../src/lib/mp/runtime-entry.ts'], bundle: true, format: 'cjs', platform: 'neutral',
  target: 'es2017', tsconfig: '../tsconfig.json', outfile: 'miniprogram/runtime/story-runtime.js',
  mainFields: ['module', 'main'], legalComments: 'none', minify: true,
})
```

### F.3 基础库封装（`miniprogram/miniprogram/lib/`）

**`config.ts`**：

```ts
export const BRAND_NAME = '蓝猫剧场'
const env = wx.getAccountInfoSync().miniProgram.envVersion   // develop | trial | release
export const API_BASE = env === 'release' ? 'https://lanmiaoai.com' : 'https://nori.45-76-215-9.sslip.io'
```

**`api.ts`**：`request<T>(method, path, body?, { auth: 'required' | 'optional' | 'none' })`。

- 用 `wx.request`，超时 10s。
- 带 `Authorization: Bearer <token>`。
- 读到响应头 `X-Mp-Token` 就替换本地 token。
- 遇到 401 时，执行一次 `auth.relogin()` 再重试，**只重试一次**。
- 网络错误时抛 `{ code: 'NETWORK' }`，页面据此显示「网络开小差了，点击重试」。

**`auth.ts`**：

- `ensureLogin()` 全局只保留一个进行中的 Promise。
- 流程：本地 token 未过期就直接用；否则 `wx.login` → `POST /api/mp/auth/login`，带上 `launch`（`wx.getLaunchOptionsSync()` 的 `scene`、`path`、`query`）→ 把 token 和 user 存进本地。
- 朋友圈单页模式（scene 1154）**不登录**。

**`storage.ts`**：

- `wxStorage` 按 DOM `Storage` 的形状实现 `getItem`、`setItem`、`removeItem`，底层是 `wx.getStorageSync`、`wx.setStorageSync`、`wx.removeStorageSync`。`getItem` 读到空串时返回 `null`。
- 传给 `readStoredProfile`、`writeStoredSaves` 等函数时，`storageKey` 统一用 `mp:<slug>`。
- `PermanentStorage` 用同一个 adapter。

**`program-cache.ts`**：

- 用 `wx.getFileSystemManager()` 把 program 存成 `${wx.env.USER_DATA_PATH}/programs/<releaseId>.json`。
- 最多保留 5 份，超出时删掉 mtime 最旧的。只删这个目录下我们自己写的文件。
- 读取时校验 `programHash`（用 sha256 的 JS 实现，放在 `lib/sha256.ts`，几十行，不引依赖）。
- 下载用 `wx.request`（CDN 域名要配进 request 合法域名，见 §M），`responseType: 'text'`。

**`network.ts`**：

- `pickQuality()` 规则：设置为「流畅」时返回 480，设置为「高清」时返回 720。
- 设置为「自动」时：`wx.getNetworkType` 得到 wifi、5g、4g 返回 720，其他返回 480。

**`format.ts`**：

- 人数格式化，规则同 A.5。
- 时长格式化为 `mm:ss`。
- 日期格式化为「M月D日」或「M月D日 HH:mm」，按北京时间。

**`privacy.ts` + `components/privacy-popup`**：

- `app.json` 加 `"__usePrivacyCheck__": true`。
- 在 `app.ts` 里调用 `wx.onNeedPrivacyAuthorization(resolve => …)`，弹出隐私弹窗，内容如下：
  - 标题「隐私保护提示」
  - 正文「在使用前，请阅读《蓝猫剧场隐私保护指引》。我们仅在你设置昵称、保存或分享海报时使用相关信息。」
  - 《…》可点击，调用 `wx.openPrivacyContract()`
  - 按钮「拒绝」→ `resolve({ event: 'disagree' })`
  - 按钮「同意并继续」→ `<button open-type="agreePrivacyAuthorization" bindagreeprivacyauthorization>`

### F.4 页面实现要点

- **数据加载**：每个页面 `onLoad` 先显示骨架屏（灰色块，`#22253A`），再请求数据。失败时显示 empty-state 加重试按钮。
- **列表**：`onReachBottom` 加载下一页。`onPullDownRefresh` 重新拉第一页，完成后调用 `wx.stopPullDownRefresh()`。
- **详情页**：
  - `onLoad(options)` 先解析归因（§H.7），再请求 `GET /api/mp/works/:slug`。
  - 登录态下同时 `GET /api/mp/saves/:slug`，与本地存档合并（§F.7），再决定主按钮显示「开始游玩」还是「继续游玩」。
  - 预告片 `<video>` 的设置：`muted`、`loop`、`autoplay`、`controls=false`、`object-fit=cover`。页面 `onHide` 时调用 `pause()`。
- **进入播放页**：
  - 根据 `work.aspectRatio` 选择 `play-portrait` 或 `play-landscape`，用 `wx.navigateTo` 跳转。
  - 分包预下载：`app.json` 加 `"preloadRule": { "pages/work/index": { "network": "all", "packages": ["pkg-play"] } }`。
- **首页 Hero**：用 `swiper`，`autoplay`，`interval=5000`，`circular`，`indicator-dots`，`indicator-active-color=#FFFFFF`。
- **卡片封面**：`<image mode="aspectFill" lazy-load>`，背景先铺 `accentColor` 作为占位色。
- **setData 纪律**：
  - 不把整个 program 或 manifest 放进 data；
  - 单次 setData 的 payload 不超过 64KB；
  - 播放器内 setData 频率不超过 30 次/秒，只更新变化的字段路径（例如 `'timing.left'`）。

### F.5 播放器（B4，本方案最难的部分）

**分层原则**：

- `pkg-play/lib/player-controller.ts` 是一个**不依赖 `wx` 的纯 TS 类**，所有平台能力都通过依赖注入传进来，这样可以在 vitest 里完整测试。
- 组件层只负责采集手势、渲染画面、把视频事件转发给 controller。

```ts
export interface VideoPort {              // 由 video-stage 组件实现
  load(slot: 'a' | 'b', src: string, poster: string | null, initialSec: number): void
  play(slot: 'a' | 'b'): void
  pause(slot: 'a' | 'b'): void
  seek(slot: 'a' | 'b', sec: number): void
  setRate(slot: 'a' | 'b', rate: number): void
  show(slot: 'a' | 'b'): void             // 切换可见槽（不用 wx:if，用 opacity / z-index）
  setLastFrame(url: string | null): void  // 片尾冻结帧覆盖层
}
export interface PlayerViewPort { set(patch: Record<string, unknown>): void }   // 合并后每 33ms 最多 setData 一次
export interface PlayerDeps {
  program: StoryProgram; media: PlayManifest['media']; slug: string; releaseId: string
  storage: Storage; permanent: PermanentStorage
  video: VideoPort; view: PlayerViewPort
  clock: PausableClock; now: () => number            // now = Date.now，用于存档时间戳
  quality: () => '720' | '480'
  track: (e: MpEventIn) => void
  haptic: () => void                                  // wx.vibrateShort({ type: 'light' })
  branchStats: () => BranchStats | null
}
export class PlayerController {
  constructor(deps: PlayerDeps)
  start(from: 'new' | 'resume' | `slot:${number}` | `checkpoint:${string}`): void
  onTimeUpdate(slot: 'a' | 'b', currentSec: number, durationSec: number): void
  onEnded(slot: 'a' | 'b'): void
  onWaiting(slot: 'a' | 'b'): void
  onPlaying(slot: 'a' | 'b'): void
  onError(slot: 'a' | 'b'): void
  choose(optionId: string): void
  pointerDown(x: number, y: number): void
  pointerMove(x: number, y: number): void
  pointerUp(x: number, y: number): void
  setStageRect(w: number, h: number): void
  openSheet(kind: 'shop' | 'saves' | 'map' | 'achievements'): void
  closeSheet(): void
  buy(itemId: string): void
  saveSlot(index: number): void
  loadSlot(index: number): void
  jumpCheckpoint(key: string): void
  cycleSpeed(): void
  appHide(): void
  appShow(): void
  restart(): void
  dispose(): void
}
```

**行为移植（逐条对照 Web 版，不要自创规则）**

- 要对照的 Web 源文件：
  - `src/features/interactive/InteractivePlayer.tsx`
  - `PlayerStage`（grep `PlayerStage` 定位）
  - `player/InteractionOverlay.tsx`
  - `player/HotspotOverlay.tsx`
  - `player/InteractionCountdown.tsx`
  - `ChoicePanel`（grep 定位）
  - `ShopSheet`、`player/MapSheet.tsx`、`player/AchievementSheet.tsx`、`player/ContinuePrompt.tsx`、`player/AchievementToast.tsx`
- 所有判定都调用运行时里的纯函数：
  - 流程：`dueBeat`、`beatResult`、`applyBeatOutcome`、`beatEndAction`、`resolveBeat`、`advanceRun`
  - 手势判定：`judgeTap`、`judgeSwipe`、`judgeTiming`、`judgeHold`、`hotspotAt`
  - 交互会话：`registerTap`、`swipeStart`、`swipeMoveTo`、`holdStart`、`holdStop`、`holdRelease`、`timingFrameAt`、`judgeTimingFrame`
  - 存档与成就：`observeRun`、`observeCheckpoint`、`autoSaveFor`、`checkpointFor`、`enqueueToasts`
- controller 里**不允许**重写任何判定公式。
- 要先在 Web 源码里找到每个行为的触发点（grep `pausePlayerClock(`、`STORY_RETRY_REWIND_SEC`、`seekToLastFrame(`），在 controller 里按同样的时机实现。

**平台差异**（只有下面这些和 Web 不同）：

| 项 | Web | 小程序 |
|---|---|---|
| 时间源 | rAF 读 `video.currentTime` | `clock.ts`：`bindtimeupdate`（约 250ms 一次）给出锚点 `(t, wallMs)`，播放中估计值 = `t + (Date.now() - wallMs)/1000 × rate`，钳到 `[0, duration]`。50ms 一次 `setInterval` tick，tick 里跑 `dueBeat`。暂停、等待缓冲、seek 时停止外推 |
| 交互计时 | `playerNow`（`performance.now`，可暂停） | `PausableClock`：`now()`、`pause()`、`resume()`，基于 `Date.now()`，语义和 `player-clock.ts` 一致 |
| 慢放 | `STORY_SLOW_RATE = 0.25` | 小程序 `playbackRate` 只支持 0.5、0.8、1.0、1.25、1.5、2.0。`rates.ts` 里的 `toWxRate(r)`：r ≤ 0.5 取 0.5，其余取最接近的支持值。倍速档位（1、1.25、1.5）都是原生支持的 |
| 停在末帧 | `seekToLastFrame(video)` | `onEnded` 时调用 `video.setLastFrame(media.last)`，用末帧图盖住画面；下一段 `onPlaying` 之后 100ms 再移除。避免安卓在片尾黑屏 |
| 横竖屏 | `screen.orientation.lock` 加 CSS 旋转兜底 | 两个页面分别固定 `pageOrientation`，不做旋转，`unrotateHotspotPoint` 用不到 |
| 热区坐标 | DOM 坐标 | 用 `wx.createSelectorQuery()` 量出舞台的 rect（挂载时和 `wx.onWindowResize` 时各量一次）→ `mediaContainBox(stageW, stageH, media.w, media.h)` → 归一化 → `hotspotAt`。宽高直接取 manifest，不用再等视频元数据 |
| 震动 | `navigator.vibrate(15)` | `wx.vibrateShort({ type: 'light' })` |
| 常亮 | — | 播放页 `onShow` 时 `wx.setKeepScreenOn({ keepScreenOn: true })`，`onHide` 时设为 false |
| 切后台 | `visibilitychange` | `appHide`：暂停视频和时钟，立刻存档，flush 埋点。`appShow`：显示 continue-prompt，文案和 Web 的 ContinuePrompt 一致，用户点击后继续 |
| 退出 | 关闭弹层 | 自定义导航栏的返回键。运行未结束时弹 `wx.showModal`：内容「退出前会自动存档，确定退出吗？」，按钮「退出」「继续玩」。同时调用 `wx.enableAlertBeforeUnload({ message: '退出前会自动存档，确定退出吗？' })` 拦截系统返回手势 |

**`video-stage` 组件**

- 同一时刻只有两个 `<video>` 槽 a、b，**永不超过 2 个**。
- 属性：

  ```
  controls=false  show-center-play-btn=false  show-fullscreen-btn=false  show-play-btn=false
  show-progress=false  show-bottom-progress=false  enable-progress-gesture=false
  enable-play-gesture=false  vslide-gesture=false  show-casting-button=false
  object-fit=contain  autoplay=false
  ```

- 事件：`bindtimeupdate`、`bindended`、`bindwaiting`、`bindplay`、`binderror`、`bindloadedmetadata`，全部转发给 controller。
- 图片媒体用 `<image mode="aspectFit">` 叠在视频层之上，切换时 200ms 淡入淡出。
- 媒体加载失败（`binderror`）：
  1. 自动降到 480 档重试一次。
  2. 仍失败就显示「视频加载失败」和按钮「重试」「跳过这一段」。
  3. 「跳过这一段」等同于该 scene 自然播完。

**预加载（`preload.ts`）**

- **触发时机**：进入 choice 或 interaction 停靠点，或者 scene 播到剩余不足 3s 时。
- **计算候选**：引擎是纯函数，所以对每个可见选项都可以模拟一次 `advanceRun(program, run, optionId)`，拿到「下一个是有视频的 scene」的选项作为候选。
- **选目标**：有分歧统计时，选占比最高的选项；没有就选第一个可见选项。
- **预热**：把目标视频 `load` 进备用槽，静音 `play()`。收到第一次 `timeupdate` 后立刻 `pause()` 并 `seek(0)`，标记为 ready。
- **命中**：观众选的就是预热的那个，直接 `show(备用槽)` 加 `play()`，零等待。
- **未命中**：把正确的视频 load 进备用槽，期间显示 poster，收到 `onPlaying` 后再切换。
- **降档**：播放中 30s 内收到 3 次以上 `waiting`，后续片段改用 480 档（当前片段不切换）。

**图层顺序**（从下到上）：video-stage → scene-text（台词）→ interaction-layer → choice-panel → hud → sheets → ending-card → toast-layer → AIGC 角标。

- AIGC 角标固定在左下角，`24rpx`，白色，透明度 0.6，文案「AI 生成」，**全程显示**。
- HUD 内容：
  - 左上角是返回键；
  - 中间是 `showInHud` 的变量，带图标和数值；
  - 右上角在胶囊按钮下方，依次是倍速「1×」「1.25×」「1.5×」、「存档」（`savesEnabled` 时才显示）、「商店」（有 shop 时）、「成就」（有成就时）。

**结局卡 `ending-card`**

- 类型标签：good「圆满结局」，normal「普通结局」，bad「遗憾结局」，hidden「隐藏结局」，颜色见 A.4。
- 结局名，以及 `description`。
- 稀有度（B5）：样本数 ≥ 50 时显示「仅 {pct}% 的玩家达成」，`pct` 保留 1 位小数，小于 0.1 时显示「<0.1」；样本不足时显示「你是最早达成这个结局的玩家之一」。
- `showPersonality` 为 true 时，下方显示人格结果，逻辑与 `personalityView` 一致。
- 本局新解锁的成就，用 toast-layer 依次弹出。
- 按钮：
  - 「生成结局海报」（B5）
  - 「再玩一次」
  - 「回到存档点」，只在有手动存档或 checkpoint 时显示，点击打开 saves-sheet
  - 「返回详情」
- 进度条文案「已收集 {got}/{total} 个结局」。

**选择分歧提示**（B5）

- 观众做出选择，下一段开始播放后，在顶部居中显示胶囊「{pct}% 的玩家和你选择一样」，2.5s 后淡出。
- 只在该节点样本数 ≥ 30 时显示，**不阻塞播放**。

### F.6 埋点上报（`lib/track.ts`）

- **身份**：`anonId` 首次启动时生成（16 位随机 base62），永久存在 storage。`sessionId` 每次冷启动或 `onShow` 间隔超过 30 分钟时重新生成。
- **攒批**：事件先进内存队列。满 20 条、或每 10s、或 `App.onHide` 时，调用一次 `POST /api/mp/track`。
- **失败重试**：失败的事件放回 storage 队列 `mp.track.queue`，最多保留 200 条，超出丢弃最旧的，下次启动时补发。
- **与播放隔离**：埋点失败**永不**影响页面和播放器。

### F.7 云存档（`lib/save-sync.ts` + `src/lib/mp/save-merge.ts`）

- **本地优先**：播放器只读写本地 storage，三个键分别是 `profileStorageKey('mp:'+slug)`、`savesStorageKey(...)`、`permanentStorageKey(...)`。
- **同步时机**：
  - 进入详情页：GET 云存档 → 与本地合并 → 写回本地。只有当前没有在播放时才写回。
  - 播放器内：达成结局时、checkpoint 更新时、手动存档时、`appHide` 时、页面 `onUnload` 时，各 PUT 一次。除 `appHide` 和 `onUnload` 外，节流为每 15s 最多一次。
- **服务端规则**：
  - `baseRev === rev`：直接用客户端的数据覆盖。
  - 否则：`merged = mergeSaveState(server, client)`。
  - 两种情况都 `rev + 1`，返回最终状态和 `merged` 标志。
- **`mergeSaveState`**（纯函数，客户端和服务端共用）：

| 部分 | 规则 |
|---|---|
| `profile.endings` / `segments` / `achievements` / `bought` | 并集，保留服务端顺序，客户端新增的追加在后面 |
| `profile.equipped` | 取客户端 |
| `saves.auto` | `savedAt` 较新的一方 |
| `saves.slots[i]` | 两边都有值时取 `savedAt` 较新的；一边为 null 时取有值的一边（已知限制：一台设备删除的手动存档，可能被另一台设备的旧值带回，可以接受） |
| `saves.checkpoints` | 按 key 并集，同 key 取较新的；总数超过 `STORY_CHECKPOINT_LIMIT` 时按 `savedAt` 保留最新的 |
| `permanent` | 数字取 max，布尔取 OR，字符串取客户端 |

- **版本兼容**：读档时如果 `restoreRun(program, snapshot)` 返回 null（新版本删了那个节点），就把这个槽显示为「此存档来自旧版本，无法继续」，只保留「删除」操作。自动存档失效时，详情页主按钮回到「开始游玩」。
- **字段口径**：PUT 时客户端顺带计算并上报 `progress`（`profile.segments` 与本版本 scene 节点的交集 ÷ `segmentCount`）和 `endingsGot`。服务端存进 `ConsumerSave` 的同名字段，供「继续游玩」和「游玩记录」使用。

---

## §G 媒体、CDN 与转码

### G.1 CDN URL（`src/lib/storage/cdn.ts`）

**先 grep**：如果 `src/lib/storage/cdn.ts` 已经存在（性能方案 `docs/design/2026-11-14-performance-traffic-login-plan.md` §4.4 已经实现），就直接复用里面的签名函数，只补一个 `mpMediaUrl` 包装。不存在的话，按下面的规格新建。

```ts
// env：MEDIA_CDN_BASE_URL（如 https://media.lanmiaoai.com）、MEDIA_CDN_AUTH_KEY、MEDIA_CDN_AUTH_PARAM（默认 auth_key）、MP_ALLOW_TOS_DIRECT
export const MP_URL_BUCKET_SEC = 6 * 3600
export const MP_URL_TTL_SEC = 12 * 3600
export function cdnConfigured(): boolean
export function signCdnPath(path: string, nowSec: number): string
// A 型鉴权：ts = floor(nowSec / 6h) * 6h；rand = '0'；uid = '0'
// hash = md5(`${path}-${ts}-${rand}-${uid}-${MEDIA_CDN_AUTH_KEY}`)
// 返回 `${MEDIA_CDN_BASE_URL}${path}?${param}=${ts}-${rand}-${uid}-${hash}`
export async function mpMediaUrl(key: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string>
// CDN 已配置 → signCdnPath('/' + key 按段 encodeURIComponent)
// 未配置但 MP_ALLOW_TOS_DIRECT=1 → getSignedObjectUrl(key, MP_URL_TTL_SEC)（TOS 直链，不是 app 代理）
// 否则抛 ApiError(503, 'MP_CDN_NOT_CONFIGURED')
export function mpUrlExpiresAt(nowSec: number): string   // (floor(now/6h)*6h + 12h) 的 ISO 时间
```

- **CDN 控制台要求**（用户做，见 §M）：
  - A 型鉴权的有效期设为 **12 小时**，与 `MP_URL_TTL_SEC` 一致。
  - 回源到 TOS 私有桶（开启私有桶回源鉴权）。
  - `mp/` 前缀缓存 30 天，并且「忽略参数缓存」，这样鉴权参数不同不会导致缓存未命中。
- **流量估算**（供用户决策，按 CDN 单价约 0.2 元/GB 量级估算，以实际账单为准）：
  - 720P 平均约 1.8Mbps，约 13.5MB/分钟。
  - 一次 20 分钟的完整游玩约 270MB。
  - 每 1 万次完整游玩约 2.7TB。
  - 蜂窝网络默认 480P，约为上面的 40%。

### G.2 转码规格（`transcode.ts`）

**进程与路径**

- ffmpeg 和 ffprobe 的路径解析，照 `src/lib/canvas/video-operations.ts:147` 的写法：`process.env.FFPROBE_PATH?.trim() || 'ffprobe'`，ffmpeg 同理。
- 所有子进程都用 `spawn('nice', ['-n', '10', bin, ...args])` 启动，降低优先级，避免抢 Next 的 CPU。
- 每次调用的超时是 10 分钟，超时就 kill。

**全局串行**

- 同一时刻全站只跑一个版本生成。
- 用 Redis 锁 `mp:build:lock`：`SET NX EX 900`，每 60s 续期一次。
- 拿不到锁时每 10s 重试一次，最多等 30 分钟，超时就 `build_failed`，`failure` 写「生成排队超时，请稍后重试」。
- 排队期间 `progress` 保持 0，B 端把 `building` 且 `progress = 0` 的版本显示为「排队中」。

**输入**

- 源文件通过 `getSignedObjectUrl(key, 3600)` 得到 TOS 直链，ffmpeg 和 ffprobe 直接读这个 URL，不先下载到内存。
- 每个源文件只转一次，后续版本靠 C.7 第 4 步复用，所以 TOS 出网只发生一次。

| 产物 | 命令要点 |
|---|---|
| probe | `ffprobe -v error -print_format json -show_streams -show_format <in>`。取视频流的 width、height（带 ±90° 旋转元数据时宽高对调）、`format.duration`，以及是否存在音频流 |
| 720.mp4 | `-map 0:v:0 -map 0:a:0? -c:v libx264 -preset veryfast -profile:v high -level 4.0 -pix_fmt yuv420p -crf 23 -maxrate 2500k -bufsize 5000k -vf "scale='if(lt(iw,ih),min(720,iw),-2)':'if(lt(iw,ih),-2,min(720,ih))'" -force_key_frames "expr:gte(t,n_forced*2)" -c:a aac -b:a 128k -ac 2 -ar 44100 -movflags +faststart -metadata comment="AIGC" -metadata description="AI 生成内容 · 蓝猫剧场" -threads 2` |
| 480.mp4 | 同上，把 720 换成 480，`-crf 26 -maxrate 1000k -bufsize 2000k -b:a 96k` |
| poster.jpg | `-ss <min(0.5, dur/2)> -i <in> -frames:v 1 -vf <720 scale> -q:v 3` |
| last.jpg | `-sseof -0.15 -i <in> -frames:v 1 -vf <720 scale> -q:v 3`；失败时改用 `-ss <dur-0.2>` |
| sheet.jpg | `-i <in> -vf "fps=16/<max(dur,16)>,scale=240:-2,tile=4x4" -frames:v 1 -q:v 5` |
| 图片 | `sharp(buf).rotate().resize({ width: 1440, height: 1440, fit: 'inside', withoutEnlargement: true })`。`metadata.hasAlpha` 为真时输出 `png({ compressionLevel: 9 })`，否则输出 `jpeg({ quality: 82, mozjpeg: true })` |

**输出**

- key 的格式：`mp/releases/<releaseId>/m/<mediaId>/{720.mp4,480.mp4,poster.jpg,last.jpg,sheet.jpg,img.jpg|img.png}`。
- 上传用 `uploadObject(buffer, key, undefined, contentType)`（`src/lib/storage/index.ts:44`）。

### G.3 AIGC 标识（合规：《人工智能生成合成内容标识办法》，2025-09-01 起施行）

**显式标识**：

- 详情页显示徽标「AI 生成内容」；
- 播放器左下角常驻「AI 生成」；
- 海报左下角写「AI 生成内容」；
- 分享卡片的封面图（`share.jpg`）右下角，在 build 时用 sharp 叠加白色 20px 文字「AI 生成」，透明度 0.7。

**隐式标识**：

- mp4 写入 `comment` 和 `description` 元数据，见 G.2。
- jpg 用 `sharp(...).withMetadata({ exif: { IFD0: { ImageDescription: 'AIGC; lanmiaoai' } } })` 写入。

---

## §H 宣发机制与数据（B5）

### H.1 定时上线与预约

- **自动上线**：watchdog 任务 `runScheduledGoLive()` 每次 tick 都执行（锁 `mp:job:golive EX 60`）。条件是 `pendingReleaseId` 不为空且 `scheduledAt <= now` 的 MpWork，对它执行 `goLive(pendingReleaseId)`。
- **客户端「预约上线提醒」**（必须直接在点击回调里调用）：
  1. 调用 `wx.requestSubscribeMessage({ tmplIds: [TPL_WORK_LIVE] })`。
  2. 不论结果如何，都 `PUT /api/mp/works/:slug/reservation`。
  3. 结果是 `accept` 时，再调用 `POST /api/mp/subscriptions`，参数 `{ kind: 'work_live', accepted: true }`。
  4. toast：accept 时为「预约成功，上线时会通知你」，其他情况为「预约成功，开启通知后可以在上线时收到提醒」。
- **取消预约**：点击「已预约」时弹 action sheet「取消预约」，执行 DELETE reservation。
- **更新提醒**：详情页「章节」标题右侧有一个文字按钮「更新提醒」（只在 live 作品上显示）。点击后执行 `requestSubscribeMessage([TPL_CHAPTER_UPDATE])`，结果是 accept 时调用 POST subscriptions，toast「已开启，新章节上线时会通知你一次」。
- **模板 id 的位置**：小程序侧写在 `config.ts`（`TPL_WORK_LIVE`、`TPL_CHAPTER_UPDATE`），服务端写在 env（`MP_TPL_WORK_LIVE`、`MP_TPL_CHAPTER_UPDATE`）。模板 id 不是秘钥，可以提交到仓库。

### H.2 订阅消息发送

- **入队**：`enqueueNotify(kind, mpWorkId, releaseId)` 往 Redis list `mp:notify:queue` 里 `RPUSH` 一条 JSON。
- **消费**：watchdog 任务 `sendNotifications()` 每次 tick 执行（锁 `mp:job:notify EX 300`），每次最多处理 1 个队列项。处理流程：
  1. 分页（每页 200 条）查询 `MpSubscription`，条件是 `mpWorkId`、`kind` 匹配，`credits > 0`，并且 `lastSentRef != releaseId`。
  2. 逐条调用 `sendSubscribe`，速率不超过 20 条/秒。
  3. 发送成功，或返回 43101 时：`credits - 1`，`lastSentRef = releaseId`。
  4. 其他错误记日志后跳过（不扣额度）。
  5. 一个队列项处理完才 `LPOP`。中途崩溃会重跑，但 `lastSentRef` 保证不会重复发送。
- **字段映射**：模板字段名由用户在后台选好模板后决定，所以从 env 读，不写死在代码里：

  ```
  MP_TPL_WORK_LIVE_FIELDS={"title":"thing1","hint":"thing2","time":"time3"}
  MP_TPL_CHAPTER_UPDATE_FIELDS={"title":"thing1","hint":"thing2","time":"time3"}
  ```

  模板 id 或字段映射缺失时，跳过发送，记一条 warn 日志 `mp.notify.skipped`，不报错。
- **内容**：
  - `title` 是作品名，截到 20 字。
  - `time` 是上线时间，格式 `YYYY年M月D日 HH:mm`。
  - `hint`：work_live 用「你预约的作品已上线，快来开始游玩」，chapter_update 用「新章节已上线，快来继续你的故事」。
  - `page` 是 `pages/work/index?w=<slug>&src=subscribe`。

### H.3 分享、小程序码与海报

**shareId**：客户端用 `lib/share.ts` 生成 10 位 base62，同时 fire-and-forget 调用 `POST /api/mp/shares` 登记。分享路径因此可以**同步**返回，不依赖网络。

**分享模板**（`lib/share.ts`）：

| 场景 | title | path / query | imageUrl |
|---|---|---|---|
| 详情页 / 播放中（会话） | `《{title}》{tagline}` | `/pages/work/index?w={slug}&s={id}` | 分享封面 |
| 结局卡出现后（会话） | `我在《{title}》达成了「{endingTitle}」，你能找到几个结局？` | 同上，`kind = 'ending'` | 分享封面 |
| 朋友圈 `onShareTimeline` | `《{title}》{tagline}` | query `w={slug}&s={id}` | 竖版封面 |
| 专题页 | `{topicTitle}｜蓝猫剧场` | `/pages/topic/index?t={slug}&s={id}` | 专题封面 |

- 播放页和详情页的 `onLoad` 里都调用 `wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })`。
- 详情页底栏的「分享」会打开一个半屏 share-sheet，里面有两个按钮：`<button open-type="share">发给朋友</button>` 和「生成海报」。

**小程序码**：

- `POST /api/mp/wxacode { shareId }` 的处理：
  1. 校验 shareId 属于当前用户；
  2. `scene = 's=' + shareId`，`page = 'pages/work/index'`；
  3. 生成的 PNG 存到 `mp/wxacode/s/<shareId>.png`（已存在就不再生成）；
  4. 返回 `{ url: mpMediaUrl(key) }`。
- 详情页 `onLoad(options)` 里，如果有 `options.scene`，就 `decodeURIComponent` 后按 `k=v&k=v` 解析，得到 `s`、`c`、`w`、`t`。

**海报**（`pkg-play/components/poster-maker`，详情页也复用同一个组件，所以把它放进主包 `components/poster-maker`）：

- **画布**：页面内放一个隐藏的 `<canvas type="2d">`（`position: fixed; left: -9999px`），逻辑尺寸 750×1334，`dpr = min(wx.getWindowInfo().pixelRatio, 1.5)`。
- **素材加载**：背景图和小程序码先用 `wx.downloadFile` 下载，再用 `canvas.createImage()` 加载。
- **结局海报布局**：
  - 背景图铺满，取该结局最后一个 scene 的 `last` 帧，没有就用竖版封面；底部 60% 叠一层 `rgba(14,15,26,0)` 到 `0.92` 的渐变。
  - 左上 (40,60) 是 logo（48×48）和文字「蓝猫剧场」（28px，600）。
  - (40,820) 开始：
    - 结局类型标签，类型色圆角底，24px；
    - 「我在《{title}》达成了」，30px，`#A3A8C3`；
    - 结局名，56px，700，白色，最多 2 行，超出加省略号；
    - 稀有度（有数据时），26px，`#FFB547`。
  - 底部卡片 (40,1100,670,190) 圆角 24，`#181A2B`：
    - 左边两行文字：「长按识别小程序码」（26px）、「一起来玩《{title}》」（30px，600）；
    - 右边小程序码 150×150。
  - 左下角 (40,1310)：「AI 生成内容」，20px，透明度 0.6。
- **作品海报**（详情页）：与结局海报相同，只是把中间那段换成作品名（56px）、一句话简介（30px）和标签。
- **出图与分享**：用 `wx.canvasToTempFilePath({ canvas })` 导出，再调用 `wx.showShareImageMenu({ path })`，系统菜单自带「发送给朋友」「保存」「分享到朋友圈」。
- **生成中状态**：先 `wx.showLoading({ title: '海报生成中' })`；失败时 toast「海报生成失败，请重试」。

### H.4 渠道码（创作者 + 运营）

**创建**（`src/lib/mp/channels.ts` 的 `createChannel({ kind, name, mpWorkId?, topicId?, userId })`）：

1. 生成 `code`：6 位小写 base32，冲突就重试。
2. 生成小程序码：作品渠道 `scene = c=<code>&w=<slug>`，page 为 `pages/work/index`；首页渠道 `scene = c=<code>`，page 为 `pages/home/index`；专题渠道 `scene = c=<code>&t=<topicSlug>`，page 为 `pages/topic/index`。PNG 存到 `mp/wxacode/c/<code>.png`。
3. 如果 `MP_URL_LINK_ENABLED=1`，生成 URL Link，同时记录 `urlLinkExpiresAt`。

**B 端「⑤ 推广」区块**：

- 只在作品为 live 或 scheduled 时可用，否则显示占位「作品上线后可以生成推广渠道」。
- 按钮「新建渠道」→ 弹窗，输入「渠道名称」（1–20 字，占位「例如：公众号推文 11 月」）→「创建」。
- 表格列：
  - 「渠道」
  - 「小程序码」：按钮「下载」，下载 PNG
  - 「小程序路径」：按钮「复制」，复制 `pages/work/index?w=<slug>&c=<code>`
  - 「外链」：按钮「复制」，只在开启 URL Link 时显示；剩余有效期不足 1 天时，复制前先由接口自动续期
  - 「新用户（30 天）」
  - 「游玩人数（30 天）」
  - 「操作」：「归档」
- 表格下方的说明：「小程序路径可以用在公众号文章、视频号和社群的小程序卡片里；外链可以放在短信和网页里，有效期 30 天，复制时会自动续期。」

**运营渠道**：在 §D.4 的 tab 里，用同一个 `createChannel`，`kind = 'ops'`。

### H.5 归因（`miniprogram/lib/attribution.ts`，纯函数 + 单测）

**取值**：

- `App.onLaunch` 和 `App.onShow` 的参数里取 `scene`、`query`；
- 如果有 `query.scene`，按 H.3 的方式解析。

**来源分桶**（`sourceOf(scene, query)`）：

1. 有 `c` → `channel`。
2. 有 `s` → `share`。
3. 都没有时，按场景值查表：

| 场景值 | source |
|---|---|
| 1007、1008、1036、1044 | `share` |
| 1011、1012、1013、1047、1048、1049 | `qrcode` |
| 1154、1155 | `timeline` |
| 1014 | `subscribe` |
| 1035、1043、1058、1074 | `official_account` |
| 1175、1176、1177、1184、1191 | `channels` |
| 1065、1194 | `url_link` |
| 1005、1006、1027、1042、1053 | `search` |
| 1001、1089、1104 | `recent` |
| 其他 | `other` |

**落地**：

- 当前的归因 `{ source, c?, s?, w?, at }` 存进 storage 的 `mp.attr`，30 分钟内有效。之后的每次 track 都带在顶层的 `attr` 里，App 冷启动时再上报一次 `app_launch`。
- 登录接口收到 `launch` 后，如果是新用户，写入 `firstSource`、`firstChannelId`（用 code 查）、`firstShareId`、`firstMpWorkId`（用 slug 查）。如果 shareId 有效，`MpShare.newUsers + 1`。

### H.6 榜单与计数

| 指标 | 算法 |
|---|---|
| `playerCount` | `COUNT(ConsumerSave WHERE mpWorkId)`，由聚合任务更新 |
| `players7d` | 近 7 天 `play_start` 的 `COUNT(DISTINCT consumerId)` |
| `hotScore` | `(players7d + 2×完成7d + 3×分享7d + 2×收藏7d) × (1 + 0.5 × max(0, 1 − 上线天数/14))` |
| `ratingScore` | 贝叶斯平均：`(v/(v+m))×R + (m/(v+m))×C`，其中 m = 20，v = `ratingCount`，R = `ratingSum/ratingCount`，C 为全站均分（没有数据时取 4.0） |
| 热玩榜 | live，按 `hotScore` 降序 |
| 好评榜 | live 且 `ratingCount ≥ 10`，按 `ratingScore` 降序 |
| 新作榜 | live 且 `firstLiveAt` 在 30 天内，按 `firstLiveAt` 降序 |
| 预约榜 | scheduled，按 `reserveCount` 降序 |
| `favoriteCount` / `reserveCount` | 操作时就地 ±1，每天由聚合任务全量重算一次纠偏 |

### H.7 统计聚合（`src/lib/mp/jobs.ts`）

**接入 watchdog**：在 `scripts/watchdog.ts` 的 `tick()` 末尾加一行 `void runMpJobs().catch(logMpJobError)`。

- `runMpJobs` 内部用 Redis 键控制各任务的间隔：`mp:job:<name>:next`。
- 每个任务都有自己的 `SET NX EX` 锁。
- 任何异常都在内部捕获，**绝不**影响 watchdog 原有逻辑。
- `MP_JOBS_ENABLED=0` 时全部跳过。

| 任务 | 间隔 | 内容 |
|---|---|---|
| `runScheduledGoLive` | 每个 tick | H.1 |
| `sendNotifications` | 每个 tick | H.2 |
| `aggregateEvents` | 10 分钟 | 增量处理（见下） |
| `aggregateDaily` | 10 分钟 | 重算今天和昨天（北京时间）的 `MpWorkDailyStat`，幂等 upsert |
| `refreshWorkCounters` | 10 分钟 | 更新 `playerCount`、`players7d`、`hotScore`、`ratingScore`，然后 `INCR mp:cache:ver` |
| `dailyMaintenance` | 每天 03:00–03:10（北京时间） | 用 `mp:job:maint:<date>` NX 保证每天只跑一次。内容：重算收藏和预约计数；按批删除 90 天前的 `MpEvent` 行（每批 `LIMIT 5000`，批间 sleep 200ms）。这里删的是数据库行，不是文件 |

**`aggregateEvents`**：

1. 从 `MpJobState('agg.lastEventId')` 读出水位，每次最多处理 5 万行。
2. 分组累加：
   - `choice_made` → `MpBranchStat(mpWorkId, nodeId, optionId)`
   - `ending_reached` 且 `flag = true`（首次达成）→ `MpBranchStat(mpWorkId, nodeId, '')`
   - 带 shareId 的 `app_launch` → `MpShare.opens`
3. 写入用 `$executeRaw` 的 `INSERT … ON DUPLICATE KEY UPDATE count = count + VALUES(count)`，和更新水位放在**同一个事务**里。

**稀有度**：`/releases/:id/stats` 返回的稀有度 = 结局首达人数 ÷ `playerCount`。选择占比 = 该选项次数 ÷ 该节点所有选项次数之和。

**容量提示**：每次游玩约产生 30 条事件。日均 1 万次游玩时，90 天约 2700 万行。MySQL 能承受，但 binlog 会变大（`/data` 上已有 binlog 压力），所以事件字段保持精简，不加冗余列。

### H.8 埋点接收（`POST /api/mp/track`）

**请求体**：

```ts
{
  anonId: string
  attr?: { source: string; c?: string; s?: string }
  events: Array<{ name: string; ts: number; sid: string; w?: string; r?: string; n?: string; o?: string; v?: number; f?: boolean }>
}
```

**服务端处理**：

- `name` 不在白名单里的事件直接丢弃。
- `ts` 不在 `[now − 7 天, now + 5 分钟]` 内时，改成当前时间。
- `w`（slug）→ `mpWorkId`，查不到就丢弃这条事件。
- `attr.c`（code）→ `channelId`，缓存在 `mp:chan:<code>`，TTL 600s。
- 字符串截断到列宽，然后 `createMany`，返回 204。

**事件白名单**：

| name | 字段 | 触发 |
|---|---|---|
| `app_launch` | — | 冷启动和归因变化时 |
| `work_view` | w，o = 来源位（`home_hero`、`home_pick`、`hot`、`newest`、`upcoming`、`topic`、`rank_*`、`tag`、`search`、`history`、`favorite`、`share`、`qrcode`、`subscribe`、`direct`） | 详情页 onLoad |
| `play_start` | w，r，f = 是否续玩 | 播放器开始 |
| `segment_view` | w，r，n | 每个 scene 开始播放 |
| `choice_made` | w，r，n，o，v = 决策耗时（ms） | 做出选择 |
| `interaction_result` | w，r，n，o = 结果 handle | 互动结算 |
| `ending_reached` | w，r，n，f = 是否首次 | 结局卡出现 |
| `play_exit` | w，r，n = 最后节点，v = 本次观看秒数，f = 是否已到结局 | 退出或切后台超过 30 分钟 |
| `share_click` | w，o = kind | 点击分享 |
| `poster_create` | w，o = `ending`\|`work` | 海报生成成功 |
| `favorite` / `rate` / `reserve` | w，v | 对应操作成功 |
| `search` | o = 关键词（截到 64 字） | 搜索提交 |

### H.9 创作者数据（「⑥ 数据」区块 + `GET …/publish/stats`）

**响应**：

```ts
{
  kpis: { views: number; starts: number; players: number; completionRate: number; avgWatchMin: number; shares: number; newUsers: number }
  daily: { date: string; players: number; starts: number; completions: number }[]
  endings: { nodeId: string; title: string; endingType: string; count: number; pct: number }[]
  choices: { nodeId: string; title: string; options: { optionId: string; label: string; count: number; pct: number }[] }[]
  dropoffs: { nodeId: string; title: string; exits: number }[]
  channels: { code: string; name: string; newUsers: number; players: number }[]
}
```

**数据来源**：

- `players` 直接查 `MpEvent`：`COUNT(DISTINCT COALESCE(consumerId, anonId))`，条件 `name = 'play_start'` 且在时间范围内。
- 其余 KPI 和 `daily` 由 `MpWorkDailyStat` 求和得到。
- `endings`、`choices` 读 `MpBranchStat`（累计值），节点标题和选项文案从线上版本的 program 里取。
- `dropoffs`：时间范围内 `play_exit` 且 `flag = false`，按 `nodeId` 分组取前 10。
- `channels`：本作品的渠道。`newUsers` 是 `ConsumerUser.firstChannelId` 在时间范围内的计数；`players` 是带该 `channelId` 的 `play_start` 的去重人数。
- 结果缓存 10 分钟，键为 `(work, range)`。

**UI 文案**：

- 时间范围 tab：「近 7 天」「近 30 天」。
- KPI 卡：「访问」「开始游玩」「玩家」「完成率」「人均时长」「分享」「新增用户」。
- 区块标题：「每日玩家」（SVG 柱状图）、「结局分布（累计）」、「选择分歧（累计）」、「流失点 Top 10」、「渠道表现」。
- 空状态：「还没有数据，作品上线后每 10 分钟更新一次」。

### H.10 举报

- **入口**：详情页右上角「…」打开 report-sheet。
- **理由（单选）**：「低俗色情」`vulgar`、「暴力血腥」`violence`、「政治敏感」`politics`、「侵犯版权」`copyright`、「不适合未成年人」`minor`、「其他」`other`。
- **补充说明**：「补充说明（选填）」，最多 200 字。
- **提交**：按钮「提交举报」，成功后 toast「已收到，我们会尽快处理」。

### H.11 微信搜一搜收录（`miniprogram/miniprogram/sitemap.json`）

```json
{ "rules": [
  { "action": "allow", "page": "pages/work/index", "params": ["w"], "matching": "partial" },
  { "action": "allow", "page": "pages/topic/index", "params": ["t"], "matching": "partial" },
  { "action": "allow", "page": "pages/home/index" },
  { "action": "disallow", "page": "*" }
] }
```

---

## §I 付费（只设计，不实现；B6 需用户明确开通）

B1–B5 里**不写任何付费代码**（红线 6）：不写广告组件，不写支付接口，不建付费相关的表。下面这些内容只是为了让 B1–B5 的结构不挡住以后的路。

### I.1 两条可选路线

| 路线 | 机制 | 前置条件（用户在微信后台办） | 风险 |
|---|---|---|---|
| 激励视频解锁 | `wx.createRewardedVideoAd({ adUnitId })`，`onClose(res)` 里 `res.isEnded === true` 才算看完，看完解锁下一章 | 开通「流量主」，具体门槛以后台为准 | 微信不给小程序激励视频提供服务端回调，只能信任客户端，所以要按人按天限次 |
| 章节付费 | 小程序虚拟支付（xpay），按章或整部定价 | 主体资质、虚拟支付开通、类目许可；iOS 能不能付、怎么分成以当期规则为准 | 未成年人限额、退款、对账 |

**B6 开工前必须先让用户选定路线**，并确认 iOS 规则和类目资质，再另出 B6 文档。本节不是 B6 的实现规格。

### I.2 B1–B5 已经为付费预留的结构（不要提前实现）

- **章节边界**：`StoryRelease.program` 保留了章节信息，B6 能按「前 N 章免费」切分。
- **媒体按章下发**：现在 `/play` 一次返回全部媒体（§E.3）。B6 要改成：未解锁章节的媒体不返回 URL，另由 `POST /api/mp/works/[slug]/unlock` 校验权益后返回签名 URL。否则付费可以被绕过。
- **商店不碰真钱**：游戏内商店永远是游戏内货币（`currencyVariableId`）。B6 也不把真钱换成游戏币，付费只解锁章节。
- **B6 才建的表**（这里只列名字，B1–B5 不建）：`MpEntitlement`（consumerId、mpWorkId、scope、source `ad|pay`、orderId）、`MpOrder`。

---

## §J 批次、DoD 与提交顺序

**通用规则**

- 每批开工前，把本批涉及的锚点逐个 grep 一遍（R15）。
- 每批结束先跑本批的 DoD 命令，全绿才提交（R14）。
- 测试命令统一加 `cross-env BILLING_TEST_BOOTSTRAP=0`，与仓库现有 `test:unit:all` 一致。
- **新增的每个 `route.ts`** 都要按字母序登记到 `tests/contracts/route-catalog.ts` 的 `ROUTE_FILES`。`/api/mp/*` 和 `/api/admin/mp/*` 走默认分类，`resolveCategory` 不改。
- **新增的 `TASK_TYPE.STORY_RELEASE_BUILD`** 要登记到 `tests/contracts/task-type-catalog.ts`，值写 `'tests/unit/mp/release-build.test.ts'`。该文件是 `satisfies Record<TaskType, string>`，漏登记 `tsc` 就会报错。
- **服务端日志**用 `createScopedLogger`（`@/lib/logging/core`），`src/` 和 `scripts/` 里不写 `console.*`（`check:logs`）。
- **小程序里**不写 `console.log`。确实需要调试输出时，只在 `envVersion !== 'release'` 下用 `console.warn`。

**全批通用 DoD**（每批都跑，下面各批只列追加项）

```bash
npx tsc --noEmit
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/mp tests/unit/interactive
npx eslint src/lib/mp src/app/api/mp src/app/api/admin/mp src/features/mp-publish
npm run check:api-handler && npm run check:test-route-coverage && npm run check:test-tasktype-coverage
git diff --check
```

全量 `tsc` 如果只在 Finder 「 2」 副本里报错，属于既有问题（R9），在提交说明里注明即可，不要去修。其他报错必须清零。

### J.1 B1 平台底座：配置隔离、模型、发布、版本生成、审核

**范围**：§1 表第 1–6 行和第 20 行里的转码元数据；§B 全部；§C 全部；§D.1–D.3。

**`.env.example` 追加**（只写键，值一律留空；R7 列出的四个秘钥绝不写值）：

```
# 小程序内容平台
MP_APP_ID=
MP_APP_SECRET=
MP_JWT_SECRET=
MP_ENV_VERSION=release        # develop | trial | release
MP_JOBS_ENABLED=1
MP_URL_LINK_ENABLED=0
MP_ALLOW_TOS_DIRECT=0         # 只在测试机设为 1
MP_TPL_WORK_LIVE=
MP_TPL_WORK_LIVE_FIELDS=
MP_TPL_CHAPTER_UPDATE=
MP_TPL_CHAPTER_UPDATE_FIELDS=
MP_CI_PRIVATE_KEY_PATH=       # 指向仓库外的路径
MEDIA_CDN_BASE_URL=
MEDIA_CDN_AUTH_KEY=
MEDIA_CDN_AUTH_PARAM=auth_key
```

**追加 DoD**

- `npx prisma validate`。
- 本地库执行 `npx prisma db push --skip-generate`，输出只能有新建表。如果提示 data loss 或要求 `--accept-data-loss`，立刻停下问用户。
- `tests/unit/mp/media-refs.test.ts`、`preflight.test.ts`、`lifecycle.test.ts`、`release-build.test.ts`、`listing.test.ts` 全绿（§K）。
- `tests/unit/interactive/service*.test.ts` 全绿（C.3）。
- `grep -rn "miniprogram" tsconfig.json eslint.config.mjs .dockerignore` 三处都能命中。

**提交顺序**

1. `feat(mp): isolate miniprogram workspace and add env keys`：tsconfig、eslint、.dockerignore、.env.example。
2. `feat(mp): add content platform schema`：schema.prisma 和 `src/lib/mp/constants.ts`、`ids.ts`、`release/types.ts`。
3. `feat(mp): extract session-free story loader for releases`：只改 `service.ts`（C.3）。
4. `feat(mp): story release build task`：task types、catalog、submitter、worker、`release/*`、对应单测。
5. `feat(mp): publish page with listing, preflight and releases`：B 端接口和 `src/features/mp-publish/*`、StoryOverview 按钮。
6. `feat(mp): admin content review`：§D.1–D.3、`/api/admin/mp/releases/*`。

### J.2 B2 C 端服务：账号、CDN、接口

**范围**：§E.1、E.3、E.5、E.6，以及 §G.1。`/api/mp/shares`、`/wxacode`、`/subscriptions`、`/releases/[id]/stats` 这 4 个路由**不在 B2 建**，留到 B5。B3 的页面也先不放分享海报、预约、订阅这些入口，B5 一起接。

**追加 DoD**

- `tests/unit/mp/token.test.ts`、`auth.test.ts`、`cdn.test.ts`、`dto.test.ts`、`api-contract.test.ts`、`rate-limit-keys.test.ts` 全绿。
- **泄漏守卫**：`api-contract.test.ts` 把每个 C 端接口的响应 JSON 序列化后断言，不出现 `workId`、`workspaceOwnerId`、`createdById`、`storageKey`、`reviewNote`、`openid`、`unionid`，也不出现形如 `images/`、`videos/`、`mp/releases/` 开头的裸 key（红线 2）。
- **鉴权隔离**：带 next-auth cookie、不带 Bearer 去调 `/api/mp/me`，断言 401；带 C 端 token 去调一个 B 端接口，断言 401（R4）。

**提交顺序**

1. `feat(mp): consumer auth with wechat login and own jwt`
2. `feat(mp): cdn signed media urls`
3. `feat(mp): consumer content apis`
4. `feat(mp): consumer saves, favorites, ratings, reports`

### J.3 B3 小程序工程与页面

**范围**：§F.1–F.4、§F.6，A.3 主包全部页面，A.5 的全部文案。播放器分包在 B3 只建空页面和路由，显示「播放器开发中」。

**追加 DoD**

```bash
npm --prefix miniprogram ci
npm --prefix miniprogram run build:runtime
npx tsc -p miniprogram/tsconfig.json --noEmit
npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/mp/runtime-bundle.test.ts tests/unit/mp/attribution.test.ts tests/unit/mp/mp-format.test.ts
```

- 第一次没有 lock 文件，先跑 `npm --prefix miniprogram install` 生成 `miniprogram/package-lock.json` 并提交，之后一律用 `ci`。
- `miniprogram/package.json` 的 `scripts` 里有 `build:runtime`、`preview`、`upload` 三个，分别跑 F.2 的三个脚本。
- **主包体积 ≤ 1.5MB**：`du -sk miniprogram/miniprogram` 减去 `pkg-play` 目录。超了就压缩 `assets`，不要删功能。
- **预览二维码**：只有用户已经提供 AppID、CI 秘钥，并配好 IP 白名单时，才跑 `npm --prefix miniprogram run preview`，产物是 `miniprogram/dist-preview/preview-*.png`。没提供就跳过，并在交付说明里写「预览二维码待用户提供 CI 秘钥后生成」。
- `git status` 里不能出现 `story-runtime.js`、`project.private.config.json`、`dist-preview/`（F.2 的 .gitignore）。

**提交顺序**

1. `feat(mp): miniprogram project skeleton and runtime bundle`
2. `feat(mp): miniprogram lib (api, auth, track, attribution, cache)`
3. `feat(mp): discovery pages (home, explore, search, rankings, topic)`
4. `feat(mp): work detail and profile pages`

### J.4 B4 播放器与云存档

**范围**：§F.5、§F.7，§G.3 里的播放器角标。

**追加 DoD**

- `tests/unit/mp/player-controller.test.ts`、`clock.test.ts`、`rates.test.ts`、`hotspot-geo.test.ts`、`preload.test.ts`、`save-merge.test.ts` 全绿。
- 用 `tests/unit/interactive/fixture.ts`、`economy-fixture.ts`、`p3-fixture.ts` 跑 controller 脚本化回放：从开头选到每一个结局都能走到，结局 key 与 `achievements.ts` 的 `endingKeys` 一致。`dispose()` 之后用 `vi.getTimerCount() === 0` 断言没有残留的计时器（测试里用 `vi.useFakeTimers()`）。
- `pkg-play` 分包体积 ≤ 2MB。
- 有预览条件时生成二维码交给用户真机扫码，验收清单见 §L.5。

**提交顺序**

1. `feat(mp): player controller with injected ports`
2. `feat(mp): video stage, interactions and sheets`
3. `feat(mp): ending card, achievements and profile sync`
4. `feat(mp): local-first saves with cloud merge`

### J.5 B5 宣发、运营与数据

**范围**：§H 全部，§D.4、D.5，C.5 的「⑤ 推广」和「⑥ 数据」。

**追加 DoD**

- `tests/unit/mp/jobs.test.ts`、`aggregation.test.ts`、`channels.test.ts`、`subscriptions.test.ts`、`ranking.test.ts`、`share.test.ts`、`poster-layout.test.ts` 全绿。
- **诱导分享守卫**（R6）：`share.test.ts` 扫描 `miniprogram/miniprogram/**/*.{ts,wxml,json}` 和 `src/lib/mp/**`，断言不出现「分享后」「邀请好友」「助力」「解锁」与 `share` 同行的组合。
- `scripts/watchdog.ts` 只多一处调用 `runMpJobs()`，`MP_JOBS_ENABLED=0` 时什么都不做。

**提交顺序**

1. `feat(mp): scheduled go-live, reservations and subscribe messages`
2. `feat(mp): share cards, wxacode and posters`
3. `feat(mp): channel codes and attribution`
4. `feat(mp): rankings, feature slots and topics`
5. `feat(mp): stats aggregation, creator and ops dashboards`

### J.6 B6 付费

不排期。用户明确开通并选定路线（§I.1）之后另出文档。

---

## §K 测试清单

**通用约定**

- 全部放在 `tests/unit/mp/`，用 vitest，环境是 `node`。
- **不连真微信、不连真 TOS/CDN、不跑真 ffmpeg 转码**：
  - `fetch` 一律 mock；
  - `transcode.ts` 的 `spawn` 用 `vi.mock` 替掉；
  - 需要 DB 的逻辑用 `vi.mock('@/lib/prisma')` 注入内存假实现。
- 小程序侧的纯逻辑（`miniprogram/miniprogram/lib/*`、`pkg-play/lib/*`）在测试里用相对路径直接 import。这些文件不能 import `wx`；用到 `wx` 的文件不进单测。
- 需要运行时 bundle 的测试（runtime-bundle、player-controller）要先跑 `npm --prefix miniprogram run build:runtime`。bundle 不存在时，测试用 `throw new Error('先运行 npm --prefix miniprogram run build:runtime')` 失败，不要 skip。

| 文件 | 批次 | 必须覆盖 |
|---|---|---|
| `media-refs.test.ts` | B1 | C.6 列出的全部媒体字段都被收集和改写；emoji 的 `icon` 不动；同一个 key 只生成一个 `mp:<16hex>`；改写后 program 里再扫不到任何 `http`、`/api/storage`、TOS key（安全网）；扫到残留时 build 失败 |
| `preflight.test.ts` | B1 | C.4 每一条检查各一个失败用例和一个通过用例，文案逐字断言 |
| `listing.test.ts` | B1 | 标题、简介、标签（只能是 `MP_TAGS`、1–3 个）、年龄分级的校验；草稿保存不影响已上线版本的 meta（B.3） |
| `release-build.test.ts` | B1 | 11 步按顺序执行；任一步失败 → `build_failed` 并写错误；全局锁 `mp:build:lock` 被占时排队，不并发；成功后 `program`、`manifest` 写入且之后不再更新（R2）；不扣积分 |
| `lifecycle.test.ts` | B1 | D.3 的每个合法流转各一个用例；每个非法流转返回 409 `MP_INVALID_STATE`；`offline`/`ban` 清缓存键（红线 3） |
| `token.test.ts` | B2 | 签发、校验、过期、篡改 payload、篡改签名、换秘钥都要覆盖；剩余有效期不足阈值时响应带 `X-Mp-Token` |
| `auth.test.ts` | B2 | code2session 成功、失败、超时；封禁用户返回 `MP_USER_BANNED`；日志里的 openid 只有前 6 位 |
| `cdn.test.ts` | B2 | A 型鉴权签名与官方示例算法一致（用固定的 key、时间、rand 断言输出）；同一个 6 小时桶内 URL 不变；路径分段编码；未配置且 `MP_ALLOW_TOS_DIRECT≠1` 时抛 503 |
| `dto.test.ts` | B2 | Card、WorkDetail、PlayManifest 的映射只读版本 meta，不读草稿 |
| `api-contract.test.ts` | B2 | J.2 的泄漏守卫和鉴权隔离 |
| `rate-limit-keys.test.ts` | B2 | E.3 每个接口的限流键和阈值 |
| `runtime-bundle.test.ts` | B3 | bundle 用 `vm.runInNewContext` 加载，沙箱里只给 `module`、`exports`、`console`，不给 `window`、`document`、`performance`；F.2 列出的导出全部存在；源码文本不含 `document.`、`window.`、`localStorage`、`HTMLVideoElement`、`react`；体积 ≤ 300KB。超了就停下问用户，不要删导出 |
| `attribution.test.ts` | B3 | H.5 场景值表逐行断言；首触只写一次；`shareId`、`channel` 同时存在时的优先级 |
| `mp-format.test.ts` | B3 | 时长、人数（「1.2 万」）、相对时间的格式化 |
| `player-controller.test.ts` | B4 | J.4 的回放；6 种互动都有成功和失败路径；商店购买扣游戏币；存档、读档、跳检查点；`appHide` 之后计时器暂停；倍速循环与 `toWxRate` 一致 |
| `clock.test.ts` | B4 | timeupdate 外推、50ms tick、暂停和恢复、seek 之后重置 |
| `rates.test.ts` | B4 | `toWxRate` 全表（0.25 → 0.5 等） |
| `hotspot-geo.test.ts` | B4 | 舞台 letterbox 和 pillarbox 下的坐标换算，与 Web 版 `HotspotOverlay` 结果一致 |
| `preload.test.ts` | B4 | 引擎模拟得到的下一段候选，最多预载 1 段，切段后释放 |
| `save-merge.test.ts` | B4 | F.7 合并规则逐条覆盖；`baseRev` 冲突时以合并结果重试；体积超 256KB 时拒绝 |
| `jobs.test.ts` | B5 | 定时上线、预约提醒、更新提醒、聚合都走各自的 Redis 锁；`MP_JOBS_ENABLED=0` 时全部跳过；水位线 `MpJobState` 保证不重复聚合、不漏聚合 |
| `aggregation.test.ts` | B5 | H.7 的 SQL 结果与手算一致（固定的 MpEvent 样本）；`MP_BRANCH_MIN_SAMPLES` 以下的分歧不对外返回 |
| `channels.test.ts` | B5 | 创建、归档、code 唯一；已归档的码扫进来仍然能打开作品，但不再计入渠道 |
| `subscriptions.test.ts` | B5 | 字段映射从 env 读；`errcode 43101`（用户拒收）标记为失效且不重试；每人每作品每类只发一次 |
| `ranking.test.ts` | B5 | hotScore 公式；贝叶斯评分在 `MP_RATING_MIN_COUNT` 以下不进评分榜 |
| `share.test.ts` | B5 | 分享 path 和 query 的拼接；shareId 长度；J.5 的诱导分享守卫 |
| `poster-layout.test.ts` | B5 | 海报布局计算（文字折行、截断、二维码位置），纯函数部分 |

**不能动的既有测试**：`tests/unit/interactive/**` 全部保持绿色。如果某个用例因为 C.3 的抽取变红，修抽取代码，不改用例（R1）。

---

## §L 测试机部署与验收

**原则**：只部署测试机 `45.76.215.9`，不推送、不部署生产（R8）。建议 B1+B2 合起来部署一次，B4、B5 各再部署一次。小程序本身不部署到服务器。

### L.1 打包与构建

完全照最近一次的记录 `docs/deployments/test-tgg-provider-20261116.md` 的「部署机制」一节，只有以下差异：

1. **源码包**：用 `git ls-files` 加 `--others --exclude-standard` 生成清单，额外排除 `miniprogram/`（服务器不需要）。其余过滤规则照旧：Finder 「 2/3/4」 副本、`.env*`、`config/`、`data/`、`*.log`。
2. **连接**：`SSHPASS` 环境变量 + `sshpass -e ssh root@45.76.215.9`。密码不写进任何文件或命令行参数。
3. **构建**：在 `/opt/norivideo-test/app-YYYYMMDD-candidate` 依次执行：
   ```bash
   HUSKY=0 npm ci
   NODE_OPTIONS=--max-old-space-size=3072 npm run build
   npx prisma db push --skip-generate
   ```
   `db push` 只能出现建表。出现 data loss 提示就中止，不加 `--accept-data-loss`，回来问用户。
4. **ffmpeg**：构建前先在服务器上跑 `ffmpeg -version && ffprobe -version`。缺失就停下问用户，不要自己装。
5. **切换**：沿用 swap 脚本的前置校验，停 4 个服务（`norivideo-test-web/worker/watchdog/board`），`mv app app-pre-YYYYMMDD`，`mv app-YYYYMMDD-candidate app`，再起 4 个服务。回退点就是 `app-pre-YYYYMMDD`。新表只增不改，所以回退安全。
6. **R8 再强调一遍**：不碰 `/data`，不用 `lanmiao-prod`。

### L.2 测试机 env

在现网 `.env` 里追加（候选包构建时会复制现网 `.env`，所以只追加一次）：

```bash
MP_ENV_VERSION=trial
MP_ALLOW_TOS_DIRECT=1
MP_JOBS_ENABLED=1
```

- **`MP_JWT_SECRET`** 在服务器上直接生成并追加，不回显：
  ```bash
  grep -q '^MP_JWT_SECRET=' .env || printf 'MP_JWT_SECRET=%s\n' "$(openssl rand -hex 32)" >> .env
  ```
- **`MP_APP_ID`、`MP_APP_SECRET`** 由用户自己写进服务器的 `.env`，agent 不经手。没写的时候：
  - `/api/mp/auth/login` 返回 503 `MP_WX_UNAVAILABLE`；
  - B 端发布、版本生成、后台审核照常可以验收；
  - C 端只能验到「未登录可浏览」的接口。
- **CDN 三个键**在用户配好 CDN（§M 第 8 项）之前不设。不设时走 `MP_ALLOW_TOS_DIRECT=1` 的 TOS 直链回退。

### L.3 服务端验收（无头，SSH 隧道）

```bash
sshpass -e ssh -f -N -L 13000:127.0.0.1:3000 -L 18080:127.0.0.1:8080 root@45.76.215.9
```

用无头 Chromium（仓库已有的 playwright-core）访问 `localhost:13000`（B 端）和 `localhost:18080`（后台），C 端接口用 `curl` 验。

| # | 步骤 | 期望 |
|---|---|---|
| 1 | B 端选一部已有章节和视频的影游，打开总览 | 头部出现「发布到小程序」，没有管理权限的协作者看不到 |
| 2 | 进入发布页，填上架信息并保存 | 草稿保存成功，刷新后还在 |
| 3 | 发布前检查 | 失败项文案与 C.4 一致；全部通过后「生成版本」可点 |
| 4 | 生成版本 | 任务进入 text 队列；完成后版本状态变为「审核中」；TOS 里 `mp/releases/<releaseId>/` 下有 720/480 MP4、海报、末帧、联系表、预告片、program.json |
| 5 | 下载 program.json 检查 | 全文不出现 `http`、`/api/storage`、原始 storage key（R5） |
| 6 | 后台「内容审核」 | 文本清单和联系表齐全；「通过」后状态是 `approved`，「驳回」必须填理由 |
| 7 | 发布页点「立即上线」/「定时上线」 | 立即上线 → `live`；定时上线 → `scheduled`，到点后 watchdog 自动转 `live` |
| 8 | `curl localhost:13000/api/mp/home` 和 `/api/mp/works/<slug>` | 能看到作品；响应里没有红线 2 列出的任何字段 |
| 9 | 发布页「下架」 | `curl` 详情立即返回 404 `MP_WORK_NOT_FOUND`（红线 3）；「重新上线」后恢复 |
| 10 | 再改内容、生成第 2 个版本并上线 | 旧版本的文件和 program 完全没变（R2）；C 端切到新版本 |

- **测试库没有 super_admin**（见 2026-11-16 部署记录），第 6 步会被卡住。卡住时停下，请用户提供一个 super_admin 账号。不要自己建账号，也不要重置任何人的密码。
- 验收截图放 `test-results/mp-platform/`，不提交。

### L.4 部署记录

写 `docs/deployments/test-mp-platform-YYYYMMDD.md`，格式照现有记录，包括：

- 范围与提交表；
- 部署机制（BUILD_ID、db push 输出摘要、回退点）；
- L.3 每一步的结果；
- 测试命令与结果；
- 未完成项和原因（例如「等用户提供 AppID」）；
- 约束遵守（R1–R15 逐条一句）。

记录里不出现任何秘钥、完整 openid 或用户手机号。

### L.5 小程序真机验收（用户扫码）

前提：用户已经完成 §M 第 1、9、13 项。

1. agent 跑 `npm --prefix miniprogram run preview`（`MP_ENV_VERSION` 对应 develop，API 指向测试机），把 `dist-preview/preview-*.png` 的路径告诉用户。
2. 测试机域名 `nori.45-76-215-9.sslip.io` 没法加进合法域名，所以用户扫码后要在小程序右上角「…」里**打开调试**，开发版才不校验域名。
3. 用户按下面的清单逐项回报：
   - 首页、发现、搜索、详情能打开，封面和预告片能播；
   - 竖屏和横屏作品各玩一部，6 种互动至少各触发一次；
   - 中途退出再进，出现「继续上次」，进度正确；
   - 换一台手机登录同一个微信，云存档能合并过来；
   - 打到一个结局，结局卡、成就、图鉴正确；
   - （B5 之后）分享卡片、朋友圈单页、海报保存、渠道码扫码进入、预约和订阅提醒。
4. **上传体验版**（`npm --prefix miniprogram run upload`）要用户先说「可以上传」。**提交审核和正式发布只由用户在后台操作**，agent 不做。

---

## §M 用户在微信后台和云厂商要做的事（agent 做不了）

| # | 事项 | 在哪 | 做完后告诉 agent 什么 | 卡住的批次 |
|---|---|---|---|---|
| 1 | 注册小程序（建议企业主体），生成 AppSecret | mp.weixin.qq.com | 只告诉 AppID。AppSecret 用户自己写进服务器 `.env` | B2 真机登录、B3 预览 |
| 2 | 小程序备案 | 后台「备案」 | 备案完成 | 提审 |
| 3 | 服务类目 | 后台「服务类目」 | 最终选定的类目 | 提审 |
| 4 | 服务器域名：request 和 downloadFile 合法域名都加 `https://lanmiaoai.com`、`https://media.lanmiaoai.com` | 开发管理 → 开发设置 | 已配置 | 正式版 |
| 5 | 基础库最低版本设为 3.0.0 | 设置 → 基础库最低版本 | 已设置 | 正式版 |
| 6 | 用户隐私保护指引：声明「用户昵称」和「相册（仅写入）」 | 设置 → 服务内容声明 | 已声明 | B3 隐私弹窗联调、提审 |
| 7 | 订阅消息：选「作品上线提醒」「更新提醒」两个模板 | 功能 → 订阅消息 | 两个模板 id 和各自的字段 key（不是秘钥，可以直接发） | B5 |
| 8 | CDN 加速域名 `media.lanmiaoai.com`：回源 TOS 私有桶并开回源鉴权，开 A 型鉴权（有效期 12 小时），缓存忽略 URL 参数，配 HTTPS 证书 | 火山引擎 CDN 控制台 | 已配好。鉴权 key 用户自己写进 `.env` | 正式版（测试机可以先用直链回退） |
| 9 | 小程序代码上传密钥：下载到仓库外的路径，例如 `~/.config/norivideo/mp-ci.key`；把跑 CI 那台机器的公网 IP 加进白名单，或者关掉白名单 | 开发管理 → 开发设置 → 小程序代码上传 | 密钥路径（不发内容） | B3 预览 |
| 10 | 关联公众号、视频号（可选，用于宣发投放） | 公众号后台 / 视频号助手 | 已关联 | 不卡 |
| 11 | URL Link（需要非个人主体且已认证） | 默认可用 | 能用之后设 `MP_URL_LINK_ENABLED=1` | 不卡 |
| 12 | 流量主或虚拟支付 | 后台「流量主」/「虚拟支付」 | 选定的路线 | 只有 B6 |
| 13 | 添加体验成员 | 成员管理 | 已添加 | 体验版真机验收 |
| 14 | 提交审核、发布正式版 | 版本管理 | — | 只由用户操作 |

**关于类目和资质（第 3 项）**：互动影游可能被归到视频、微短剧或游戏类，各自要求的许可证不同（例如视听相关许可证、游戏版号）。AIGC 内容的分发还要符合生成式人工智能相关的管理规定。以微信后台当时的类目要求和用户法务的意见为准，agent 不替用户判断。类目没定下来之前，体验版可以照常用，但不能提审。

---

## §N 不做的事（Non-goals）

以下内容 B1–B5 一律不做。用户提出时另出文档（R13）：

- 评论、弹幕、私信、关注创作者、创作者主页的社交关系；
- 充值、真钱商店、会员、签到、任务体系、积分墙；B6 付费单独立项；
- 用户上传头像或任何 UGC 图片和视频，头像只用内置的 8 张；
- HLS 或自适应码流，只有 720/480 两档 MP4；
- C 端多语言，只做简体中文；
- H5 版、App 版、抖音或支付宝小程序；
- 在小程序里创作或编辑影游，创作只在 B 端；
- 推荐算法或个性化推荐，首页只有运营位、榜单、新作；
- 分享奖励、分享解锁、邀请裂变（R6，永远不做）。

---

## 交付物清单（全部完成时应当存在）

- **服务端**：`prisma/schema.prisma` 新增 17 张表，并给 `Work` 加 2 个反向关系；`src/lib/mp/**`；`src/lib/storage/cdn.ts`（2026-11-16 时还不存在，所以新建；如果开工时已经存在，只追加 `mpMediaUrl`）；`src/app/api/mp/**`；`src/app/api/admin/mp/**`；`src/app/api/interactive/[workId]/publish/**`；`src/features/mp-publish/**`；`src/app/[locale]/interactive/[workId]/publish/page.tsx`；`src/app/[locale]/admin/mp-review/**`、`mp-ops/**`、`mp-stats/**`。
- **改动的既有文件**：`service.ts`（C.3）、`task/types.ts`、`queues.ts`、`submitter.ts`、`text.worker.ts`、`PlatformAdminShell.tsx`、`StoryOverview.tsx`、`scripts/watchdog.ts`、`tests/contracts/route-catalog.ts`、`task-type-catalog.ts`、`tsconfig.json`、`eslint.config.mjs`、`.dockerignore`、`.env.example`。**除此以外的既有文件都不应出现在 diff 里**；出现了就说明越界了，回退。
- **小程序**：`miniprogram/` 整个工程，不含生成物。
- **测试**：`tests/unit/mp/*.test.ts`（§K 全表）。
- **记录**：`docs/deployments/test-mp-platform-YYYYMMDD.md`。

文档结束。
