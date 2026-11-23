# LanmiaoTV 前端设计系统「纸面 / 放映」实现方案

日期：2026-11-17 · 执行：qwen4max coding agent · 设计：Claude（本文只给方案，不改业务代码）

> 本文自成一体：架构、调色、每个组件的改法、可直接粘贴的代码、测试命令、提交顺序都在这里。**文档与代码对不上时，停下来问用户（R1），不要猜。**

---

## 0. 概览

### 0.1 一句话

**「纸面用墨，放映用光」。**

- **浅色是「纸面」**：近白纸张，墨黑主按钮，层级靠排版、细线和极轻的阴影。
- **深色是「放映厅」**：中性黑，主按钮用「喵蓝」，像影厅里唯一亮着的屏幕。
- **全站颜色只有三个来源**：
  1. 喵蓝信号色：品牌、选中、进度、开关；
  2. 7 个固定功能色：用在导航图标和页面标签上；
  3. 作品封面：纯色海报，一块底色加一个几何形状。
- **没有装饰渐变、紫色光晕和噪点。**

这套系统从桌面 Nori 前端提炼了 taste（见第 2 节），落到 LanmiaoTV 现有代码结构上。在 `docs/design/2026-11-17-five-visual-directions.md` 的五个方向中，它最接近「03 创作操作系统」。

### 0.2 本轮做什么 / 不做什么

| 做 | 不做 |
|---|---|
| 新增原子色板 `src/styles/tv-tokens.css`，重写 `theme.css` 两套主题值 | 不改布局结构、不改路由、不改业务逻辑 |
| 主按钮（CTA）与品牌指示色拆开：浅色主按钮为墨色，深色为喵蓝，指示器恒为喵蓝 | 不改控件尺寸：工具栏 32px、紧凑 28px、弹窗 CTA 40px 一律不变 |
| 清除剩余紫色、光晕、噪点，所有阴影改为中性 | 不引入 webfont，不用衬线字体 |
| 作品封面从「渐变 + 轨道 + 字幕」改为纯色海报 | 不新增任何渐变（第 12 节白名单里的刻度尺除外） |
| 页面标题前加等宽「频道标签」（PROJECTS / TASKS …） | 不改 h1 文案（多个测试断言了原文） |
| 首页去渐变、去光晕，换成新色板 | 不 push、不部署；默认主题改为浅色（H 批）需用户点头 |
| 渐变守卫脚本跳过 Finder 重复文件 | 不运行 `scripts/theme/tokenize-colors.mjs --write` |

---

## 1. 执行规则（必须遵守）

- **R1 对不上就停。** 本文给出的行号是 2026-11-17 核对过的。若该行内容与文中描述不符，先用文中给的选择器或字符串 grep 定位。如果 grep 也找不到，或找到多处无法判断，**停下来问用户**。
- **R2 先确认工作区干净（批次 0）。** 当前有约 118 个已修改的跟踪文件，属于另一条工作线，其中包括本方案要改的 `canvas.css`、`interactive.css`、`frameos-replica.css`、`frameos-tokens.css`、`theme.css`、`theme-generated.css` 和 `ui-*-glass.css`。这些改动必须先由用户提交或明确交给你处理，否则停下来问。**不要 stash、reset 或 checkout 别人的改动。**
- **R3 每批一个提交。** 按第 15 节的顺序推进，每批通过自己的 DoD 再提交。不 push、不部署、不改服务器。
- **R4 不跑 tokenize 写入。** 禁止运行 `node scripts/theme/tokenize-colors.mjs --write`，也不要手改 `theme-generated.css`。所有覆盖都写进 `theme.css` 末尾（见 6.3）。
- **R5 尺寸不动。**
  - 控件高度 32 / 28 / 40 不变；作品卡高度 342（works-pixel-parity:18）不变；`.fa-title-group` 高 56 不变；侧栏宽 220、标题栏 32 不变。
  - 只改颜色、圆角（文中列明的）、阴影、过渡。
- **R6 不加字体、不加渐变。**
  - 不加 webfont，不加 serif。
  - 不新增 `linear-gradient` / `radial-gradient` / `conic-gradient`，也不新增 `mask-image` 渐变。
  - 不新增 `backdrop-filter`。
- **R7 只改列出的测试。** 第 9.5 节和第 13 节列出了需要更新的测试。其余测试失败一律视为回归，要修代码，不准改测试。
- **R8 跳过 Finder 重复文件。** 文件名形如 `xxx 2.css`、`xxx 3.tsx` 的，一律不读不改。所有 node 脚本都要带 `/ \d+\.[a-z]+$/` 过滤。
- **R9 只用无头方式。** 不打开可见浏览器窗口，不长期挂 dev server。截图用 `test-results/gallery` 工具链（见 16.2）。
- **R10 不动被测试断言的 DOM。**
  - `<h1 className="works-view-title">{selectedWork?.name || '我的项目'}</h1>`
  - `.work-cover-brand` 的 innerText 必须是 `LanmiaoTV`（不能加 text-transform）
  - `.works-project-monogram` 的数量必须是 0
  - `.work-cover` 上的 `contain: paint`
- **R11 字体变量只在 `<body>` 和 replica 块里。** `layout.tsx:87` 把 Geist 字体变量挂在 `<body>` 上。不要在 `:root` 定义 `--fos-font`，也不要在 `tv-tokens.css` 里放字体，否则 `var(--font-geist-sans)` 在 `:root` 上解析不到。
- **R12 组件里不写裸色值。**
  - 组件 CSS 只引用 `--fos-*`、`--nori-*`、`--dm-*`、`--tv-*`、`--cover-*`。
  - 例外有两处：`generative-cover.ts` 的海报色板，以及 `lanmiao-home.css` 顶部的 `--lm-*` 令牌。

---

## 2. 从 Nori 学到的 taste（证据 → 规则）

来源：`~/Desktop/Nori/frontend/desktop_all.jsx:1-49` 的令牌对象 `T`，以及 `~/Desktop/Nori/web/workbench/src/styles.css`。
只读了前端代码，没有读 `.env.local`、`api_config.yaml` 等任何配置或密钥。

| Nori 的做法（出处） | 观察 | LanmiaoTV 规则 |
|---|---|---|
| `T.primary #202020`、hover `#111`，主按钮是墨色（workbench `.primary-button` :432/:455/:464） | 主按钮不用品牌色，用墨色，干净、不抢内容 | 浅色主题 CTA = 墨 `#171A21`，hover `rgb(43 47 56)`，并上浮 1px |
| `T.iris #4D8AF0`、tint `#EEF5FF` | 唯一的彩色是一个偏冷的蓝，只做信号 | 喵蓝 sky 色阶；只用于选中、进度、开关、焦点和链接 |
| `surface #F5F5F5`、hairline `rgba(0,0,0,.10)`、soft `.065` | 底色近白，线条极淡，分两档 | 纸面 `#F4F5F7` / `#FAFBFC` / `#FFF`；边线 `.065` / `.10` / `.16` 三档 |
| 阴影 xs `0 1px 2px .035` … xl `0 28px 70px .12`；按钮 `0 2px 4px .07, inset 0 -1px 0 .10` | 阴影只有黑色、极轻，按钮底部有一条内阴影「压痕」 | 五档中性阴影加按钮压痕；**任何彩色阴影都删掉** |
| `mono: DM Mono`；workbench `.eyebrow`（:263）是等宽、大写、加字距 | 小标签用等宽体，像设备铭牌 | 用 Geist Mono 做 `tv-eyebrow`（11px、大写、字距 .08em），不加新字体 |
| spring `cubic-bezier(.22,1,.36,1)`、ease `cubic-bezier(.25,.1,.25,1)` | 位移用弹簧曲线，颜色用平缓曲线 | 颜色过渡 180ms ease；位移 240ms spring |
| `softSurface rgba(255,255,255,.86)`；`.panel`（:659）白底、细线、几乎无阴影 | 容器存在感很低 | 卡片默认只用 `shadow-xs`，悬停才升到 `md` |
| 选中的筛选是黑色胶囊；分段控件是灰色轨道配白色滑块；Toast 是深色胶囊 | 选中态用「反相」，不用彩色 | `--fos-inverse-*` 做选中胶囊；`--fos-seg-thumb` 做滑块；Toast 用深色胶囊 |
| 空状态是灰色色块加一个墨色 CTA | 空状态不放插画 | 沿用现有空状态，只换令牌 |
| 正文 12.5–13px，信息密 | 工具型密度 | 正文 13/20，次要文字 12/18 |
| Nori 的状态色是单色 | 我们**不照搬**：影游 / 视频任务的状态需要一眼可辨 | 保留成功、警告、危险、信息四色，浅色用深色值，深色用亮色值 |

**一条总原则：** 容器退后，内容和信号向前。彩色只出现在：功能图标的小方块、频道标签的圆点、进度和选中、作品封面。

---

## 3. 架构

### 3.1 四层令牌

```
L0  --tv-*      原子色板（triplet "r g b"）+ 圆角 + 动效     src/styles/tv-tokens.css   :root
       │
L1  --nori-*    主题 triplet：bg / text / primary / cta / brand  src/styles/theme.css
       │        暗色：:root, .nori-force-dark, html[data-nori-theme="light"] .nori-force-dark
       │        亮色：html[data-nori-theme="light"]
       │        + 末尾两块 --nori-s-* / --nori-t-* 紫色映射（6.3.3）
       │
L2  --fos-*     语义令牌：cta / brand-solid / hue / status / border / shadow / toast / seg / inverse
       │        src/styles/frameos-replica.css :8 基础块（暗）、:78 亮色块、:90 frameos-dark 亮色块
       │        src/styles/frameos-tokens.css  [data-theme="frameos-dark"]（:10、:127）
       │        --dm-*（画布）  src/features/canvas/canvas.css :root 块（:6715 起）
       │
L3  组件         只引用 L2（必要时用 L1 的 triplet 做 alpha）
```

`src/app/globals.css` 的导入顺序如下，新文件插在第 4、5 行之间：

```css
@import "tailwindcss";
@import "../styles/ui-tokens-glass.css";
@import "../styles/ui-semantic-glass.css";
@import "../styles/frameos-tokens.css";
@import "../styles/tv-tokens.css";        /* NEW — must come before theme.css */
@import "../styles/theme.css";
@import "../styles/frameos-replica.css";
@import "../styles/nori-auth.css";
```

（以上 7 行为 2026-11-17 核对的原样，只多插一行。若实际顺序不同，按 R1 处理。）

### 3.2 CTA 与品牌分离（核心改动）

现在 `--fos-gradient-cta`、`--fos-brand-solid` 和 `--dm-cta` 都等于 `--fos-primary`，所以「按钮」和「指示器」是同一个紫色。新的分工如下：

| 令牌 | 含义 | 浅色（纸面） | 深色（放映） |
|---|---|---|---|
| `--nori-cta` / `--fos-cta` | 主按钮底色 | 墨 `23 26 33` | 喵蓝 sky-600 `42 111 191` |
| `--nori-cta-hover` | 主按钮悬停 | `43 47 56` | sky-700 `31 87 153` |
| `--nori-brand` / `--fos-brand-solid` | 指示器：进度条、滑块、勾选、开关、序号 | sky-600 | sky-600（两主题相同） |
| `--nori-primary` / `--fos-primary` | 链接、焦点环、选中描边、soft 底色 | sky-600 | sky-400 `95 163 227` |
| `--fos-primary-text` | 彩色文字 | sky-700 `31 87 153` | `142 192 238` |
| `--fos-on-cta` | CTA / 指示器上的文字 | `#fff` | `#fff` |

`--fos-on-cta` 恒为白色。墨色、sky-600、sky-700 上的白字对比度都 ≥ 5:1，所以 `tests/unit/theme-tokenize.test.ts:26-29`「强调色上的白字 → `--fos-on-cta`」的约定依然成立。

旧名字 `--fos-gradient-cta` / `--fos-gradient-cta-hover` / `--fos-gradient-brand` 保留为别名，因为全站还有大量引用：

- `--fos-gradient-cta` 指向 `--fos-cta`
- `--fos-gradient-brand` 指向 `--fos-brand-solid`

用 `--fos-gradient-cta` 做背景的地方共 39 处，它们其实是指示器，需要改成 `--fos-brand-solid`（8.2 节）。否则浅色下进度条会变成黑色。

### 3.3 特异性陷阱（必读）

`theme-generated.css` 的两个选择器：

- **暗色：** `:root, .nori-force-dark, html[data-nori-theme="light"] .nori-force-dark`
- **亮色（约第 882 行）：** `html[data-nori-theme="light"], html[data-nori-theme="light"] :not(.nori-force-dark):not(.nori-force-dark *)`

亮色选择器的第二段**作用于每一个元素**，所以在 `html` 上覆盖 `--nori-s-*` / `--nori-t-*` 是无效的：子元素会被 generated 文件重新赋值。

因此，对 generated 文件里已有的 `--nori-s-*` / `--nori-t-*` 做覆盖时：

1. **必须写两块**，分别照抄上面两个选择器；
2. **必须追加在 `theme.css` 末尾**。`theme.css` 第 1 行 `@import` 了 generated 文件，所以写在末尾才能以相同特异性、更晚的顺序胜出。

`--nori-bg-*`、`--nori-text-*`、`--nori-primary*`、`--nori-cta*`、`--nori-brand*` 不在 generated 文件里，所以写在 `html[data-nori-theme="light"]` 上即可。

`theme.css:97-104` 是一个「每元素」亮色块，它会把 `--fos-success`、`--fos-warning`、`--fos-info` 钉死在每个元素上：

- 这里的 `--fos-info: #2563ad` 要改成 `#2a6fbf`（6.3.2 节）；
- 因为这一块的存在，Toast 内的图标必须用 `currentColor`，不能用 `var(--fos-info)` 这类令牌，否则深色 Toast 上会出现深色图标。

### 3.4 暗色岛规则

`.nori-force-dark` 元素会拿到 L1 的暗色 triplet，但 `--fos-cta` 这类 L2 令牌在 `.fos-app` 上已经算成了浅色值（墨色），岛内只会继承这个算好的值。所以岛内必须重新声明。把下面这条规则放在 `frameos-replica.css` 第 99 行之后，也就是 `[data-theme="frameos-dark"]` 亮色块结束处：

```css
.nori-force-dark {
  --fos-cta: rgb(var(--nori-cta));
  --fos-cta-hover: rgb(var(--nori-cta-hover));
  --fos-gradient-cta: var(--fos-cta);
  --fos-gradient-cta-hover: var(--fos-cta-hover);
  --dm-cta: rgb(var(--nori-cta));
}
```

需要它的岛：

- `lm-home`、`nori-admin-login`、`nori-auth`
- 画布：弹窗遮罩、节点工具栏、全景、视频栏、视频封面、视频开关、工作室弹窗、媒体预览
- `ProductionNode.tsx:64`、`FosWorkPanels.tsx:269`（`works-more-button`）、`FosProductionShot.tsx:98`
- `nori-player`、`nori-video-workspace`

验收标准：浅色主题下，这些岛里的主按钮是喵蓝色，不是墨色。

### 3.5 文件地图

| 文件 | 本方案中的角色 | 批次 |
|---|---|---|
| `src/styles/tv-tokens.css` | 新增，L0 | A |
| `src/app/globals.css` | 加一行 import | A |
| `src/styles/theme.css` | L1 两套主题、状态块、末尾紫色映射 | A |
| `src/styles/frameos-replica.css` | L2 基础与亮色块、岛规则、组件 | A / B / C / D / E |
| `src/styles/frameos-tokens.css` | frameos-dark 子树的品牌、CTA 阴影 | A / B |
| `src/features/canvas/canvas.css` | `--dm-*`、指示器、CTA 文字色、Toast | A / B / C |
| `src/features/canvas/story/story-canvas.css` | CTA 文字色、光晕 | B |
| `src/features/interactive/interactive.css` | 影游 hub、封面 | D / E |
| `src/lib/ui/generative-cover.ts` | 海报生成 | D |
| `src/components/frameos/works/WorkCover.tsx` | 作品封面 DOM | D |
| 4 个页面 TSX | 频道标签 | E |
| `src/styles/lanmiao-home.css` 与 `src/components/home/*` | 首页 | F |
| `scripts/guards/no-decorative-gradients-guard.mjs` | 渐变守卫 | G |
| `src/app/[locale]/layout.tsx`、`useNoriTheme.ts` | 默认浅色 | H（需用户同意） |

---

## 4. 调色板

所有值以 triplet（`r g b`）定义在 `tv-tokens.css`，组件用 `rgb(var(--tv-x))` 或 `rgb(var(--tv-x) / .1)` 引用。括号内为对比度，前景对背景，已逐一计算过。

### 4.1 纸面（浅色中性）

| 令牌 | triplet | hex | 用途 |
|---|---|---|---|
| paper-0 | `244 245 247` | #F4F5F7 | 侧栏、标题栏、最底层 |
| paper-1 | `250 251 252` | #FAFBFC | 页面底色 |
| paper-2 | `255 255 255` | #FFFFFF | 卡片 |
| paper-3 | `255 255 255` | #FFFFFF | 弹窗、菜单 |
| paper-4 | `241 242 245` | #F1F2F5 | 输入框、悬停填充 |
| paper-5 | `230 232 236` | #E6E8EC | 按下、分隔块 |
| ink-1 | `23 26 33` | #171A21 | 标题、正文、浅色 CTA（对 paper-1 为 17.4） |
| ink-hover | `43 47 56` | #2B2F38 | 浅色 CTA 悬停 |
| ink-2 | `58 63 75` | #3A3F4B | 次级正文（10.5） |
| ink-3 | `86 92 105` | #565C69 | 说明文字（6.7） |
| ink-4 | `103 109 121` | #676D79 | 占位、元信息（对 paper-1 为 5.20，对 paper-4 为 4.76） |
| ink-5 | `154 160 170` | #9AA0AA | **仅禁用态**，不得承载需要阅读的信息 |

### 4.2 放映（深色中性）

| 令牌 | triplet | hex | 用途 |
|---|---|---|---|
| screen-0 | `9 10 13` | #090A0D | 侧栏、标题栏 |
| screen-1 | `15 17 21` | #0F1115 | 页面底色 |
| screen-2 | `22 24 29` | #16181D | 卡片 |
| screen-3 | `29 32 38` | #1D2026 | 弹窗、菜单 |
| screen-4 | `37 41 48` | #252930 | 输入框、悬停、Toast |
| screen-5 | `48 52 60` | #30343C | 按下、分段滑块 |
| mist-1 | `243 244 246` | #F3F4F6 | 标题、正文（对 screen-1 为 17.17） |
| mist-2 | `201 205 212` | #C9CDD4 | 次级正文 |
| mist-3 | `162 167 176` | #A2A7B0 | 说明 |
| mist-4 | `138 143 153` | #8A8F99 | 元信息（5.47） |
| mist-5 | `94 99 108` | #5E636C | 仅禁用态 |

### 4.3 喵蓝 sky（品牌与信号）

| 步 | triplet | hex | 用途 |
|---|---|---|---|
| 50 | `238 245 252` | #EEF5FC | 浅色选中底 |
| 100 | `221 235 248` | #DDEBF8 | 海报「喵蓝」底、封面兜底 |
| 200 | `191 217 242` | #BFD9F2 | 浅色描边 |
| 300 | `147 194 230` | #93C2E6 | 深色 primary hover |
| 400 | `95 163 227` | #5FA3E3 | 深色 primary（对 screen-1 为 7.05） |
| 500 | `58 134 214` | #3A86D6 | **只做填充和焦点环**，不做文字 |
| 600 | `42 111 191` | #2A6FBF | 品牌指示器、深色 CTA、浅色 primary（白字 5.09） |
| 700 | `31 87 153` | #1F5799 | CTA 悬停、浅色 primary-text（7.29） |
| 800 | `26 74 130` | #1A4A82 | 品牌按下 |
| 900 | `14 47 90` | #0E2F5A | 海报墨、封面兜底文字 |
| text-dark | `142 192 238` | #8EC0EE | 深色 primary-text（9.24） |

腮红 blush：`100 252 230 227`、`300 244 166 158`、`500 227 107 95`。只给蓝猫插画、空状态的点缀用，不做 UI 状态。

### 4.4 功能色（一个功能一个颜色）

规则：**浅色主题用 solid（深），深色主题用 bright（亮）。** 白色字形或图标放在色块上时，任何主题都用 solid 版，即 `--fos-hue-X-solid`。

| 功能 | solid triplet | solid hex | bright triplet | bright hex | 用在 |
|---|---|---|---|---|---|
| project 项目 | `42 111 191` | #2A6FBF | `95 163 227` | #5FA3E3 | 我的项目、图片类素材 |
| task 任务 | `26 127 82` | #1A7F52 | `61 196 138` | #3DC48A | 我的任务、音频 |
| script 剧本 | `161 95 6` | #A15F06 | `227 165 60` | #E3A53C | 剧本工坊、文本 |
| tool 工具 | `107 80 207` | #6B50CF | `163 144 242` | #A390F2 | 工具箱、视频 |
| canvas 画布 | `184 59 114` | #B83B72 | `236 124 171` | #EC7CAB | 无限画布 |
| interactive 影游 | `185 74 26` | #B94A1A | `240 140 95` | #F08C5F | 互动影游 |
| asset / material 资产 / 素材 | `15 124 120` | #0F7C78 | `61 191 184` | #3DBFB8 | 资产库、素材库 |

媒体别名：image 用 project，video 用 tool，audio 用 task，text 用 script。

`tool` 的紫色 `#6B50CF` / `#A390F2` 是唯一保留的紫色。它只出现在「工具」这个功能的图标块上，不做品牌色，也不做光晕。

### 4.5 状态色

| 状态 | 浅色 | 深色 | soft 底 |
|---|---|---|---|
| success | #146C37 | #3DC48A | 浅 .10 / 深 .14 |
| warning | #B45309 | #E3A53C | 同上 |
| danger | #C42B31（文字同色） | #EF4444，文字 #FF8589 | 同上 |
| info | sky-600 #2A6FBF | sky-400 #5FA3E3 | 同上 |

### 4.6 海报色板（作品封面，field / shape / ink）

| 名称 | 底 field | 形 shape | 墨 ink |
|---|---|---|---|
| 喵蓝 | #DCEBF8 | #3A86D6 | #0E2F5A |
| 薄荷 | #D9F1E5 | #23A26B | #0D3A26 |
| 琥珀 | #F7EBD2 | #C27A0E | #3D2604 |
| 紫藤 | #E6E0FA | #7A5FD9 | #261A5C |
| 玫瑰 | #F8DDE8 | #D24F86 | #4D1230 |
| 朱橙 | #FBE2D8 | #E0612F | #4A1A08 |
| 青碧 | #D4EFEE | #17948F | #07322F |
| 夜场 | #1B1E24 | #93C2E6 | #F3F4F6 |

每张海报 = 一块纯色底 + 一个几何形（太阳 / 地平线 / 舞台 / 光栅）+ 首字母 + 角标「LanmiaoTV」。两个主题下颜色相同，因为海报是「作品」，不是 UI。

---

## 5. 字体、圆角、阴影、动效

### 5.1 字体

- 字体族不变：`var(--font-geist-sans)` 加中文回退。只在 `frameos-replica.css:69` 的 `--fos-font` 里，在 `"PingFang SC"` 之后插入 `"HarmonyOS Sans SC"`。
- 等宽字体沿用 `--fos-font-mono`（Geist Mono）。
- 不加 webfont，不用宋体或衬线。

| 级别 | 字号 / 行高 | 字重 | 用在 |
|---|---|---|---|
| display | 36 / 44 | 700 | 首页大标题（只在 lm-home） |
| h1 | 22 / 30 | 700 | **不改现有 h1 尺寸**；仅新页面使用 |
| h2 | 16 / 24 | 650 | 区块标题 |
| h3 | 14 / 20 | 600 | 卡片标题 |
| body | 13 / 20 | 400 | 正文 |
| sm | 12 / 18 | 400 | 元信息 |
| xs / eyebrow | 11 / 16 | 500 | 等宽、大写、字距 .08em |

字号表是新组件的规范。**现有页面的字号本轮不动**（R5）。

### 5.2 圆角

| 令牌 | 值 | 用在 |
|---|---|---|
| `--tv-r-xs` | 6px | 标签、频道标签、菜单项（菜单项为 8） |
| `--tv-r-sm` | 8px | 分段控件选项 |
| `--tv-r-md` | 10px | 按钮、输入框、分段轨道（`--fos-radius-control`） |
| `--tv-r-lg` | 14px | 卡片（`--fos-radius-card`） |
| `--tv-r-xl` | 20px | 弹窗 |
| `--tv-r-pill` | 999px | Toast、选中胶囊 |

`--fos-radius-tag` 从 4px 改为 6px。

注意：`assignments-replica-contract:78` 断言 replica 中存在字符串 `border-radius: 12px;`（今天有 19 处）。本方案只改令牌和文中列出的几处，其余 `12px` 字面量**保持原样**。

### 5.3 阴影

| 令牌 | 浅色（纸面） | 深色（放映） |
|---|---|---|
| `--fos-shadow-xs` | `0 1px 2px rgb(23 26 33 / .04)` | `inset 0 1px 0 rgb(255 255 255 / .04)` |
| `--fos-shadow-sm` | `0 4px 12px rgb(23 26 33 / .06)` | `0 4px 12px rgb(0 0 0 / .32)` |
| `--fos-shadow-md` | `0 10px 24px rgb(23 26 33 / .08)` | `0 10px 24px rgb(0 0 0 / .40)` |
| `--fos-shadow-lg` | `0 18px 44px rgb(23 26 33 / .10)` | `0 18px 44px rgb(0 0 0 / .48)` |
| `--fos-shadow-xl` | `0 28px 70px rgb(23 26 33 / .14)` | `0 28px 70px rgb(0 0 0 / .56)` |
| `--fos-shadow-btn` | `0 1px 2px rgb(23 26 33 / .10), inset 0 -1px 0 rgb(0 0 0 / .12)` | `inset 0 1px 0 rgb(255 255 255 / .12)` |
| `--fos-shadow-card` | `0 1px 2px rgb(23 26 33 / .04)` | `inset 0 1px 0 rgb(255 255 255 / .04), 0 10px 30px -18px rgb(0 0 0 / .8)` |
| `--fos-shadow-pop` | `0 18px 44px rgb(23 26 33 / .12), 0 0 0 1px rgb(23 26 33 / .06)` | `0 24px 64px -16px rgb(0 0 0 / .7), 0 0 0 1px rgb(255 255 255 / .06)` |

**彩色阴影一律禁止**，包括紫色、蓝色和功能色的 glow。焦点环不算阴影装饰，它是 2px 底色间隔加 2px primary。

### 5.4 动效

| 令牌 | 值 | 用在 |
|---|---|---|
| `--tv-ease` | `cubic-bezier(.25,.1,.25,1)` | 颜色、边框、阴影 |
| `--tv-spring` | `cubic-bezier(.22,1,.36,1)` | 位移、缩放（`--fos-ease` 指向它） |
| `--tv-dur-1` | 120ms | 按下 |
| `--tv-dur-2` | 180ms | 悬停颜色 |
| `--tv-dur-3` | 240ms | 悬停位移 |
| `--tv-dur-4` | 320ms | 弹窗进入 |

规则：

- 悬停时按钮上浮 1px、卡片上浮 2px，不放大，不发光。
- 新增的任何 `animation` 都必须包在 `@media (prefers-reduced-motion: no-preference)` 里。

---

## 6. 可直接粘贴的令牌代码（批次 A）

### 6.1 新文件 `src/styles/tv-tokens.css`

`--tv-` 前缀目前在 `src` 里没有任何使用（0 处），不会冲突。本文件只放 triplet、圆角和动效，**不放字体**（R11）。

```css
:root {
  --tv-paper-0: 244 245 247;
  --tv-paper-1: 250 251 252;
  --tv-paper-2: 255 255 255;
  --tv-paper-3: 255 255 255;
  --tv-paper-4: 241 242 245;
  --tv-paper-5: 230 232 236;
  --tv-ink-1: 23 26 33;
  --tv-ink-2: 58 63 75;
  --tv-ink-3: 86 92 105;
  --tv-ink-4: 103 109 121;
  --tv-ink-5: 154 160 170;
  --tv-ink-hover: 43 47 56;

  --tv-screen-0: 9 10 13;
  --tv-screen-1: 15 17 21;
  --tv-screen-2: 22 24 29;
  --tv-screen-3: 29 32 38;
  --tv-screen-4: 37 41 48;
  --tv-screen-5: 48 52 60;
  --tv-mist-1: 243 244 246;
  --tv-mist-2: 201 205 212;
  --tv-mist-3: 162 167 176;
  --tv-mist-4: 138 143 153;
  --tv-mist-5: 94 99 108;

  --tv-sky-50: 238 245 252;
  --tv-sky-100: 221 235 248;
  --tv-sky-200: 191 217 242;
  --tv-sky-300: 147 194 230;
  --tv-sky-400: 95 163 227;
  --tv-sky-500: 58 134 214;
  --tv-sky-600: 42 111 191;
  --tv-sky-700: 31 87 153;
  --tv-sky-800: 26 74 130;
  --tv-sky-900: 14 47 90;
  --tv-sky-text-dark: 142 192 238;

  --tv-blush-100: 252 230 227;
  --tv-blush-300: 244 166 158;
  --tv-blush-500: 227 107 95;

  --tv-hue-project: 42 111 191;
  --tv-hue-project-bright: 95 163 227;
  --tv-hue-task: 26 127 82;
  --tv-hue-task-bright: 61 196 138;
  --tv-hue-script: 161 95 6;
  --tv-hue-script-bright: 227 165 60;
  --tv-hue-tool: 107 80 207;
  --tv-hue-tool-bright: 163 144 242;
  --tv-hue-canvas: 184 59 114;
  --tv-hue-canvas-bright: 236 124 171;
  --tv-hue-interactive: 185 74 26;
  --tv-hue-interactive-bright: 240 140 95;
  --tv-hue-asset: 15 124 120;
  --tv-hue-asset-bright: 61 191 184;
  --tv-hue-material: 15 124 120;
  --tv-hue-material-bright: 61 191 184;

  --tv-r-xs: 6px;
  --tv-r-sm: 8px;
  --tv-r-md: 10px;
  --tv-r-lg: 14px;
  --tv-r-xl: 20px;
  --tv-r-pill: 999px;

  --tv-spring: cubic-bezier(.22, 1, .36, 1);
  --tv-ease: cubic-bezier(.25, .1, .25, 1);
  --tv-dur-1: 120ms;
  --tv-dur-2: 180ms;
  --tv-dur-3: 240ms;
  --tv-dur-4: 320ms;
}
```

然后在 `src/app/globals.css` 中，把 `@import "../styles/tv-tokens.css";` 插在 `frameos-tokens.css` 和 `theme.css` 两行之间（见 3.1）。

### 6.2 `src/styles/theme.css`

#### 6.2.1 暗色块：替换第 3-24 行

保持选择器不变，只替换花括号里的内容。新增 `--nori-cta*` 和 `--nori-brand*` 四个变量。

```css
:root, .nori-force-dark, html[data-nori-theme="light"] .nori-force-dark {
  --nori-bg-0: var(--tv-screen-0);
  --nori-bg-1: var(--tv-screen-1);
  --nori-bg-2: var(--tv-screen-2);
  --nori-bg-3: var(--tv-screen-3);
  --nori-bg-4: var(--tv-screen-4);
  --nori-bg-5: var(--tv-screen-5);
  --nori-text-1: var(--tv-mist-1);
  --nori-text-2: var(--tv-mist-2);
  --nori-text-3: var(--tv-mist-3);
  --nori-text-4: var(--tv-mist-4);
  --nori-text-5: var(--tv-mist-5);
  --nori-primary: var(--tv-sky-400);
  --nori-primary-hover: var(--tv-sky-300);
  --nori-primary-text: var(--tv-sky-text-dark);
  --nori-cta: var(--tv-sky-600);
  --nori-cta-hover: var(--tv-sky-700);
  --nori-brand: var(--tv-sky-600);
  --nori-brand-hover: var(--tv-sky-700);
  --nori-ink: 255 255 255;
  --nori-a: 1;
  --nori-page-bg: var(--tv-screen-1);
  --nori-color-scheme: dark;
  --nori-asset-tab-active-bg: rgba(255, 255, 255, .16);
  --nori-asset-tab-active-text: #fff;
}
```

第 26-34 行（`--color-white: #ffffff` 那一块，以及 `@theme` 块）**不动**。

> 如果某个测试直接解析 `theme.css` 里的数字 triplet，导致 `var(--tv-…)` 写法失败，就按 R1 停下来，把对应值换成第 4 节表中的字面 triplet，并告知用户。

#### 6.2.2 亮色块：替换第 36-95 行

保留第 75-77 行和第 79-94 行的 `--nori-s-*` / `--nori-t-*` 原样；**删除第 78 行** `--nori-s-c0c6ff: 59 73 183;`，它改由 6.2.3 接管。其余行按下面的内容替换：

```css
html[data-nori-theme="light"] {
  --nori-bg-0: var(--tv-paper-0);
  --nori-bg-1: var(--tv-paper-1);
  --nori-bg-2: var(--tv-paper-2);
  --nori-bg-3: var(--tv-paper-3);
  --nori-bg-4: var(--tv-paper-4);
  --nori-bg-5: var(--tv-paper-5);
  --nori-text-1: var(--tv-ink-1);
  --nori-text-2: var(--tv-ink-2);
  --nori-text-3: var(--tv-ink-3);
  --nori-text-4: var(--tv-ink-4);
  --nori-text-5: var(--tv-ink-5);
  --nori-primary: var(--tv-sky-600);
  --nori-primary-hover: var(--tv-sky-700);
  --nori-primary-text: var(--tv-sky-700);
  --nori-cta: var(--tv-ink-1);
  --nori-cta-hover: var(--tv-ink-hover);
  --nori-brand: var(--tv-sky-600);
  --nori-brand-hover: var(--tv-sky-700);
  --nori-ink: var(--tv-ink-1);
  --nori-a: 1.7;
  --nori-page-bg: var(--tv-paper-1);
  --nori-color-scheme: light;
  --nori-asset-tab-active-bg: var(--fos-primary-soft);
  --nori-asset-tab-active-text: var(--fos-primary-text);
  --nori-text-placeholder-alpha: .7;
  --color-white: #171a21;
  --fos-on-cta: #ffffff;
  --fos-brand-solid: rgb(var(--nori-brand));
  --fos-brand-solid-hover: rgb(var(--nori-brand-hover));
  --fos-shadow-card: 0 1px 2px rgb(23 26 33 / .04);
  --fos-shadow-pop: 0 18px 44px rgb(23 26 33 / .12), 0 0 0 1px rgb(23 26 33 / .06);
  --fos-grain: none;
  --fos-danger-text: #c42b31;
  --fos-warning: #b45309;
  --fos-success: #146c37;
  --nori-dm-line: #e1e3e8;
  --nori-dm-line-strong: #9aa0aa;
  --fos-hue-project: rgb(var(--tv-hue-project));
  --fos-hue-tool: rgb(var(--tv-hue-tool));
  --fos-hue-video: rgb(var(--tv-hue-tool));
  --fos-hue-asset: rgb(var(--tv-hue-asset));
  --fos-hue-canvas: rgb(var(--tv-hue-canvas));
  /* 原第 75-77、79-94 行 --nori-s-* / --nori-t-* 原样保留在这里 */
}
```

（上面那行注释只是给你看的占位，粘贴时换成原来的那些行，不要留注释。）

第 97-104 行的「每元素」状态块只改一个值：

```css
html[data-nori-theme="light"] :not(.nori-force-dark):not(.nori-force-dark *) {
  --nori-s-a9aabb: 92 96 112;
  --nori-s-d5d6e0: 61 64 84;
  --nori-s-8d8ea0: 92 96 112;
  --fos-success: #146c37;
  --fos-warning: #b45309;
  --fos-info: #2a6fbf;
}
```

#### 6.2.3 紫色 → 喵蓝映射：追加在 `theme.css` 末尾

这些 `--nori-s-*` / `--nori-t-*` 原本是 generated 文件里的紫色系。必须用 generated 文件**完全相同**的两个选择器，追加到文件**最后**（原因见 3.3）。数值已核对过对比度：亮色列的 t-* 在白底上 ≥ 7:1，暗色列的 t-* 在 screen-1 上 ≥ 6:1。

```css
:root, .nori-force-dark, html[data-nori-theme="light"] .nori-force-dark {
  --nori-t-8f9bff: 93 169 252;
  --nori-t-c7ccff: 175 212 255;
  --nori-t-c9ceff: 179 214 255;
  --nori-t-8b7bff: 74 150 231;
  --nori-t-a5b4fc: 136 189 250;
  --nori-t-c7d2fe: 183 216 253;
  --nori-t-5b6cff: 55 131 211;
  --nori-t-7c66ff: 59 135 215;
  --nori-t-b8c0ff: 156 201 254;
  --nori-t-7c88ff: 78 153 235;
  --nori-t-8b9bff: 93 168 251;
  --nori-t-2a2f63: 9 54 98;
  --nori-s-7c66ff: 59 135 215;
  --nori-s-7c88ff: 78 153 235;
  --nori-s-828eff: 83 158 240;
  --nori-s-6c5cff: 50 126 206;
  --nori-s-8b7bff: 74 150 231;
  --nori-s-6366f1: 49 126 205;
  --nori-s-5b6cff: 55 131 211;
  --nori-s-7091ff: 81 157 238;
  --nori-s-8f9bff: 93 169 252;
  --nori-s-3265ff: 44 121 200;
  --nori-s-c7ccff: 175 212 255;
  --nori-s-829aff: 90 166 248;
  --nori-s-c9ceff: 179 214 255;
  --nori-s-7e8aff: 80 155 237;
  --nori-s-4b78ff: 59 135 215;
  --nori-s-a5b4fc: 136 189 250;
  --nori-s-c7d2fe: 183 216 253;
  --nori-s-4656d8: 25 106 184;
  --nori-s-c0c6ff: 166 207 254;
  --nori-s-d6daff: 198 224 255;
  --nori-s-5360e8: 40 118 196;
}

html[data-nori-theme="light"], html[data-nori-theme="light"] :not(.nori-force-dark):not(.nori-force-dark *) {
  --nori-t-8f9bff: 4 61 114;
  --nori-t-c7ccff: 1 32 64;
  --nori-t-c9ceff: 1 31 62;
  --nori-t-8b7bff: 2 75 138;
  --nori-t-a5b4fc: 1 47 90;
  --nori-t-c7d2fe: 4 30 57;
  --nori-t-5b6cff: 7 89 161;
  --nori-t-7c66ff: 1 86 158;
  --nori-t-b8c0ff: 1 39 77;
  --nori-t-7c88ff: 6 73 132;
  --nori-t-8b9bff: 4 62 114;
  --nori-t-2a2f63: 115 160 212;
  --nori-s-7c66ff: 132 189 255;
  --nori-s-7c88ff: 120 183 253;
  --nori-s-828eff: 118 181 251;
  --nori-s-6c5cff: 140 193 252;
  --nori-s-8b7bff: 121 184 254;
  --nori-s-6366f1: 138 192 254;
  --nori-s-5b6cff: 136 191 253;
  --nori-s-7091ff: 118 181 252;
  --nori-s-8f9bff: 108 177 253;
  --nori-s-3265ff: 143 194 252;
  --nori-s-c7ccff: 175 212 255;
  --nori-s-829aff: 115 178 250;
  --nori-s-c9ceff: 179 214 255;
  --nori-s-7e8aff: 121 182 251;
  --nori-s-4b78ff: 134 189 252;
  --nori-s-a5b4fc: 117 170 230;
  --nori-s-c7d2fe: 183 216 253;
  --nori-s-4656d8: 155 200 251;
  --nori-s-c0c6ff: 124 164 209;
  --nori-s-d6daff: 198 224 255;
  --nori-s-5360e8: 146 195 251;
}
```

说明：

- 亮色列的 `--nori-s-*` 比较浅，这是 generated 文件的约定。在亮色里，s-* 多用作 `rgb(var(--nori-s-x) / .1~.3)` 的淡底或描边，所以要浅；文字色走 t-*，所以要深。
- 不要「修正」成同一个值。

### 6.3 `src/styles/frameos-replica.css`

#### 6.3.1 基础块：替换第 8-76 行

选择器不变。第 9 行的旧注释删除。第 10-25 行（bg / text / primary / soft / border）保持原样，下面已原样写出。第 57-61 行的 border / fill 同样原样保留。

```css
.fos-app, .fos-viewport-theme, .nori-auth, .nori-admin, .nori-admin-login {
  --fos-bg-0: rgb(var(--nori-bg-0));
  --fos-bg-1: rgb(var(--nori-bg-1));
  --fos-bg-2: rgb(var(--nori-bg-2));
  --fos-bg-3: rgb(var(--nori-bg-3));
  --fos-bg-4: rgb(var(--nori-bg-4));
  --fos-bg-5: rgb(var(--nori-bg-5));
  --fos-text-1: rgb(var(--nori-text-1));
  --fos-text-2: rgb(var(--nori-text-2));
  --fos-text-3: rgb(var(--nori-text-3));
  --fos-text-4: rgb(var(--nori-text-4));
  --fos-text-5: rgb(var(--nori-text-5));
  --fos-primary: rgb(var(--nori-primary));
  --fos-primary-hover: rgb(var(--nori-primary-hover));
  --fos-primary-text: rgb(var(--nori-primary-text));
  --fos-primary-soft: rgb(var(--nori-primary) / .14);
  --fos-primary-border: rgb(var(--nori-primary) / .4);
  --fos-indigo: rgb(var(--tv-hue-tool-bright));
  --fos-cta: rgb(var(--nori-cta));
  --fos-cta-hover: rgb(var(--nori-cta-hover));
  --fos-brand-solid: rgb(var(--nori-brand));
  --fos-brand-solid-hover: rgb(var(--nori-brand-hover));
  --fos-brand-solid-active: rgb(var(--tv-sky-800));
  --fos-gradient-brand: var(--fos-brand-solid);
  --fos-gradient-cta: var(--fos-cta);
  --fos-gradient-cta-hover: var(--fos-cta-hover);
  --fos-cta-shadow: var(--fos-shadow-btn);
  --fos-on-cta: #ffffff;
  --fos-inverse-bg: var(--fos-text-1);
  --fos-inverse-fg: var(--fos-bg-2);
  --fos-success: #3dc48a;
  --fos-success-soft: rgb(61 196 138 / .14);
  --fos-danger: #ef4444;
  --fos-danger-text: #ff8589;
  --fos-danger-soft: rgb(239 68 68 / .14);
  --fos-warning: #e3a53c;
  --fos-warning-soft: rgb(227 165 60 / .14);
  --fos-info: rgb(var(--tv-sky-400));
  --fos-hue-project: rgb(var(--tv-hue-project-bright));
  --fos-hue-task: rgb(var(--tv-hue-task-bright));
  --fos-hue-script: rgb(var(--tv-hue-script-bright));
  --fos-hue-tool: rgb(var(--tv-hue-tool-bright));
  --fos-hue-canvas: rgb(var(--tv-hue-canvas-bright));
  --fos-hue-interactive: rgb(var(--tv-hue-interactive-bright));
  --fos-hue-asset: rgb(var(--tv-hue-asset-bright));
  --fos-hue-material: rgb(var(--tv-hue-material-bright));
  --fos-hue-image: var(--fos-hue-project);
  --fos-hue-video: var(--fos-hue-tool);
  --fos-hue-audio: var(--fos-hue-task);
  --fos-hue-text: var(--fos-hue-script);
  --fos-hue-project-solid: rgb(var(--tv-hue-project));
  --fos-hue-task-solid: rgb(var(--tv-hue-task));
  --fos-hue-script-solid: rgb(var(--tv-hue-script));
  --fos-hue-tool-solid: rgb(var(--tv-hue-tool));
  --fos-hue-canvas-solid: rgb(var(--tv-hue-canvas));
  --fos-hue-interactive-solid: rgb(var(--tv-hue-interactive));
  --fos-hue-asset-solid: rgb(var(--tv-hue-asset));
  --fos-hue-material-solid: rgb(var(--tv-hue-material));
  --fos-border-soft: rgb(var(--nori-ink) / calc(.05 * var(--nori-a)));
  --fos-border-mid: rgb(var(--nori-ink) / calc(.085 * var(--nori-a)));
  --fos-border-strong: rgb(var(--nori-ink) / calc(.14 * var(--nori-a)));
  --fos-fill-soft: rgb(var(--nori-ink) / calc(.035 * var(--nori-a)));
  --fos-fill-mid: rgb(var(--nori-ink) / calc(.07 * var(--nori-a)));
  --fos-sheen: none;
  --fos-shadow-xs: inset 0 1px 0 rgb(255 255 255 / .04);
  --fos-shadow-sm: 0 4px 12px rgb(0 0 0 / .32);
  --fos-shadow-md: 0 10px 24px rgb(0 0 0 / .40);
  --fos-shadow-lg: 0 18px 44px rgb(0 0 0 / .48);
  --fos-shadow-xl: 0 28px 70px rgb(0 0 0 / .56);
  --fos-shadow-btn: inset 0 1px 0 rgb(255 255 255 / .12);
  --fos-shadow-card: inset 0 1px 0 rgb(255 255 255 / .04), 0 10px 30px -18px rgb(0 0 0 / .8);
  --fos-shadow-pop: 0 24px 64px -16px rgb(0 0 0 / .7), 0 0 0 1px rgb(255 255 255 / .06);
  --fos-seg-thumb: rgb(var(--nori-bg-5));
  --fos-toast-bg: rgb(var(--tv-screen-4));
  --fos-toast-fg: rgb(var(--tv-mist-1));
  --fos-toast-border: rgb(255 255 255 / .08);
  --fos-ambient: none;
  --fos-grain: none;
  --fos-focus-ring: 0 0 0 2px var(--fos-bg-1), 0 0 0 4px rgb(var(--nori-primary));
  --fos-ease: var(--tv-spring);
  --fos-font: var(--font-geist-sans), "PingFang SC", "HarmonyOS Sans SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
  --fos-font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", Menlo, monospace;
  --fos-radius-card: 14px;
  --fos-radius-control: 10px;
  --fos-radius-tag: 6px;
  --fos-titlebar-height: 32px;
  --fos-sidebar-width: 220px;
}
```

#### 6.3.2 亮色块：替换第 78-88 行

删除旧的第 79 行 `--nori-primary: 75 86 216;`。现在 primary 只由 `theme.css` 决定。

```css
html[data-nori-theme="light"] :is(.fos-app, .fos-viewport-theme, .nori-admin):not(.nori-force-dark) {
  --fos-primary-soft: rgb(var(--nori-primary) / .10);
  --fos-primary-border: rgb(var(--nori-primary) / .32);
  --fos-success: #146c37;
  --fos-success-soft: rgb(20 108 55 / .10);
  --fos-danger: #c42b31;
  --fos-danger-text: #c42b31;
  --fos-danger-soft: rgb(196 43 49 / .10);
  --fos-warning: #b45309;
  --fos-warning-soft: rgb(180 83 9 / .10);
  --fos-info: rgb(var(--tv-sky-600));
  --fos-indigo: rgb(var(--tv-hue-tool));
  --fos-hue-project: rgb(var(--tv-hue-project));
  --fos-hue-task: rgb(var(--tv-hue-task));
  --fos-hue-script: rgb(var(--tv-hue-script));
  --fos-hue-tool: rgb(var(--tv-hue-tool));
  --fos-hue-canvas: rgb(var(--tv-hue-canvas));
  --fos-hue-interactive: rgb(var(--tv-hue-interactive));
  --fos-hue-asset: rgb(var(--tv-hue-asset));
  --fos-hue-material: rgb(var(--tv-hue-material));
  --fos-border-soft: rgb(var(--tv-ink-1) / .065);
  --fos-border-mid: rgb(var(--tv-ink-1) / .10);
  --fos-border-strong: rgb(var(--tv-ink-1) / .16);
  --fos-fill-soft: rgb(var(--tv-ink-1) / .035);
  --fos-fill-mid: rgb(var(--tv-ink-1) / .06);
  --fos-shadow-xs: 0 1px 2px rgb(23 26 33 / .04);
  --fos-shadow-sm: 0 4px 12px rgb(23 26 33 / .06);
  --fos-shadow-md: 0 10px 24px rgb(23 26 33 / .08);
  --fos-shadow-lg: 0 18px 44px rgb(23 26 33 / .10);
  --fos-shadow-xl: 0 28px 70px rgb(23 26 33 / .14);
  --fos-shadow-btn: 0 1px 2px rgb(23 26 33 / .10), inset 0 -1px 0 rgb(0 0 0 / .12);
  --fos-shadow-card: 0 1px 2px rgb(23 26 33 / .04);
  --fos-shadow-pop: 0 18px 44px rgb(23 26 33 / .12), 0 0 0 1px rgb(23 26 33 / .06);
  --fos-seg-thumb: #ffffff;
  --fos-toast-bg: rgb(var(--tv-ink-1));
  --fos-toast-fg: #ffffff;
  --fos-toast-border: transparent;
}
```

`--fos-hue-image`、`-video`、`-audio`、`-text` 不用重复写。基础块里的别名声明在同一元素上，会自动取到这里覆盖后的值。

#### 6.3.3 frameos-dark 亮色块：替换第 90-99 行，并在其后加岛规则

```css
html[data-nori-theme="light"] [data-theme="frameos-dark"]:not(.nori-force-dark):not(.nori-force-dark *) {
  --fos-success: #146c37;
  --fos-warning: #b45309;
  --fos-info: rgb(var(--tv-sky-600));
  --fos-hue-project: rgb(var(--tv-hue-project));
  --fos-hue-task: rgb(var(--tv-hue-task));
  --fos-hue-script: rgb(var(--tv-hue-script));
  --fos-hue-tool: rgb(var(--tv-hue-tool));
  --fos-hue-video: rgb(var(--tv-hue-tool));
  --fos-hue-canvas: rgb(var(--tv-hue-canvas));
  --fos-hue-interactive: rgb(var(--tv-hue-interactive));
  --fos-hue-asset: rgb(var(--tv-hue-asset));
  --fos-hue-material: rgb(var(--tv-hue-material));
}

.nori-force-dark {
  --fos-cta: rgb(var(--nori-cta));
  --fos-cta-hover: rgb(var(--nori-cta-hover));
  --fos-gradient-cta: var(--fos-cta);
  --fos-gradient-cta-hover: var(--fos-cta-hover);
  --dm-cta: rgb(var(--nori-cta));
}
```

第 101-104 行（stat-tile）不动。第 106-108 行的 `.text-white` 规则只改一个值：把 `--color-white: #161827;` 改为 `--color-white: #171a21;`，和 `theme.css` 保持一致。

### 6.4 `src/styles/frameos-tokens.css`（`[data-theme="frameos-dark"]` 子树）

| 行（约） | 现在 | 改为 |
|---|---|---|
| 42 | `--fos-brand-solid: rgb(var(--nori-primary));` | `--fos-brand-solid: rgb(var(--nori-brand));` |
| 43 | `--fos-brand-solid-hover: rgb(var(--nori-primary-hover));` | `--fos-brand-solid-hover: rgb(var(--nori-brand-hover));` |
| 44 | `--fos-brand-solid-active: rgb(var(--nori-s-5360e8));` | `--fos-brand-solid-active: rgb(var(--tv-sky-800));` |
| 45 | `--fos-accent-purple` | **不动** |
| 98-101 | `--fos-shadow-inset-hi / float / btn-glow / overlay` | **不动**（已是中性黑） |
| ~117 | `--fos-cta-shadow: 0 8px 24px -10px rgb(var(--nori-s-6c5cff) / 0.85), …` | `--fos-cta-shadow: var(--fos-shadow-btn, none);` |
| ~264 | `box-shadow: 0 10px 26px -8px rgba(108, 92, 255, 0.75), inset …` | 见 8.4 光晕清理 |

### 6.5 `src/features/canvas/canvas.css` 的 `:root` 块（约第 6715 行起）

| 行（约） | 改为 |
|---|---|
| 6727 | `--dm-cta: rgb(var(--nori-cta));` |
| 6728 | `--dm-brand: rgb(var(--nori-brand));` |

`--dm-brand` 全文件只被用作 2 处背景和 1 处边框，改成恒定喵蓝是安全的。块内其他 `--dm-*` 不动。

### 6.6 批次 A 完成后应有的效果

- **浅色：** 页面纸白，主按钮墨黑，进度条和开关喵蓝，导航图标块是各自的功能色。
- **深色：** 中性黑底，主按钮喵蓝，没有任何紫色。
- 此时有些 CTA 上的文字可能变成深色、看不清（墨底黑字）。这是批次 B 要修的，**批次 A 的 DoD 不要求修**。

---

## 7. 组件规范（批次 C，均在 `src/styles/frameos-replica.css`）

每一项都写了「行号 → 现在 → 改为」。行号对不上时，用加粗的选择器去 grep。只改列出的属性，同一规则里的其他属性原样保留。

### 7.1 外壳：标题栏、侧栏、Logo

| 行 | 选择器 | 现在 | 改为 |
|---|---|---|---|
| 118 | **`.fos-app`** | `background: var(--fos-grain), var(--fos-ambient), var(--fos-bg-1)` | **不动**（两个令牌已是 `none`） |
| 165 | 标题栏规则 | `background: rgb(var(--nori-bg-0) / 0.55);` | `background: var(--fos-bg-0);` |
| 203 | **`.fos-logo-mark`** | `filter: drop-shadow(0 4px 14px rgba(69, 166, 255, 0.35));` | 删除该行 |
| 206 | **`.fos-logo-text .a`** | `color: var(--fos-primary-text);` | `color: var(--fos-text-1);` |
| 207 | **`.fos-logo-text .b`** | `color: var(--fos-text-1);` | 见下方代码 |
| 283 | 侧栏规则 | `background: transparent;` | `background: var(--fos-bg-0);` |

Logo 的结构不变（`FosShell.tsx:174`、`PlatformAdminShell.tsx:49`：`<span class="a">LanMiao</span><span class="b">TV</span>`），只把「TV」做成一枚喵蓝铭牌：

```css
.fos-logo-text .b {
  display: inline-flex;
  align-items: center;
  height: 18px;
  margin-left: 4px;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--fos-brand-solid);
  color: var(--fos-on-cta);
  font: 600 11px/1 var(--fos-font-mono);
  letter-spacing: .02em;
  vertical-align: 2px;
}
```

### 7.2 积分胶囊

| 行 | 选择器 | 改为 |
|---|---|---|
| 217 | **`.fos-credits`** | `border: 1px solid var(--fos-border-mid);` |
| 227 | **`.fos-credits:hover, .fos-credits[aria-expanded="true"]`** | `{ border-color: var(--fos-border-strong); box-shadow: var(--fos-shadow-sm); }` |
| 229 | **`.fos-cr-badge.blue`** | 保留 background 和 color，`box-shadow: none;` |

### 7.3 侧栏导航

第 352-353 行 **`.fos-nav-item`**：在 `--nav-hue: var(--fos-primary);` 下一行加入：

```css
  --nav-hue-solid: var(--fos-brand-solid);
```

第 372-380 行整体替换为下面的内容。`interactive` 这个 key 在 `FosShell.tsx:54` 已经存在，但目前没有对应的 CSS。

```css
.fos-nav-item.active { background: var(--fos-fill-mid); color: var(--fos-text-1); font-weight: 600; box-shadow: none; }
.fos-nav-item[data-nav="projects"] { --nav-hue: var(--fos-hue-project); --nav-hue-solid: var(--fos-hue-project-solid); }
.fos-nav-item[data-nav="assignments"] { --nav-hue: var(--fos-hue-task); --nav-hue-solid: var(--fos-hue-task-solid); }
.fos-nav-item[data-nav="screenwriter"] { --nav-hue: var(--fos-hue-script); --nav-hue-solid: var(--fos-hue-script-solid); }
.fos-nav-item[data-nav="toolbox"] { --nav-hue: var(--fos-hue-tool); --nav-hue-solid: var(--fos-hue-tool-solid); }
.fos-nav-item[data-nav="canvas"] { --nav-hue: var(--fos-hue-canvas); --nav-hue-solid: var(--fos-hue-canvas-solid); }
.fos-nav-item[data-nav="interactive"] { --nav-hue: var(--fos-hue-interactive); --nav-hue-solid: var(--fos-hue-interactive-solid); }
.fos-nav-item[data-nav="assetHub"] { --nav-hue: var(--fos-hue-asset); --nav-hue-solid: var(--fos-hue-asset-solid); }
.fos-nav-item[data-nav="material"] { --nav-hue: var(--fos-hue-material); --nav-hue-solid: var(--fos-hue-material-solid); }
.fos-nav-item[data-nav="workbench"] { --nav-hue: var(--fos-hue-project); --nav-hue-solid: var(--fos-hue-project-solid); }
```

图标块（**`.fos-nav-icon`**）：

| 行 | 改为 |
|---|---|
| 391 | `background: color-mix(in srgb, var(--nav-hue) 12%, transparent);`（13% → 12%） |
| 392 | `box-shadow: none;` |
| 393 | `transition: background-color var(--tv-dur-2) var(--tv-ease), color var(--tv-dur-2) var(--tv-ease);` |
| 397-401 **`.fos-nav-item.active .fos-nav-icon`** | `{ color: var(--fos-on-cta); background: var(--nav-hue-solid, var(--nav-hue)); box-shadow: none; }` |

为什么激活态用 solid：

- 深色主题下的 bright 色配白色图标，对比度不足 3:1；
- solid 色配白色图标，对比度 ≥ 4.5:1；
- 未激活时用 bright 色调出 12% 的淡底，图标本身用 bright 色，深色背景上清晰可见。

第 415-417 行（**`.fos-nav-count`** 内）：

```css
  background: var(--fos-danger-soft);
  box-shadow: none;
  color: var(--fos-danger-text);
```

### 7.4 头像、卡片、胶囊、频道标签

| 行 | 选择器 | 改为 |
|---|---|---|
| 477 | **`.fos-user-avatar`** | `background: var(--fos-primary-soft); color: var(--fos-primary-text); box-shadow: inset 0 0 0 1px var(--fos-primary-border);`，其余属性保留 |
| 586 | **`.fos-card`** | `border-radius: var(--fos-radius-card); box-shadow: var(--fos-shadow-xs);` |
| 587 | **`.fos-pill`** | 不动 |

在第 587 行之后新增 `tv-eyebrow`，供第 10 节的页面标签使用：

```css
.tv-eyebrow { display: inline-block; color: var(--fos-text-4); font: 500 11px/16px var(--fos-font-mono); letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; }
.tv-eyebrow.is-slug { display: inline-flex; align-items: center; gap: 6px; height: 20px; padding: 0 7px; border-radius: var(--tv-r-xs); background: var(--fos-fill-mid); color: var(--fos-text-3); }
.tv-eyebrow.is-slug::before { width: 6px; height: 6px; flex: none; border-radius: 999px; background: var(--slug-hue, var(--fos-brand-solid)); content: ''; }
.tv-eyebrow[data-hue="project"] { --slug-hue: var(--fos-hue-project); }
.tv-eyebrow[data-hue="task"] { --slug-hue: var(--fos-hue-task); }
.tv-eyebrow[data-hue="script"] { --slug-hue: var(--fos-hue-script); }
.tv-eyebrow[data-hue="tool"] { --slug-hue: var(--fos-hue-tool); }
.tv-eyebrow[data-hue="canvas"] { --slug-hue: var(--fos-hue-canvas); }
.tv-eyebrow[data-hue="interactive"] { --slug-hue: var(--fos-hue-interactive); }
.tv-eyebrow[data-hue="asset"] { --slug-hue: var(--fos-hue-asset); }
.tv-eyebrow[data-hue="material"] { --slug-hue: var(--fos-hue-material); }
```

### 7.5 按钮（第 589-609 行）

只改下面这些行，高度和内边距不变（R5）。

```css
/* 591 */  height: 32px; padding: 0 16px; border-radius: var(--fos-radius-control);
/* 593 */  transition: background-color var(--tv-dur-2) var(--tv-ease), border-color var(--tv-dur-2) var(--tv-ease), color var(--tv-dur-2) var(--tv-ease), box-shadow var(--tv-dur-2) var(--tv-ease), transform var(--tv-dur-3) var(--tv-spring);
/* 598 */  .fos-btn-primary { background: var(--fos-gradient-cta); color: var(--fos-on-cta); box-shadow: var(--fos-shadow-btn); }
/* 599 */  .fos-btn-primary:hover:not(:disabled) { background: var(--fos-gradient-cta-hover); color: var(--fos-on-cta); transform: translateY(-1px); box-shadow: var(--fos-shadow-sm); }
/* 600 */  .fos-btn-primary:disabled { background: var(--fos-bg-4); color: var(--fos-text-4); box-shadow: none; cursor: not-allowed; }
/* 604 */  .fos-btn-soft { background: var(--fos-primary-soft); border-color: var(--fos-primary-border); color: var(--fos-primary-text); }
/* 605 */  .fos-btn-soft:hover:not(:disabled) { background: rgb(var(--nori-primary) / .18); }
/* 608 */  .fos-btn-sm { height: 28px; padding: 0 10px; font-size: 12px; border-radius: var(--fos-radius-control); }
/* 609 */  .fos-btn-lg { height: 40px; padding: 0 20px; font-size: 14px; border-radius: var(--fos-radius-control); }
```

（行首的 `/* 591 */` 只是对照用，粘贴时去掉。）

第 596 行 `.fos-btn:active:not(:disabled) { transform: scale(.98); }` 保留：按下时取消上浮，改为轻压。ghost 和 danger 按钮不动。

### 7.6 输入框（第 611-617 行）

```css
/* 612 */  height: 32px; width: 100%; padding: 0 12px; border-radius: var(--fos-radius-control);
/* 615 */  transition: border-color var(--tv-dur-2) var(--tv-ease), box-shadow var(--tv-dur-2) var(--tv-ease);
/* 617 */  .fos-input:focus { border-color: rgb(var(--nori-primary)); box-shadow: 0 0 0 3px rgb(var(--nori-primary) / .16); }
```

### 7.7 分段控件（第 1179-1181 行）

这是 Nori 的「灰色轨道 + 白色滑块」。深色下滑块为 `bg-5`。

```css
.fos-seg { display: inline-flex; padding: 3px; gap: 3px; border-radius: var(--fos-radius-control); background: var(--fos-fill-mid); border: 1px solid transparent; }
.fos-seg-opt { height: 28px; padding: 0 14px; border: 0; border-radius: var(--tv-r-sm); background: transparent; color: var(--fos-text-2); font-size: 13px; font-weight: 500; }
.fos-seg-opt.active { background: var(--fos-seg-thumb); color: var(--fos-text-1); box-shadow: var(--fos-shadow-xs); font-weight: 600; }
```

### 7.8 弹窗与菜单

| 行 | 选择器 | 改为 |
|---|---|---|
| 1343 | **`.fos-dialog`** | `border-radius: var(--tv-r-xl); box-shadow: var(--fos-shadow-xl);` |
| 1432 | **`.fos-menu`** | `border-radius: 12px; box-shadow: var(--fos-shadow-lg);` |
| 1433 | **`.fos-menu-item`** | `border-radius: var(--tv-r-sm);` |
| 1435 | **`.fos-menu-item:focus-visible`** | `outline: 2px solid rgb(var(--nori-primary) / .7);` |

弹窗进入动画：先 grep `.fos-dialog` 是否已经有 `animation`。**已有就不加。** 没有才加下面这段：

```css
@media (prefers-reduced-motion: no-preference) {
  .fos-dialog { animation: tv-pop var(--tv-dur-4) var(--tv-spring) both; }
}
@keyframes tv-pop { from { opacity: 0; transform: translateY(6px) scale(.985); } to { opacity: 1; transform: none; } }
```

### 7.9 选中态、Tab、指示器

| 行 | 选择器 | 改为 |
|---|---|---|
| 1820 | **`.create-project-pill-row button.is-selected`** | `background: var(--fos-inverse-bg); color: var(--fos-inverse-fg);` |
| 1829 | **`.create-project-duration-tabs button.is-selected`** | 同上 |
| 1928 | **`.create-project-inherit-chips button.is-selected`** | 同上 |
| 1947 | **`.create-project-inherit-tile.is-selected .create-project-inherit-check`** | `border-color: var(--fos-brand-solid); background: var(--fos-brand-solid);` |
| 2189 | **`.fa-tab:focus-visible`** | `box-shadow: 0 0 0 2px rgb(var(--nori-primary) / .6) inset;` |
| 2191 | **`.fa-tab.is-active::after`** | `background: var(--fos-text-1);`（原来是 14% 淡紫，几乎看不见） |
| 3343 | **`.fos-switch.is-on`** | `background: var(--fos-brand-solid); color: var(--fos-on-cta);` |
| 4615 | **`.fos-activity-bars i.is-generated, .fos-activity-dot.is-generated`** | `background: var(--fos-brand-solid);` |

反相胶囊的效果：浅色下是墨底白字，深色下是白底黑字。这就是 Nori 的「黑色选中胶囊」。

### 7.10 Toast

第 2376 行 **`.fa-toast`**：保留定位和尺寸，修改下面这些属性：

```css
  border-radius: 999px;
  border-color: var(--fos-toast-border);
  background: var(--fos-toast-bg);
  color: var(--fos-toast-fg);
  box-shadow: var(--fos-shadow-lg);
```

紧接着新增一条规则。原因见 3.3：每元素状态块会把 info / success 钉成深色。

```css
.fa-toast svg { color: currentColor; }
```

画布里有两条 **`.nori-canvas-toast {`** 规则（`canvas.css` 约第 3983 行和第 5152 行），两条都要在规则内加入或替换下面三个属性：

```css
  border-color: var(--fos-toast-border, transparent);
  background: var(--fos-toast-bg, rgb(var(--tv-ink-1)));
  color: var(--fos-toast-fg, #fff);
```

第 5152 行原有的 `border-color: rgb(var(--nori-t-d8d9e0) / 0.17)` 和 `color: rgb(var(--nori-t-f4f5f9))` 用上面的值替换。第 6629 行只管换行，不动。

### 7.11 后台导航（第 844-855 行）

后台导航没有 solid 映射，所以激活态改为「彩色淡底 + 彩色图标」，不做白字：

| 行 | 选择器 | 改为 |
|---|---|---|
| 850-851 | **`.nori-admin-nav-icon`** | 保留 |
| 854 | **`.nori-admin-nav-item.is-active`** | `background: var(--fos-fill-mid); border-color: transparent; color: var(--fos-text-1);` |
| 855 | **`.nori-admin-nav-item.is-active .nori-admin-nav-icon`** | `color: var(--nav-hue); background: color-mix(in srgb, var(--nav-hue) 18%, transparent); border-color: color-mix(in srgb, var(--nav-hue) 40%, transparent); box-shadow: none;` |

### 7.12 作品卡外框（第 1507-1509 行；封面见第 9 节）

| 行 | 选择器 | 改为 |
|---|---|---|
| 1507 | **`.works-project-card`** | `background: var(--fos-bg-2);`（替换 `rgb(var(--nori-s-14151c))`）；`border: 1px solid var(--fos-border-mid);` |
| 1508 | **`.works-project-card:hover`** | `{ z-index: 4; border-color: var(--fos-border-strong); box-shadow: var(--fos-shadow-md); transform: translateY(-2px); }` |
| 1509 | **`.works-project-card.is-selected`** | `{ border-color: rgb(var(--nori-primary)); box-shadow: 0 0 0 2px rgb(var(--nori-primary) / .28); }` |

卡片的 `border-radius: 14px` 和高度保持不变（works-pixel-parity:18 要求 342）。

### 7.13 画布 hub（`canvas.css`）

| 行 | 选择器 | 改为 |
|---|---|---|
| 3750-3754 | **`.nori-canvas-hub-menu-actions a:hover`** | 加 `color: var(--fos-on-cta);`（基础规则第 3736 行是 text-1）；`box-shadow: var(--fos-cta-shadow, none);` |
| 3819-3822 | **`.nori-canvas-hub-direct-projects > div > button:hover`** | 前三行保留（它们读 `--cover-a`，第 9 节会继续提供） |
| 3823 | 同上 | `box-shadow: var(--fos-shadow-md);` |
| 3767、3855 | hub-message / no-projects 的 a | 已经是 on-cta，只需在 8.4 中去掉光晕 |

---

## 8. 去紫、拆分指示器、修 CTA 文字（批次 B）

批次 B 分四步，**执行顺序是 8.3 → 8.1 → 8.2 → 8.4**。先做字面量替换，计数才对得上。全部做完后运行 8.5 的检查。

### 8.1 B1：CTA 文字色

浅色下 CTA 变成了墨底，所有写了 `color: rgb(var(--nori-text-1))` 的 CTA 文字都会「隐形」。逐条修改：

| 文件 | 选择器（grep 用） | 改为 |
|---|---|---|
| canvas.css ~4863 | **`.nori-video-player-transport button.is-play`** | `color: var(--fos-on-cta);` |
| canvas.css ~4864 | **`.nori-video-player-transport button.is-play:hover:not(:disabled)`** | `color: var(--fos-on-cta); background: rgb(var(--nori-cta-hover));` |
| canvas.css ~4915 | **`.nori-video-inspector-save`** | `color: var(--fos-on-cta);` |
| canvas.css ~4916 | **`.nori-video-inspector-save:hover:not(:disabled)`** | `background: rgb(var(--nori-cta-hover));` |
| canvas.css ~4951 | **`.nori-video-prompt-regenerate`** | `color: var(--fos-on-cta);` |
| canvas.css ~4952 | **`.nori-video-prompt-regenerate:hover:not(:disabled)`** | `background: rgb(var(--nori-cta-hover));` |
| canvas.css ~7434 | **`.nori-canvas-generator-controls .nori-canvas-generate-button`**（第二条） | 加 `color: var(--fos-on-cta);`（第 1921 行那条已有，不动） |
| canvas.css ~7457 | **`.nori-canvas-generator-controls .nori-canvas-generate-button:disabled`** | `color: rgb(var(--nori-text-4)); background: rgb(var(--nori-bg-4));` |
| canvas.css ~7792 | **`.nori-canvas-reference-picker-order`** | `background: var(--fos-brand-solid); color: var(--fos-on-cta);`（它是序号，属于指示器） |
| story-canvas.css ~426 | **`.nori-story-bar button.is-primary`** | `color: var(--fos-on-cta);` |
| story-canvas.css ~734 | **`.nori-story-tips > footer button`** | `color: var(--fos-on-cta);` |

`hover` 用 `rgb(var(--nori-cta-hover))`，不用 `--nori-s-7e8aff`：后者在亮色映射后是浅蓝，会把墨色按钮悬停变成浅蓝白字。

改完后运行审计脚本。它列出所有「背景是 CTA，但文字不是白色」的规则，**输出必须为空**：

```bash
node - <<'EOF'
import fs from 'node:fs'; import path from 'node:path'
const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(!/\/dev$/.test(p))walk(p)}else if(/\.css$/.test(e.name)&&!/ \d+\.[a-z]+$/.test(e.name))files.push(p)}};walk('src')
for(const f of files){const t=fs.readFileSync(f,'utf8');for(const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)){const b=m[2];const bg=(b.match(/background(?:-color)?:\s*([^;]+)/)||[])[1]||'';if(!/^var\(--(fos-gradient-cta|dm-cta|fos-cta)\b/.test(bg.trim()))continue;const col=((b.match(/(?:^|;|\s)color:\s*([^;]+)/)||[])[1]||'').trim();if(/on-cta|^#fff|^white|nori-s-ffffff/.test(col))continue;const line=t.slice(0,m.index).split('\n').length;console.log(f.replace('src/','')+':'+line,'|',m[1].trim().replace(/\s+/g,' ').slice(0,80),'| color:',col.slice(0,50)||'(inherit)')}}
EOF
```

审计脚本会把 `(inherit)` 也报出来，意思是该规则没写 `color`，靠继承。对这类结果，要去看基础规则：

- 基础规则已经是 on-cta / 白色 → 视为通过，在提交说明里列出；
- 否则 → 给这条规则补上 `color: var(--fos-on-cta)`。

### 8.2 B2：指示器从 CTA 改为品牌色

这些地方用 `var(--fos-gradient-cta)`（或 `--dm-cta`）做背景，但它们是**进度、滑块、勾选、序号、连接线**，不是按钮。把背景改成 `var(--fos-brand-solid)`；hover 版本改成 `var(--fos-brand-solid-hover)`。共 39 处，按选择器 grep：

**canvas.css**

- `.nori-canvas-handle:hover, .nori-canvas-surface .react-flow__handle.connecting`（约第 426-430 行，同时把第 430 行的光晕层删掉，只保留 `0 0 0 1px …` 那一层）
- sync-lock 里的 `i`
- `video-edit-progress b`
- `video-edit-marker`
- 两处 `resize-handle`
- `project-assets-check.is-selected`
- `focus-box::before`、`focus-box::after`
- `video-operation-region::before`、`video-operation-region::after`
- `studio-orientation i:nth-child(2)` 及其 `::after`
- 两处 `generator-tether` 及其 `::after`
- `batch-connect-target::after`

**frameos-replica.css**

- `works-project-check.is-on`、`works-candidate-check`
- `fvr-source-index`
- `fvr-range-timecodes i`、`fvr-range-timecodes i.is-end`
- `fvr-range-slider-track span`
- `fvr-range-slider` 的 4 个滑块伪元素
- `frc-trim-slider span` 及其 4 个滑块伪元素
- `fos-switch.is-on`（7.9 已改）
- `rv2-pg-progress span`
- `fac-trim b` 及其 2 个滑块伪元素
- `fac-shot-status i`
- `fac-review-range-track i` 及其 2 个滑块伪元素

**以下是真按钮，保持 CTA，不要改：**

- `works-new-project:hover`
- `fa-video-add`
- `fvr-add`（2 处）
- `hub-message a:hover`
- `hub-no-projects a:hover`

TSX 中没有把 gradient-cta、brand、cta 令牌用作文字色的地方。`FosTimbre.tsx:376` 的 `bg-[var(--fos-primary)]` 是指示器，可以不动。

数量对不上 39 时，以「是不是按钮」为判断标准：

- 有文字、能点、触发动作 → CTA；
- 表示状态或位置 → brand-solid。

拿不准就列出来问用户。

### 8.3 B3：紫色字面量替换（只改 CSS）

先 dry-run。2026-11-17 改动前的计数为 **67**：canvas 35、story-canvas 1、interactive 4、replica 24、frameos-tokens 2、nori-auth 1。

批次 A 的 6.3.1 会重写 replica 第 36 行（`--fos-cta-shadow`）和第 67 行（`--fos-focus-ring`），这两处各含 1 个紫色字面量。所以批次 A 完成后，dry-run 应为 **65**，其中 replica 为 22。不符就停下来问。

```bash
cat > /tmp/tv-purple-codemod.mjs <<'EOF'
import fs from 'node:fs'; import path from 'node:path'
const WRITE = process.argv.includes('--write')
const re = /rgba?\(\s*(?:110\s*,\s*123\s*,\s*255|124\s*,\s*102\s*,\s*255|108\s*,\s*92\s*,\s*255|139\s*,\s*123\s*,\s*255|155\s*,\s*107\s*,\s*255|99\s*,\s*102\s*,\s*241)\s*(?:,\s*([\d.]+)\s*)?\)/g
const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(!/\/dev$/.test(p))walk(p)}else if(/\.css$/.test(e.name)&&!/ \d+\.[a-z]+$/.test(e.name)&&!p.endsWith('lanmiao-home.css'))files.push(p)}};walk('src')
let total=0
for(const f of files){const t=fs.readFileSync(f,'utf8');const n=(t.match(re)||[]).length;if(!n)continue;total+=n;console.log(n,f)
 if(WRITE)fs.writeFileSync(f,t.replace(re,(_,a)=>a===undefined?'rgb(var(--nori-primary))':`rgb(var(--nori-primary) / ${a})`))}
console.log('total',total,WRITE?'written':'dry-run')
EOF
node /tmp/tv-purple-codemod.mjs          # dry-run, expect total 67
node /tmp/tv-purple-codemod.mjs --write
```

脚本**只扫 `.css`**。如果在 TSX 里替换，会把 Tailwind 任意值写出空格，导致类名失效。TSX 里的 4 处手工改：

| 文件:行 | 现在 | 改为 |
|---|---|---|
| `src/components/frameos/views/FosScriptReview.tsx:239` | 紫色 rgba 边框字符串 | `'1px solid rgb(var(--nori-primary) / .5)'` |
| `src/components/frameos/views/FosScriptReview.tsx:240` | 紫色 rgba 背景字符串 | `'rgb(var(--nori-primary) / .14)'` |
| `src/components/ui/CapsuleNav.tsx:78` | `shadow-[0_8px_24px_-10px_rgba(108,92,255,.85)]` | `shadow-[var(--fos-shadow-sm)]` |
| `FrameServiceRecordsDashboard.tsx:388`（`src/components/workspace/` 下，grep 定位） | `hover:bg-[rgba(110,123,255,.22)]` 和 `text-on-brand` | `hover:bg-[rgb(var(--nori-primary)/.22)]` 和 `text-[var(--fos-primary-text)]` |

最后一处顺带修掉一个可读性 bug：浅色下淡色底配白字，原来根本看不清。

Tailwind 任意值里**不能有空格**，所以要写 `rgb(var(--nori-primary)/.22)`。

### 8.4 B4：光晕清理

规则：**彩色、模糊半径 ≥ 8px、非 inset 的阴影层**一律删掉或换成中性阴影。

- 小指示器（圆点、徽章、开关）：直接删掉这一层。
- 按钮：换成 `var(--fos-shadow-btn)`，悬停时换成 `var(--fos-shadow-sm)`。
- 卡片或大块：换成 `var(--fos-shadow-md)`。
- 同一条 `box-shadow` 里的中性层、`inset` 层保留。

2026-11-17 扫出来 16 处：

| 位置 | 归类 | 改为 |
|---|---|---|
| canvas.css:430 handle 光晕 | 指示器 | 删除该层 |
| canvas.css:3753 hub-menu a:hover 回退值 | 按钮 | 在本步直接应用 7.13 的改法：`var(--fos-cta-shadow, none)`，并加 on-cta |
| canvas.css:3762 hub-message > i | 大图标块 | `var(--fos-shadow-md)` |
| canvas.css:3767 hub-message > a | 按钮 | `var(--fos-shadow-btn)` |
| canvas.css:3855 hub-no-projects > a | 按钮 | `var(--fos-shadow-btn)` |
| canvas.css:4863 transport is-play | 按钮 | `var(--fos-shadow-btn)` |
| canvas.css:4915 video-inspector-save | 按钮 | `var(--fos-shadow-btn)` |
| story-canvas.css:426 story-bar is-primary | 按钮 | `var(--fos-shadow-btn)` |
| replica:227 credits hover | 胶囊 | 在本步直接应用 7.2 第 227 行的改法 |
| replica:229 cr-badge.blue | 徽章 | 在本步直接应用 7.2：`box-shadow: none` |
| replica:1508 works card hover | 卡片 | 在本步直接应用 7.12 第 1508 行的改法 |
| replica:3189 `.create-card--flagship .create-card-icon-wrap` | 图标块 | 删除彩色层，保留 inset 层 |
| replica:3369 `.rv2-node--active .rv2-dot` | 指示器 | `box-shadow: none`；背景改 `var(--fos-brand-solid)` |
| replica:3415 `.rv2-mode-btn--active` | 选中按钮 | `box-shadow: none` |
| replica:3428 `.rv2-upload-icon-box` | 图标块 | 删除彩色层；背景改 `var(--fos-brand-solid)` |
| frameos-tokens.css:264 | 按钮 | `box-shadow: var(--fos-shadow-btn, none);` |

列表扫描脚本：

```bash
cat > /tmp/tv-glow-list.mjs <<'EOF'
import fs from 'node:fs'; import path from 'node:path'
const purple = /rgba?\(\s*(?:110\s*,\s*123\s*,\s*255|124\s*,\s*102\s*,\s*255|108\s*,\s*92\s*,\s*255|139\s*,\s*123\s*,\s*255|155\s*,\s*107\s*,\s*255|99\s*,\s*102\s*,\s*241)|rgb\(var\(--nori-(?:primary|s-7c66ff|s-6c5cff|s-6366f1|s-8b7bff|s-828eff)\)/
const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(!/\/dev$/.test(p))walk(p)}else if(/\.(css|tsx|ts)$/.test(e.name)&&!/ \d+\.[a-z]+$/.test(e.name)&&!p.endsWith('lanmiao-home.css'))files.push(p)}};walk('src')
let n=0
for(const f of files){fs.readFileSync(f,'utf8').split('\n').forEach((l,i)=>{const m=l.match(/box-shadow\s*:\s*([^;}]+)/);if(!m)return;const layers=m[1].split(/,(?![^()]*\))/);for(const L of layers){if(!purple.test(L))continue;const nums=L.replace(/rgba?\([^)]*\)|var\([^)]*\)\)?/g,'').trim().split(/\s+/).filter(x=>/^-?[\d.]+px$|^0$/.test(x)).map(parseFloat);const blur=nums[2]||0;if(blur>=8&&!/inset/.test(L)){n++;console.log(f+':'+(i+1)+'  '+L.trim().slice(0,90))}}})}
console.log('glow layers',n)
EOF
node /tmp/tv-glow-list.mjs
```

脚本同时匹配 codemod 之后的 `rgb(var(--nori-primary)…)` 形式，所以 8.3 之前或之后跑都可以。**批次 B 结束时输出必须是 `glow layers 0`。**

### 8.5 批次 B 的检查

```bash
node /tmp/tv-purple-codemod.mjs                    # total 0
node /tmp/tv-glow-list.mjs                         # glow layers 0
# 8.1 的 CTA 审计脚本                                # 无输出，或只剩已确认继承白字的 (inherit)
```

---

## 9. 作品封面：纯色海报（批次 D）

### 9.1 设计

没有真实封面时，用一张「海报」代替：

- 纯色底（field）；
- 一个几何形（shape），共四种：太阳、地平线、舞台、光栅；
- 左下角是蓝猫标和 `LanmiaoTV` 字样，颜色用 ink；
- 右上角是规格标签（比例 / 分辨率 / 集数），保持现状。

规则：

- 色板和形状都由项目 id 哈希决定，同一项目永远是同一张海报。
- 两个主题下颜色相同，因为海报是作品，不是 UI。
- 作品卡封面**不放大号首字母**。`project-hierarchy.browser.mjs:296` 的断言说明写的是「Default covers use branded artwork rather than a large monogram」，所以这是之前定下的取舍，我们遵守。
- 影游 hub 卡片、影游总览、章节节点本来就有首字母，保留，只把颜色改成 `--cover-ink`。

### 9.2 `src/lib/ui/generative-cover.ts`：整体替换

`hashSeed` 和 `coverMonogram` 保持不变。`--cover-a` 必须继续输出，因为 `canvas.css:3820-3822` 和 `interactive.css` 第 382、410、517、518 行都在读它。

```ts
import type { CSSProperties } from 'react'

// [field, shape, ink]: solid poster colours shared by both themes, since covers are content rather than chrome.
const POSTER_PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ['#dcebf8', '#3a86d6', '#0e2f5a'],
  ['#d9f1e5', '#23a26b', '#0d3a26'],
  ['#f7ebd2', '#c27a0e', '#3d2604'],
  ['#e6e0fa', '#7a5fd9', '#261a5c'],
  ['#f8dde8', '#d24f86', '#4d1230'],
  ['#fbe2d8', '#e0612f', '#4a1a08'],
  ['#d4efee', '#17948f', '#07322f'],
  ['#1b1e24', '#93c2e6', '#f3f4f6'],
]

type PosterShape = {
  left: string
  top: string
  width: string
  height?: string
  ratio?: string
  radius: string
  shadow?: string
}

const POSTER_SHAPES: ReadonlyArray<PosterShape> = [
  { left: '58%', top: '28%', width: '24%', ratio: '1', radius: '50%' },
  { left: '0%', top: '78%', width: '100%', height: '22%', radius: '0' },
  { left: '24%', top: '74%', width: '52%', ratio: '2', radius: '999px 999px 0 0' },
  { left: '72%', top: '0%', width: '8px', height: '100%', radius: '0', shadow: '16px 0 0 var(--cover-a), 32px 0 0 var(--cover-a)' },
]

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function generativeCoverStyle(seed: string): CSSProperties {
  const hash = hashSeed(seed || 'lanmiao')
  const [field, shape, ink] = POSTER_PALETTES[hash % POSTER_PALETTES.length]
  const form = POSTER_SHAPES[(hash >>> 8) % POSTER_SHAPES.length]
  return {
    '--cover-base': field,
    '--cover-a': shape,
    '--cover-b': shape,
    '--cover-ink': ink,
    '--cover-shape-left': form.left,
    '--cover-shape-top': form.top,
    '--cover-shape-width': form.width,
    '--cover-shape-height': form.height ?? 'auto',
    '--cover-shape-ratio': form.ratio ?? 'auto',
    '--cover-shape-radius': form.radius,
    '--cover-shape-shadow': form.shadow ?? 'none',
  } as CSSProperties
}

export function coverMonogram(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'L'
  const first = Array.from(trimmed)[0]
  return /[a-z]/i.test(first) ? first.toUpperCase() : first
}
```

`--cover-x1`、`--cover-y1`、`--cover-x2`、`--cover-y2`、`--cover-angle` 不再输出。已核对：除了下面要删除的渐变规则，没有任何地方读取它们。

调用方不用改：

- `WorkCover.tsx`
- `InteractiveHub.tsx:100`
- `StoryOverview.tsx:97`
- `StoryWorksCanvas.tsx:108`
- `StoryProductionCanvas.tsx:85`
- `StoryChapterNode.tsx:51`（style 写在外层 `.nori-ix-chapter` 上，第 53 行的封面 div 继承）

### 9.3 `src/components/frameos/works/WorkCover.tsx`：替换第 27-42 行

imports 不变：`AppIcon` 仍用于 specs，`Image` 和 `BRAND_ASSETS` 仍用于品牌标。

```tsx
      {imageUrl ? <Image className="work-cover-image works-project-cover-image" src={imageUrl} alt="" fill unoptimized sizes="320px" /> : (
        <span className="work-cover-art">
          <span className="work-cover-shape" />
          <span className="work-cover-brand">
            <Image src={BRAND_ASSETS.mark} alt="" width={18} height={16} unoptimized />
            <span>Lanmiao<b>TV</b></span>
          </span>
        </span>
      )}
```

必须保持的 DOM：

- `data-testid="work-generative-cover"`
- `.work-cover-art`
- `.work-cover-brand` 的 innerText 为 `LanmiaoTV`
- `.work-cover-specs` 包含比例
- 没有封面时 `.works-project-cover-image` 数量为 0

### 9.4 `src/styles/frameos-replica.css`：封面 CSS

| 行 | 操作 |
|---|---|
| 1512 **`.work-cover`** | 只改两个属性：`background: var(--cover-base, rgb(var(--tv-sky-100))); color: var(--cover-ink, rgb(var(--tv-sky-900)));`。`contain: paint`、高度 156、圆角 `13px 13px 0 0` 保持不变 |
| 1514 **`.work-cover-art`** | 整行替换为 `.work-cover-art { position: absolute; inset: 0; overflow: hidden; isolation: isolate; }` |
| 1515-1540 | **全部删除**：`::before` 网格、orbit、旧 brand 三行、scene、track、caption。然后在原位置粘贴下方代码 |
| 1541 | 不动 |
| 1542 **`.work-cover-specs > span`** | `border-color: transparent; background: rgb(255 255 255 / .88); color: rgb(var(--tv-ink-1));`，其余保留 |
| 1543 **`.work-cover-specs svg`** | `color: var(--cover-ink);` |
| 1544 | 不动（有真实封面时的规格标签） |
| 1546-1547 | 保留（compact 下的品牌标位置） |
| 1548 | 从选择器列表中删去 `.work-cover-orbit`、`.work-cover-scene`、`.work-cover-track`、`.work-cover-caption` 四项，因为这些 DOM 已经不存在；其余项和声明保留 |

粘贴到原第 1515 行位置的代码：

```css
.work-cover-shape { position: absolute; left: var(--cover-shape-left, 58%); top: var(--cover-shape-top, 28%); width: var(--cover-shape-width, 24%); height: var(--cover-shape-height, auto); aspect-ratio: var(--cover-shape-ratio, 1); border-radius: var(--cover-shape-radius, 50%); background: var(--cover-a, rgb(var(--tv-sky-500))); box-shadow: var(--cover-shape-shadow, none); }
.work-cover-brand { position: absolute; left: 16px; bottom: 14px; z-index: 1; display: flex; align-items: center; gap: 6px; }
.work-cover-brand > img { width: 18px; height: 16px; object-fit: contain; }
.work-cover-brand > span { color: var(--cover-ink, rgb(var(--tv-sky-900))); font: 700 12px/1 var(--fos-font); letter-spacing: -.02em; white-space: nowrap; }
.work-cover-brand b { font-weight: 800; }
```

注意：

- `.work-cover-brand` **不能加 `text-transform`**（R10）。
- 不要用 `.works-project-monogram` 这个类名。
- 地平线和光栅的 `--cover-shape-height` 是百分比，会让 `aspect-ratio` 失效，这是预期行为。
- 其余 `--cover-shape-height` 是 `auto`，由 `aspect-ratio` 决定高度。

### 9.5 `src/features/interactive/interactive.css`：影游封面与 hub

| 行 | 选择器 | 改为 |
|---|---|---|
| 338-349 | **`.nori-ix-hero`** | `border: 1px solid var(--fos-border-mid); background: var(--fos-bg-2); box-shadow: var(--fos-shadow-xs);`，其余保留 |
| 350 | **`.nori-ix-hero::after`** | 整行删除（噪点） |
| 353 | **`.nori-ix-eyebrow`** | 整行替换为 `.nori-ix-eyebrow { display: inline-flex; width: fit-content; height: 20px; align-items: center; gap: 6px; border-radius: var(--tv-r-xs); padding: 0 7px; background: var(--fos-fill-mid); color: var(--fos-text-3); font: 500 11px/16px var(--fos-font-mono); letter-spacing: .08em; }` |
| 354 | **`.nori-ix-eyebrow svg`** | `width: 12px; height: 12px; color: var(--fos-hue-interactive);` |
| 359 | **`.nori-ix-steps li`** | 背景改为 `var(--fos-bg-1)`；如果有 `backdrop-filter`，删除 |
| 360 | **`.nori-ix-steps b`** | `color: var(--fos-hue-interactive);` |
| 382 | **`.nori-ix-card:hover`** | `{ border-color: var(--fos-border-strong); box-shadow: var(--fos-shadow-md); transform: translateY(-2px); }` |
| 384 | 注释 | 删除 |
| 385-391 | **`.nori-gen-cover`** | 见下方代码 |
| 392-399 | **`.nori-gen-cover::before`** | 见下方代码 |
| 401 | **`.nori-ix-card-monogram`** | `color: var(--cover-ink, rgb(var(--nori-text-1)));`，删除 `mix-blend-mode` |
| 402 | **`.nori-ix-card-frame`** | `border-color: color-mix(in srgb, var(--cover-ink, rgb(var(--nori-text-1))) 40%, transparent); background: rgb(255 255 255 / .72); box-shadow: none;`，有 `backdrop-filter` 就删除 |
| 466 | **`.nori-ix-ov-cover b`** | `color: var(--cover-ink, rgb(var(--nori-text-1)));` |
| 521 | **`.nori-ix-chapter-order`** | `color: rgb(var(--tv-ink-1)); background: rgb(255 255 255 / .88);`，有 `backdrop-filter` 就删除 |
| 527 | **`.nori-ix-chapter-monogram`** | `color: var(--cover-ink, rgb(var(--nori-text-1)));`，删除 `mix-blend-mode` |

`.nori-gen-cover` 和它的 `::before` 替换为：

```css
.nori-gen-cover {
  isolation: isolate;
  background: var(--cover-base, rgb(var(--tv-sky-100)));
}
.nori-gen-cover::before {
  position: absolute;
  left: var(--cover-shape-left, 58%);
  top: var(--cover-shape-top, 28%);
  width: var(--cover-shape-width, 24%);
  height: var(--cover-shape-height, auto);
  aspect-ratio: var(--cover-shape-ratio, 1);
  border-radius: var(--cover-shape-radius, 50%);
  background: var(--cover-a, rgb(var(--tv-sky-500)));
  box-shadow: var(--cover-shape-shadow, none);
  content: '';
}
```

`InteractiveHub.tsx:63` 的眉标文案 `影游画布` **保持中文**。`tests/browser/lanmiaotv-ux-a.fixture.tsx` 和 `create-project-story-guard.test.ts` 引用了这几个字，所以只改样式。

### 9.6 测试更新

**改 `tests/unit/interactive/fresh-story-neutral.test.ts` 第 63-66 行。** 只改这 4 行 `expect(css)`，上面 4 行对 `StoryOverview.tsx` 的断言保留。

```ts
    expect(css).toContain('.nori-gen-cover {')
    expect(css).toContain('background: var(--cover-base')
    expect(css).toContain('.nori-gen-cover::before')
    const coverStart = css.indexOf('.nori-gen-cover {')
    const coverRules = css.slice(coverStart, css.indexOf('.nori-ix-card-cover', coverStart))
    expect(coverRules).not.toContain('gradient')
```

**新增 `tests/unit/ui/generative-cover.test.ts`：**

```ts
import { describe, expect, it } from 'vitest'
import { coverMonogram, generativeCoverStyle } from '@/lib/ui/generative-cover'

const HEX = /^#[0-9a-f]{6}$/

describe('generativeCoverStyle poster', () => {
  it('is deterministic per seed', () => {
    expect(generativeCoverStyle('project-a')).toEqual(generativeCoverStyle('project-a'))
  })

  it('emits solid hex colours and no gradients', () => {
    const style = generativeCoverStyle('project-b') as Record<string, string>
    for (const key of ['--cover-base', '--cover-a', '--cover-b', '--cover-ink']) {
      expect(style[key]).toMatch(HEX)
    }
    expect(JSON.stringify(style)).not.toContain('gradient')
  })

  it('spreads seeds across palettes and shapes', () => {
    const palettes = new Set<string>()
    const shapes = new Set<string>()
    for (let index = 0; index < 200; index += 1) {
      const style = generativeCoverStyle(`seed-${index}`) as Record<string, string>
      palettes.add(style['--cover-base'])
      shapes.add(`${style['--cover-shape-left']}|${style['--cover-shape-top']}`)
    }
    expect(palettes.size).toBeGreaterThanOrEqual(6)
    expect(shapes.size).toBe(4)
  })

  it('keeps the monogram helper unchanged', () => {
    expect(coverMonogram('')).toBe('L')
    expect(coverMonogram('rain')).toBe('R')
    expect(coverMonogram('雨夜')).toBe('雨')
  })
})
```

`@/` 在 `vitest.config.ts:13` 已映射到 `src`，可以直接用。

---

## 10. 页面「频道标签」（批次 E）

### 10.1 设计

每个主页面的 h1 前加一枚等宽小标签，形如「● PROJECTS」，圆点是该功能的颜色。作用：

- 让用户一眼认出自己在哪个「频道」，呼应蓝猫电视的品牌；
- 把功能色从侧栏带到页面里，但只占一个 6px 的点。

**h1 本身一个字都不改**（R10）。标签作为 h1 的前一个兄弟节点插入，不增加标题区高度。

标签统一写法（CSS 在 7.4 已加）：

```tsx
<span className="tv-eyebrow is-slug" data-hue="project">PROJECTS</span>
```

### 10.2 放置位置

| 文件:行 | 插入位置 | 文案 | data-hue | 额外 CSS |
|---|---|---|---|---|
| `src/components/frameos/FosProjectsClient.tsx:480` | `.works-heading` 内、`<h1 className="works-view-title">` 之前 | `PROJECTS` | `project` | 无（`.works-heading` 是 flex、居中、gap 12） |
| `src/components/frameos/FosAssignmentsClient.tsx:499` | `<div className="fa-title-group">` 内、`<h1>我的任务</h1>` 之前 | `TASKS` | `task` | 见下 |
| `src/components/frameos/views/FosScreenwriter.tsx:137` | `.writer-page-header` 内、`<h1>编剧工作台</h1>` 之前 | `SCRIPT` | `script` | 无（已是 flex、居中、gap 10） |
| `src/components/frameos/views/FosToolbox.tsx:789` | `.fos-toolbox-header` 内、`<h1 …>工具箱</h1>` 之前 | `TOOLBOX` | `tool` | 无（已是 flex、居中、gap-3） |

`.fa-title-group` 是 `align-items: flex-end`，需要在 replica 第 2017 行之后加两条规则：

```css
.fa-title-group { gap: 10px; }
.fa-title-group .tv-eyebrow { align-self: flex-end; margin-bottom: 2px; }
```

**不要碰** `.fos-sidebar.is-collapsed + .fos-main .fa-title-group { padding-left: 81px; }` 这条规则，`shell-sidebar-collapse` 测试依赖它。

要求：

- 标签必须在 h1 之前，并且和 h1 在同一行。
- 窄屏换行时，标签可以单独占一行，这由原有的 `flex-wrap` 决定，不要另加规则。

如果某个几何测试断言了 h1 的 x 坐标并因此失败，停下来问用户。**不要擅自把标签挪到别处。**

---

## 11. 首页（批次 F：`src/styles/lanmiao-home.css` 与 `src/components/home/*`）

首页保持 `className="lm-home nori-force-dark"`，也就是「放映厅」：

- 保留现有的 TV 频道结构、蓝猫和弹跳动效；
- 去掉所有渐变、光晕、扫描线、光束；
- 颜色换成新色板，主按钮换成喵蓝 `--lm-signal`。

### 11.1 令牌：替换第 2-16 行

保留第 8-9 行的 line / line-2，保留第 17 行 `--lm-spring`。**删除第 16 行 `--lm-grad`。**

```css
  --lm-bg: #090A0D;
  --lm-bg-2: #0F1115;
  --lm-bg-3: #16181D;
  --lm-ink: #F3F4F6;
  --lm-ink-2: rgba(243,244,246,.68);
  --lm-ink-3: rgba(243,244,246,.46);
  --lm-line: rgba(255,255,255,.10);
  --lm-line-2: rgba(255,255,255,.18);
  --lm-violet: #5FA3E3;
  --lm-purple: #A390F2;
  --lm-pink: #EC7CAB;
  --lm-cyan: #3DBFB8;
  --lm-cat: #93C2E6;
  --lm-sun: #E3A53C;
  --lm-signal: #2A6FBF;
```

`--lm-violet` 这个名字保留不改，因为它被大量引用；改名属于无收益的扰动。现在它的值是喵蓝 400。

### 11.2 逐行改动

| 行 | 选择器 | 改为 |
|---|---|---|
| 62 | **`.lm-nav a::after`** | `background: var(--lm-violet);` |
| 66 | **`.lm-signin:hover`** | `background: var(--lm-signal); border-color: transparent; color: #fff;`，`transform` 保留 |
| 77 | **`.lm-ch-leap`** | `color: var(--lm-cat);`，删除 `background`、`background-clip`、`-webkit-background-clip`、`-webkit-text-fill-color` |
| 78 | **`.lm-ch-leap::after`** | `height: 3px; bottom: -4px; border-radius: 2px; background: var(--lm-cat);`，其余保留 |
| 82 | **`.lm-button-primary`** | `background: var(--lm-signal); color: #fff; box-shadow: none;`，其余保留 |
| 82 之后新增 | `.lm-button-primary:hover` | `{ background: #1F5799; }` |
| 89-94 | **`.lm-ambient`**、`.lm-ambient > i` ×4、**`.lm-pointer-light`** | 整段删除 |
| 103 | **`.lm-tv-scanlines`** | 整行删除 |
| 104 | **`.lm-tv-shine`** | 整行删除 |
| 117 | **`.lm-tv-glow`** | 整行删除 |
| 125 | **`.lm-scene-0`** | `background: #0E2F5A;` |
| 126 | **`.lm-scene-1`** | `background: #261A5C;` |
| 127 | **`.lm-scene-2`** | `background: #4D1230;` |
| 128 | **`.lm-scene-3`** | `background: #1F5799;` |
| 140 | **`.lm-film-frame`** | `background: #3A86D6;` |
| 141 | **`.lm-film-frame-1`** / **`.lm-film-frame-2`** | `background: #7A5FD9;` / `background: #D24F86;` |
| 142 | **`.lm-film-frame i`** | `background: rgba(9,10,13,.55);`（原紫色 `#32204F`） |
| 146 | **`.lm-viewfinder b`** | 见下方代码 |
| 147 | **`.lm-sun`** | `box-shadow: none;` |
| 169 | **`.lm-ball`** | `background: var(--lm-cat); box-shadow: none;` |
| 178 | **`.lm-canvas-diagram`** | 删除 `background`（点阵），其余保留 |
| 188 | `.lm-storyboard-diagram > div:last-child i`（在同一长行内） | 把其中的渐变背景改成 `background: rgba(255,255,255,.18);` |
| 192 | **`.lm-polish`** | `background: var(--lm-bg-3);` |
| 205 | **`.lm-rays`** | 整行删除 |
| 212 | 4 个 dial 的激活态 | `background: var(--lm-cat);` |
| 232-234 | `.lm-ambient > i` 的三条动画 | 删除 |
| 267 | `.lm-rays` 动画 | 删除 |
| 295 | `@keyframes lm-tv-shine` | 删除；同时 grep `lm-tv-shine`，删除引用它的 animation 规则 |
| 319 | `@keyframes lm-rays` | 删除 |
| — | `@keyframes lm-drift-a`、`-b`、`-c` | 删除 |
| 330 | `@media (min-width: 1200px)` 内的 **`.lm-pointer-light`** | 删除该行，媒体查询的其余内容保留 |

取景器十字线（替换第 146 行，不用渐变）：

```css
.lm-viewfinder b { position: absolute; width: 12px; height: 12px; left: calc(50% - 6px); top: calc(50% - 6px); }
.lm-viewfinder b::before, .lm-viewfinder b::after { position: absolute; background: #fff; content: ''; }
.lm-viewfinder b::before { left: 0; right: 0; top: calc(50% - .5px); height: 1px; }
.lm-viewfinder b::after { top: 0; bottom: 0; left: calc(50% - .5px); width: 1px; }
```

**`--lm-px` / `--lm-py` 不能删。** `useHomeMotion.ts:75-76` 在写这两个变量，第 99 行的 `.lm-tv-rig` 还在用它们做透视。

### 11.3 标记

| 文件:行 | 改动 |
|---|---|
| `src/components/home/HomeHero.tsx:24` | 删除 `<div className="lm-ambient" aria-hidden="true"><i /><i /><i /></div>` 和 `<i className="lm-pointer-light" aria-hidden="true" />`，同一行的其余内容（如 `<Marquee`）保留 |
| `src/components/home/HomeTv.tsx:29` | 删除 `<i className="lm-tv-scanlines" …/>` 和 `<i className="lm-tv-shine" …/>` |
| `src/components/home/HomeTv.tsx:36` | 删除整个 `<i className="lm-tv-glow" … />` |
| `src/components/home/HomeFinale.tsx:8` | 删除 `lm-ambient` 的 div 和 `lm-rays` 元素 |
| `src/components/home/HomeScenes.tsx:1` | `export const HOME_CHANNEL_COLORS = ['#5FA3E3', '#A390F2', '#EC7CAB', '#3DBFB8'] as const` |

删除 `lm-tv-glow` 后，`HomeTv.tsx` 里如果 `HOME_CHANNEL_COLORS` 或 `React` 只剩这一处使用，要一并清掉未使用的 import，保证 tsc 和 lint 不新增报错。

自检命令，输出应为 0：

```bash
grep -rnE 'lm-ambient|lm-pointer-light|lm-tv-scanlines|lm-tv-shine|lm-tv-glow|lm-rays|lm-drift|--lm-grad|gradient' src/styles/lanmiao-home.css src/components/home | grep -v ' [0-9]\.' | wc -l
```

`tests/unit/home/home-page-contract.test.ts` 的约束：

- CSS 里必须保留 `prefers-reduced-motion`；
- 不得出现 `:has(`、`animation-timeline`、`@container`、webfont、three、`<video>`、外部 URL。

本批不会引入这些，但改完要跑这个测试。

---

## 12. 渐变守卫（批次 G）

文件：`scripts/guards/no-decorative-gradients-guard.mjs`。npm 脚本是 `npm run check:no-decorative-gradients`。

在 `walk()`（第 24-38 行）的循环开头，`.git` / `.next` / `node_modules` 那行之后，加一行：

```js
    if (/ \d+\.[a-z]+$/.test(entry.name)) continue
```

这样 Finder 重复文件就不会被扫到（R8）。`excludedFiles`（第 41 行起）不动。

2026-11-17 守卫报出 27 处真实违规，全部会在批次 D 和 F 中消除：

- `interactive.css`：388、389、395、398
- `frameos-replica.css`：1514、1515、1526
- `lanmiao-home.css`：16、78、91-94、103、104、117、125-128、140、141、146、178、188、192、205

`frameos-replica.css` 的 2830、2913、2915、3870、4079 是时间轴刻度尺，属于功能性渐变，已在守卫白名单内，保持原样。

DoD：`npm run check:no-decorative-gradients` 退出码为 0。若仍有违规，逐条判断：

- 装饰性的 → 回到对应批次修掉；
- 功能性的（刻度、遮罩可读性）→ 停下来问用户是否加入白名单。

**不要自己加白名单。**

---

## 13. 默认浅色（批次 H，必须先得到用户明确同意）

只有用户回复「同意默认浅色」后才执行本批。否则批次 A-G 完成即可交付，用户仍可以在设置里切到浅色。

| 文件:行 | 现在 | 改为 |
|---|---|---|
| `src/app/[locale]/layout.tsx:30` | `themeColor: theme === 'light' \|\| theme === 'system' ? '#f5f6fa' : '#0d0d0d'` | `themeColor: theme === 'dark' ? '#0f1115' : '#fafbfc'` |
| `src/app/[locale]/layout.tsx:60` | `preference === 'light' \|\| preference === 'system' ? preference : 'dark'` | `preference === 'dark' \|\| preference === 'system' ? preference : 'light'` |
| `src/app/[locale]/layout.tsx:63` | `data-nori-theme={themePreference === 'light' ? 'light' : 'dark'}` | `data-nori-theme={themePreference === 'dark' ? 'dark' : 'light'}` |
| `src/lib/theme/useNoriTheme.ts:18` | `resolved === 'light' ? '#f5f6fa' : '#0d0d0d'` | `resolved === 'light' ? '#fafbfc' : '#0f1115'` |
| `src/lib/theme/useNoriTheme.ts:22-23` | 默认 `'dark'` | 默认 `'light'` |
| `tests/browser/theme-switch.browser.mjs:42` | 断言默认暗色 | 改为断言默认浅色（本批唯一允许改的测试） |

`layout.tsx:74` 的 `system` 内联脚本不动。

注意：

- 首页、登录页、后台登录页是 `nori-force-dark`，默认浅色后仍然是深色，这是设计意图（放映厅入口）。
- 画布内部原本就有深色专注区，同样不受影响。

---

## 14. 全部改动一览

| # | 批次 | 文件 | 改动摘要 | 章节 |
|---|---|---|---|---|
| 1 | A | `src/styles/tv-tokens.css`（新） | 原子色板、圆角、动效 | 6.1 |
| 2 | A | `src/app/globals.css` | 加 1 行 import | 3.1 |
| 3 | A | `src/styles/theme.css` | 暗色 / 亮色 triplet、新增 cta / brand、info 改值、末尾紫色映射两块、删第 78 行 | 6.2 |
| 4 | A | `src/styles/frameos-replica.css` 8-108 | 基础块、亮色块、frameos-dark 亮色块、岛规则、`--color-white` | 6.3 |
| 5 | A | `src/styles/frameos-tokens.css` 42-44、~117 | brand 令牌、CTA 阴影 | 6.4 |
| 6 | A | `src/features/canvas/canvas.css` ~6727-6728 | `--dm-cta`、`--dm-brand` | 6.5 |
| 7 | B | 6 个 CSS 文件 | 紫色字面量 → `--nori-primary`（脚本） | 8.3 |
| 8 | B | `FosScriptReview.tsx:239-240`、`CapsuleNav.tsx:78`、`FrameServiceRecordsDashboard.tsx:388` | TSX 手工去紫，修可读性 | 8.3 |
| 9 | B | canvas.css、story-canvas.css | CTA 文字白色、悬停色 | 8.1 |
| 10 | B | canvas.css、frameos-replica.css | 39 处指示器 → brand-solid | 8.2 |
| 11 | B | canvas.css、story-canvas.css、replica、frameos-tokens | 16 处彩色光晕 | 8.4 |
| 12 | C | `frameos-replica.css` | 外壳、Logo、积分、导航、头像、卡片、按钮、输入、分段、弹窗、菜单、选中态、Tab、Toast、开关、后台导航、作品卡外框 | 7.1-7.12 |
| 13 | C | `canvas.css` | hub 悬停、两条 Toast | 7.10、7.13 |
| 14 | D | `src/lib/ui/generative-cover.ts` | 海报色板与形状 | 9.2 |
| 15 | D | `src/components/frameos/works/WorkCover.tsx` | 海报 DOM | 9.3 |
| 16 | D | `frameos-replica.css` 1512-1548 | 海报 CSS | 9.4 |
| 17 | D | `src/features/interactive/interactive.css` | hub 去噪点、封面、首字母色 | 9.5 |
| 18 | D | `tests/unit/interactive/fresh-story-neutral.test.ts`、`tests/unit/ui/generative-cover.test.ts`（新） | 测试 | 9.6 |
| 19 | E | 4 个页面 TSX + replica 两条规则 | 频道标签 | 10 |
| 20 | F | `lanmiao-home.css`、`HomeHero/HomeTv/HomeFinale/HomeScenes.tsx` | 首页去渐变、换色 | 11 |
| 21 | G | `scripts/guards/no-decorative-gradients-guard.mjs` | 跳过 Finder 重复文件 | 12 |
| 22 | H | `layout.tsx`、`useNoriTheme.ts`、`theme-switch.browser.mjs` | 默认浅色（需用户同意） | 13 |

---

## 15. 批次、提交顺序与 DoD

### 15.0 测试环境（每批都用）

Desktop 仓库的 `node_modules` 可能被 macOS 驱逐成「dataless」占位文件，表现是 tsc 0.1 秒就静默退出。所以测试要在镜像目录里跑。

```bash
# 镜像（目标必须是绝对路径，必须带 --delete）
rsync -a --delete --exclude /node_modules --exclude /.next --exclude /test-results --exclude /.git --exclude /.runtime --exclude /data ./ /tmp/nori-work-a/
```

`/tmp/nori-work-a/node_modules` 应该是指向干净依赖的软链接。如果不存在，按下面步骤重建：

```bash
npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/npm-cache-nori
npx prisma generate
```

重建依赖前先告诉用户，因为它耗时、占磁盘。

在镜像里跑：

```bash
cd /tmp/nori-work-a
node ./node_modules/vitest/vitest.mjs run <files> > /tmp/tv-vitest.log 2>&1; grep -E 'Test Files|     Tests| FAIL |^ +× ' /tmp/tv-vitest.log
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json > /tmp/tv-tsc.log 2>&1; echo "exit $?"; grep -c 'error TS' /tmp/tv-tsc.log
```

- tsc 基线是 12 行错误，退出码 2，全部来自 Finder 的 `* 2.*` 重复文件。每批之后必须**仍然是 12**。
- vitest 基线中，`asset-library-navigation-stability:18` 本来就失败，不算回归。

### 15.1 批次 0：预检（不提交）

1. `git status --porcelain`，查看第 R2 条列出的文件是否有别人未提交的改动。有的话，**停下来问用户**。
2. 记录基线：跑一遍下面这组测试，保存日志到 `/tmp/tv-baseline.log`。

   ```
   tests/unit/theme-tokenize.test.ts
   tests/unit/frameos/works-pixel-parity.test.ts
   tests/unit/frameos/shell-sidebar-collapse.test.ts
   tests/unit/frameos/ux-a-title-and-story-tips.test.ts
   tests/unit/interactive/fresh-story-neutral.test.ts
   tests/unit/home/home-page-contract.test.ts
   ```

   再加上 `grep -rl 'assignments-replica-contract\|hub-direct-project' tests/unit` 找到的两个文件。
3. 拍「改前」截图（见 16.2），标签为 `tv-before-dark` 和 `tv-before-light`。
4. 跑 `npm run check:no-decorative-gradients`，记录违规数（预期为 27 加上重复文件的数量）。

### 15.2 各批 DoD

| 批次 | 提交信息 | DoD |
|---|---|---|
| A | `feat(ui): tv tokens and paper/screen themes` | tsc 仍为 12；15.1 的测试与基线一致；浅色截图中主按钮为墨色、深色中为喵蓝；页面不再出现紫色底；`grep -c -- '--tv-' src/styles/tv-tokens.css` > 60 |
| B | `feat(ui): split cta from brand indicators and drop purple glows` | 8.5 的三项检查全部通过（codemod 0、glow 0、CTA 审计无未解释项）；tsc 仍为 12；浅色截图中进度条、滑块、开关为喵蓝，且没有黑色进度条 |
| C | `feat(ui): nori-style shell and controls` | 15.1 的测试与基线一致，其中 assignments-replica-contract、works-pixel-parity、shell-sidebar-collapse 必须通过；截图中选中胶囊为反相色、分段控件为白色滑块、Toast 为深色胶囊；控件高度用 16.3 的脚本核对不变 |
| D | `feat(ui): solid poster covers` | 新测试 `generative-cover.test.ts` 通过；`fresh-story-neutral` 通过；如能运行，`project-hierarchy.browser.mjs` 通过；作品库和影游 hub 截图中封面为纯色海报，且同一项目刷新后不变 |
| E | `feat(ui): channel slugs on page titles` | `works-pixel-parity` 和 `shell-sidebar-collapse` 通过；4 个页面截图中标签与 h1 同行、标题区高度不变 |
| F | `feat(home): solid broadcast palette` | `home-page-contract` 通过；11.3 的自检命令输出 0；首页截图中无光晕、主按钮为喵蓝 |
| G | `chore(guard): skip finder duplicates in gradient guard` | `npm run check:no-decorative-gradients` 退出码为 0 |
| H | `feat(ui): default to paper theme` | **仅在用户同意后执行**；`theme-switch.browser.mjs` 通过 |

每批只提交本批文件。`git add` 时逐个写文件名，不用 `git add -A`。不 push。

---

## 16. 验收

### 16.1 视觉验收清单（浅色、深色各看一遍）

1. 全站找不到紫色。可以搜截图，也可以直接看导航「工具箱」以外的地方。
2. 浅色：主按钮是墨色，悬停上浮 1px；深色：主按钮是喵蓝。
3. 进度条、滑块、开关、勾选、序号在两个主题下都是喵蓝。
4. 侧栏激活项是灰色底加粗字，图标块是该功能的实色配白色图标；未激活的图标块是 12% 淡底。
5. 选中的筛选胶囊：浅色是墨底白字，深色是白底黑字。
6. 分段控件：灰色轨道，选中项是白色（深色下是 `bg-5`）滑块。
7. Toast：深色胶囊，图标与文字同色。
8. 作品封面：纯色底、一个几何形、左下角品牌标；同一项目两次加载完全一致。
9. 页面标题前有「● PROJECTS / TASKS / SCRIPT / TOOLBOX」标签。
10. 卡片默认几乎没有阴影，悬停时有中性阴影并上浮 2px。
11. 首页：无光晕、无扫描线、无光束，频道色为新色板。
12. 暗色岛（画布弹窗、播放器、视频工作区）在浅色主题下主按钮仍是喵蓝、文字是白色。

### 16.2 截图（无头）

```bash
node test-results/gallery/build.mjs
node test-results/gallery/shoot.mjs tv-after-dark works material asset-hub toolbox accounts assignments screenwriter canvas-hub repaint create-project updates feedback prompts records profile enhance canvas admin-signin admin-accounts admin-services
INIT_JS="document.documentElement.dataset.noriTheme='light';document.documentElement.dataset.noriThemePref='light'" \
  node test-results/gallery/shoot.mjs tv-after-light works material asset-hub toolbox accounts assignments screenwriter canvas-hub repaint create-project updates feedback prompts records profile enhance canvas admin-signin admin-accounts admin-services
```

视图名以 `test-results/gallery/shoot.mjs:90` 的默认列表为准，`wf-*` 视图也要包括进去。截图后按 16.1 逐张对照，把前后对比的路径写进最后的交付说明。

### 16.3 尺寸不变的核对

在 gallery 页面里，对下面这些选择器取 `getBoundingClientRect().height`，与 `tv-before-*` 时的数值对比，必须一致：

- `.fos-btn`、`.fos-btn-sm`、`.fos-btn-lg`
- `.fos-input`、`.fos-seg-opt`
- `.fa-title-group`、`.works-project-card`
- `.fos-titlebar`（或 `--fos-titlebar-height` 对应的元素）

可以写成一次性的 node 脚本，放在 `/tmp`，不要提交。

### 16.4 对比度（已预先计算，供抽查）

| 前景 / 背景 | 比值 |
|---|---|
| ink-1 / paper-1 | 17.4 |
| ink-4 / paper-1 | 5.20 |
| 白 / 墨 CTA | 17.4 |
| 白 / sky-600 | 5.09 |
| sky-700 / 白 | 7.29 |
| mist-1 / screen-1 | 17.17 |
| mist-4 / screen-1 | 5.47 |
| sky-400 / screen-1 | 7.05 |
| `#8EC0EE` / screen-1 | 9.24 |

---

## 17. 风险与「停下来问」清单

| 风险 | 表现 | 处理 |
|---|---|---|
| 工作区有别人的改动（R2） | 目标文件 `git status` 显示已修改 | 停下来问，不要 stash 或 reset |
| 行号漂移 | 文中描述的内容与该行不符 | 用加粗选择器 grep；找不到或找到多处，停下来问 |
| 特异性陷阱 | 亮色下某些 `--nori-s-*` / `--nori-t-*` 仍是紫色 | 检查 6.2.3 两块是否在 `theme.css` **最末尾**、选择器是否逐字一致 |
| 暗色岛 CTA 变墨色 | 浅色主题下画布弹窗、播放器的主按钮是黑色 | 检查 3.4 岛规则是否在 replica 第 99 行之后；该岛若不带 `.nori-force-dark` 类，停下来问 |
| CTA 文字隐形 | 墨底上是黑字 | 跑 8.1 审计脚本 |
| 指示器变黑 | 浅色下进度条或滑块是墨色 | 说明它仍在用 `--fos-gradient-cta`，按 8.2 改成 brand-solid |
| codemod 计数不符 | 不是 65（批次 A 之后） | 停下来问，不要直接 `--write` |
| `var(--tv-*)` 链式引用被测试拒绝 | 某测试解析 `theme.css` 里的数字 | 按 6.2.1 的说明换成字面 triplet，并告知用户 |
| 测试断言了要删的类名或渐变串 | 第 9.6 节以外的测试失败 | 停下来问。只允许改 9.6 和第 13 节列出的测试（R7） |
| h1 位置被几何测试断言 | 频道标签导致失败 | 停下来问（10.2） |
| 守卫仍有违规 | 非本文列出的渐变 | 判断是否装饰性；功能性的问用户，不自行加白名单 |
| 依赖被驱逐 | tsc 0.1 秒静默退出 | 用 15.0 的镜像；重装依赖前先告知用户 |
| 默认主题 | 想顺手改默认浅色 | 不行，批次 H 必须等用户明确同意 |

交付时给用户一段简短说明：

- 完成了哪些批次，每批的 commit hash；
- 截图路径（改前 / 改后，浅色 / 深色）；
- 测试结果：哪些通过、基线失败是否不变；
- 遇到并停下来问过的问题；
- 批次 H 是否执行。
