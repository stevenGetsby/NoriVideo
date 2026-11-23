# LanmiaoTV 动画首页设计与实现方案（给 kimi3.1 的实现文档）

日期：2026-11-15　角色：设计 → 实现（kimi3.1）。本文自成一体，照做即可，不需要再问用户。

## 创意概念：「开机 · 跃然屏上」

一句话：**打开首页就像打开一台电视，一只蓝猫从电视后面跳出来，标题里的「跃」字自己会跳。**

三个记忆点，整页所有动效都从它们长出来，不加别的花样：

1. **TV = 频道**。品牌叫 LanmiaoTV，所以首页是一台电视：进场是「开机」（一条亮线展开成画面），屏幕里轮播四个频道（故事 / 资产 / 镜头 / 成片），右侧有频道拨盘，点「进入工作台」是「关机换台」再进入登录页。
2. **跃 = 动效语言**。全页只用一种运动方式：**起跳 → 腾空 → 落地压扁 → 回弹**（弹簧曲线 + 挤压拉伸）。标题逐字跳入，「跃」字每 4.8 秒自己跳一下；流程区有一颗小球在四张卡片上一路跳过去；卡片、按钮悬停都是弹一下，不用淡入淡出。
3. **蓝猫 = 角色**。猫不是贴在角落的 logo，而是躲在电视后面探出上半身（素材底部本来就是裁切的，正好被电视挡住），和「跃」字同一拍起跳；点它会跳得更高，喊一声「喵！」。

主标题：**让故事，跃然屏上。**（「跃然纸上」的改写：屏 = TV，跃 = 跳。登录页的「让想象，成为下一幕。」保持不变，两页是上下句。）

## 全部改动一览

| 编号 | 用户看到什么 | 章节 | 批次 |
|---|---|---|---|
| H1 | 未登录打开网站首页，看到动画首页（原来直接跳到登录页）；已登录仍然直接进工作台 | §1 | 1 |
| H2 | 首屏：开机动画、逐字跳入的标题、会换台的电视、探头的蓝猫、两个按钮 | §3.2、§4 | 1（静态）+ 2（动效） |
| H3 | 往下滚：流程区（小球跳过四张卡片）、能力区（六块会动的卡片）、收尾区（大按钮）、页脚（备案号） | §3.3–§3.6 | 1 + 2 |
| H4 | 点「登录」「进入工作台」「登录，开始创作」：画面像关电视一样收成一条线，然后进入登录页 | §4.6 | 3 |
| H5 | 右侧频道拨盘、鼠标跟随的光斑和电视倾斜、点猫的彩蛋 | §3.7、§4.5 | 2 |
| H6 | 手机、平板、旧浏览器、关闭动效的系统设置下都能正常看、正常点登录 | §6 | 1–3 |

## 执行规则（照此自主完成）

沿用 `2026-11-14-lanmiaotv-ux-plan.md` 的 R2–R5、R7 和 `2026-11-14-performance-traffic-login-plan.md` 的 R6（上生产）、R8（联系用户的时机）。新增：

- **H-R1 顺序**：批次 1（路由 + 完整的静态页面，不带任何动画也要好看）→ 批次 2（动效）→ 批次 3（登录转场、测试、性能、打磨）。三个批次都在测试机验收后，**合并成一次生产放行申请**。同一天只做一次生产上线（和其它方案共用）。
- **H-R2 本文没写到的细节**，按这个优先级选：能点到登录 > 首屏文字立刻可读 > 不掉帧 > 好看。任何动效和这四条冲突，删动效。
- **H-R3 不许自己加创意**：不加本文没有的元素（粒子背景、3D 模型、视频、打字机副标题、鼠标拖尾、滚动劫持等）。觉得缺什么，写进部署记录的「建议」里，不实现。
- **H-R4 品味自检**：每个批次结束，按 §9.4 的清单逐条对着截图检查，结果写进部署记录。
- **H-R5 和其它方案的关系**：
  - 登录页重设计（性能方案 §5）独立进行，本文不改 `signin/page.tsx`、`FosAuthShell.tsx`、`nori-auth.css`；首页只是多了一个指向登录页的入口。`FosAuthShell` 里品牌链接本来就指向 `/`，首页上线后它自然回到首页。
  - 日间模式（编辑/主题方案 §10）：首页是品牌页，始终深色。那一批已经实现的话，给首页根节点加 `nori-force-dark`；没实现就不用管。
  - 首页不在 `.fos-app` 里，没有 1.2 倍缩放，不受旧内核缩放问题影响。

---

## 0. 硬约束

1. **流量**：服务器按流量计费（0.8 元/GB）。首页**不放视频、不放大图、不加载网络字体、不用 WebGL/three.js、不引入任何新的 npm 依赖**。全部画面用 CSS、内联 SVG 和少量 JS 画出来。唯一的图片是已有的蓝猫 `public/brand/lanmiao-cat.png`（56 KB）。
2. **不造假**：不写用户数、作品数、「xx 万创作者」之类的数字；不放「用户作品」展示；屏幕里的画面全是抽象的示意图形，不冒充真实生成结果。
3. **蓝猫 IP 不重绘**：只用现有 PNG（`src/lib/brand.ts` 的 `BRAND_ASSETS.mark`，通过 `NoriBrandMark` 组件），原图 250×210，**显示宽度不超过 200px**，不做 AI 放大、不描成 SVG、不改表情。猫的底部是裁切的，必须始终被前景挡住（§3.2）。
4. **不开放注册**：没有「注册」按钮，所有入口都去登录页 `/auth/signin`。收尾区写明「账号由团队管理员分配」。
5. **备案号**：页脚显示 ICP 备案号（读 `process.env.ICP_NUMBER`，没设置就不显示），链接到 `https://beian.miit.gov.cn/`。
6. **动画只动 `transform` 和 `opacity`**。不在大面积元素上用 `filter: blur()`；`backdrop-filter` 只允许用在顶栏一处。
7. 文案中英文都要有（`locale` 为 `en` 时显示英文），本文给出全部文案，原样使用。
8. 不碰名字带 ` 2`、` 3`、` 4` 的 Finder 重复文件。不改数据库、不改接口。

## 1. 路由与文件（H1）

### 1.1 路由行为
`src/app/[locale]/page.tsx` 现在是无条件 `redirect` 到 `/works`。改成：

```tsx
import type { Metadata } from 'next'
import { getServerSession } from 'next-auth'
import { redirect } from '@/i18n/navigation'
import { authOptions } from '@/lib/auth'
import { resolveAppSurface } from '@/lib/app-surface'
import { AUTHENTICATED_HOME_PATHNAME } from '@/lib/home/default-route'
import { LanmiaoHome } from '@/components/home/LanmiaoHome'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  return locale === 'en'
    ? { title: 'LanmiaoTV · Stories that leap off the screen', description: 'An AI anime studio for creative teams: script, characters, storyboards and final cut on one infinite canvas.' }
    : { title: 'LanmiaoTV · 让故事跃然屏上', description: '给创作团队的 AI 动漫制作工作台：剧本、角色、分镜到成片，在一块无限画布上完成。' }
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await getServerSession(authOptions)
  // 已登录、或独立的平台管理端口：保持原来的跳转，行为不变
  if (session?.user || resolveAppSurface() === 'admin') redirect({ href: AUTHENTICATED_HOME_PATHNAME, locale })
  return <LanmiaoHome locale={locale === 'en' ? 'en' : 'zh'} icp={process.env.ICP_NUMBER?.trim() || null} />
}
```
- `getServerSession(authOptions)` 的写法照抄 `src/app/[locale]/account-management/page.tsx:13`（包括它的类型断言）。
- 结果：未登录访问 `/` → 中间件转到 `/zh` → 显示首页；已登录 → `/zh/works`（和现在一样）；需要改密码的账号仍被中间件转去改密码页（`src/middleware.ts`，不改）。
- 其它「未登录跳登录页」的地方（`FosShell.tsx:487`、`lib/auth.ts:139` 等）**都不改**：直接打开工作台深链的人仍然去登录页，只有访问根路径才看到首页。
- 退出登录后仍然回登录页（`FosShell.tsx:300,497`），不改。

### 1.2 新增文件
```
src/components/home/
  LanmiaoHome.tsx          根组件（'use client'），拼装各区块、挂载下面的 hooks
  home-copy.ts             全部中英文文案（§3 的表格），export const HOME_COPY = { zh: {...}, en: {...} }
  HomeHeader.tsx           顶栏
  HomeHero.tsx             首屏（标题、按钮、电视、猫）
  HomeHeadline.tsx         逐字拆分的标题
  HomeTv.tsx               电视机 + 频道轮播 + OSD
  HomeScenes.tsx           四个频道的 CSS 画面（首屏电视和流程卡片共用）
  HomeCat.tsx              蓝猫（探头、起跳、彩蛋）
  HomeFlow.tsx             流程区（四张卡片 + 跳动的小球）
  HomeBento.tsx            能力区（六块卡片）
  HomeFinale.tsx           收尾区 + 页脚
  HomeChannelDial.tsx      右侧频道拨盘
  useHomeMotion.ts         进入视口、暂停、指针跟随、登录转场四个 hook
src/styles/lanmiao-home.css  全部样式，类名前缀 lm-
```
- 样式**只在首页加载**：在 `LanmiaoHome.tsx` 顶部 `import '@/styles/lanmiao-home.css'`，**不要**加进 `src/app/globals.css`（工作台各页面不应该为首页多下载一份样式）。`lanmiao-home.css` 是纯 CSS，不用 Tailwind 的 `@apply`。
- 文案不走 `messages/*.json`，和 `FosAuthShell.tsx` 一样放在组件侧（`home-copy.ts`），避免首页多加载一个命名空间。
- 图标用 `@/components/ui/icons` 里已有的（`ArrowUpRight`、`ArrowDown`、`Play`、`Sparkles` 等，没有的就用内联 SVG）。

## 2. 视觉系统

和登录页是同一套颜色（性能方案 §5.2），首页多了「猫蓝」和「暖黄」两个点缀色。

### 2.1 令牌（写在 `.lm-home` 上，不放 `:root`）
```css
.lm-home {
  --lm-bg: #0B0D1A;            /* 页面底色，和登录页一致 */
  --lm-bg-2: #11142A;          /* 卡片底 */
  --lm-bg-3: #181C3A;          /* 卡片悬停、电视外壳 */
  --lm-ink: #F5F6FF;           /* 主文字 */
  --lm-ink-2: rgba(245,246,255,.68);
  --lm-ink-3: rgba(245,246,255,.44);
  --lm-line: rgba(255,255,255,.10);
  --lm-line-2: rgba(255,255,255,.18);
  --lm-violet: #6E7BFF;  --lm-purple: #9B6BFF;  --lm-pink: #FF5FA2;
  --lm-cyan: #3DD6F5;    --lm-cat: #8CC8F5;     --lm-sun: #FFD166;
  --lm-grad: linear-gradient(135deg, #6E7BFF 0%, #9B6BFF 55%, #FF5FA2 100%);
  /* 运动曲线：全页只用这三条 */
  --lm-spring: cubic-bezier(.34, 1.56, .64, 1);   /* 回弹（旧浏览器） */
  --lm-out: cubic-bezier(.22, 1, .36, 1);          /* 减速停下 */
  --lm-in: cubic-bezier(.6, 0, .8, .2);            /* 加速离开（下落、关机） */
  --lm-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --lm-font: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif;
  color: var(--lm-ink); background: var(--lm-bg); font-family: var(--lm-font);
  color-scheme: dark; overflow-x: clip; min-height: 100vh; min-height: 100dvh;
}
/* 支持 linear() 的浏览器（Chrome 113+）换成真正的弹簧 */
@supports (animation-timing-function: linear(0, 1)) {
  .lm-home { --lm-spring: linear(0, .009, .035 2.1%, .141, .281 6.7%, .723 12.9%, .938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, .991, .977 51%, .974 53.8%, .975 57.1%, .997 69.8%, 1.003 76.9%, 1.004 83.8%, 1); }
}
```
`overflow-x: clip` 不支持时（Chrome < 90）退回 `overflow-x: hidden`：先写 `hidden` 再写 `clip`。

### 2.2 四个频道的颜色（全页固定，不许换）
| 频道 | 中文 | 英文 | 主色 | 屏幕底 |
|---|---|---|---|---|
| CH 01 | 故事 | STORY | `--lm-violet` | `linear-gradient(160deg, #1B1F4A, #3A2C7A)` |
| CH 02 | 资产 | ASSETS | `--lm-purple` | `linear-gradient(160deg, #2A1E5C, #5B2A86)` |
| CH 03 | 镜头 | SHOTS | `--lm-pink` | `linear-gradient(160deg, #4A1942, #B0356F)` |
| CH 04 | 成片 | FILM | `--lm-cyan` | `linear-gradient(180deg, #1E2A78 0%, #6E7BFF 45%, #FF8FB8 100%)` |

### 2.3 字号
| 用途 | 桌面 ≥1200 | 平板 768–1199 | 手机 <768 |
|---|---|---|---|
| 主标题 h1 | 104/1.04，800，字距 -0.03em | 72/1.06 | 46/1.1（宽度 <360 时 40） |
| 区块标题 h2 | 56/1.1，750，字距 -0.02em | 44/1.12 | 32/1.2 |
| 正文 | 18/1.7 | 17/1.7 | 15/1.7 |
| 卡片标题 | 22/1.3，650 | 20 | 18 |
| 卡片说明 | 15/1.6，`--lm-ink-2` | 14 | 14 |
| OSD、频道号、时间码 | 12/1，`--lm-mono`，字距 .08em，大写 | 同 | 11 |
英文主标题比中文长，英文时 h1 用 88 / 60 / 38。

### 2.4 质感（静态，不动）
- **颗粒**：`.lm-home::before`，`position: fixed; inset: 0; pointer-events: none; opacity: .06; z-index: 1`，背景是内联 SVG 噪点（`data:image/svg+xml` 里一个 `feTurbulence baseFrequency=".9" numOctaves="2"` 的 160×160 矩形，平铺）。不做动画。
- **光晕**：三团 `radial-gradient`（和登录页同色：左上紫 `rgba(110,123,255,.40)`、右下洋红 `rgba(255,95,162,.26)`、右中青 `rgba(61,214,245,.20)`，各自直径约 60vw），放在首屏和收尾区的背景层；每团 `translate3d` 缓慢漂移 24 秒往返。
- **扫描线**：只在电视屏幕里，`repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px)`。
- **描边大字**：背景里的滚动大字用 `color: transparent; -webkit-text-stroke: 1px rgba(255,255,255,.12)`。

## 3. 页面结构、布局与文案

### 3.1 顶栏 `HomeHeader`
- `position: sticky; top: 0; z-index: 50; height: 64px`（手机 56）；内容最大宽 1280，左右留白 32（手机 16）。
- 滚动超过 24px 后加类 `is-scrolled`：背景 `rgba(11,13,26,.72)`、`backdrop-filter: blur(14px)`（不支持时背景改为 `rgba(11,13,26,.94)`）、底边 `1px solid var(--lm-line)`。过渡 200ms。
- 左：品牌，结构照抄 `FosAuthShell.tsx:32-35`（`<NoriBrandMark size={34} />` + `LanMiao` + `TV` + 上标 `STUDIO`），自己写 `lm-` 类名的样式，不复用 `nori-auth-*` 类。点击回到页面顶部。
- 中（仅桌面）：三个锚点文字链接「流程」「画布」「开始」（英文 Flow / Canvas / Start），分别滚到 `#flow`、`#canvas`、`#start`。14px，`--lm-ink-2`，悬停变 `--lm-ink` 并出现 2px 渐变下划线（`scaleX` 从 0 到 1，原点在左）。
- 右：按钮「登录」（英文 Sign in），高 36，圆角 18，左右内边距 18，边框 `1px solid var(--lm-line-2)`，悬停时背景变 `--lm-grad`、边框透明、整体上弹 2px（`--lm-spring`，260ms）。它是 `<Link href={{ pathname: '/auth/signin' }} data-lm-enter data-testid="home-signin">`。

### 3.2 首屏 `HomeHero`（`<section id="top" data-ch="01">`）
高度 `min-height: calc(100vh - 64px)`（再写一行 `100dvh` 版本），内容垂直居中，下方留 48px。

**桌面线框（1440×900）**
```
┌────────────────────────────────────────────────────────────────────────────┐
│ [猫] LanMiaoTV STUDIO            流程   画布   开始                 [ 登录 ] │
│  LANMIAO TV ✦ JUMP CUT ✦ ACTION ✦ 喵 ✦ LANMIAO TV ✦ …  （描边大字，向左滚） │
│                                                        ╭ 猫探出上半身 ╮     │
│  ● CH 01 · NOW PLAYING                              ┌──┴─────────────┴──┐ ① │
│                                                     │ CH 01 故事  00:12 │ ② │
│  让故事，                                           │                   │ ③ │
│  跃然屏上。   ← 「跃」是渐变色，会跳                 │   （频道画面）     │ ④ │
│                                                     │                   │   │
│  LanmiaoTV 是给创作团队的 AI 动漫制作工作台……        │  ● ○ ○ ○  ▬▬▬──   │   │
│                                                     └───────────────────┘   │
│  [ 进入工作台 ↗ ]   先看看流程 ↓                       （电视下方的光斑）     │
│  … ACTION ✦ 喵 ✦ LANMIAO TV ✦ JUMP CUT ✦ …            （第二行大字，向右滚） │
└────────────────────────────────────────────────────────────────────────────┘
```
- 两列网格：`grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr)`，间距 64，最大宽 1280。
- **滚动大字**（背景层，`aria-hidden`）：两行，字号 148px，800，描边（§2.4），整体 `rotate(-4deg)`；第一行在首屏顶部 14% 处向左滚，第二行在底部 12% 处向右滚，各 40 秒一圈（内容重复两遍，`translateX(0 → -50%)`）。文字固定：`LANMIAO TV ✦ JUMP CUT ✦ ACTION ✦ 喵 ✦ `。
- **眉标**：`● CH 01 · NOW PLAYING`，`--lm-mono` 12px，圆点是 `--lm-pink`，每 1.2 秒闪一下（opacity 1 → .25 → 1）。
- **主标题**（`HomeHeadline`）：两行。中文第 1 行「让故事，」，第 2 行「跃然屏上。」；英文第 1 行「Stories that」，第 2 行「leap off the screen.」。
  - 中文按字拆成 `<span class="lm-ch" style="--i: n" aria-hidden>`，英文按**单词**拆（不拆字母）。整个 h1 加 `aria-label` 写完整句子。
  - 重点字：中文「跃」、英文「leap」，加类 `lm-ch-leap`：文字用 `--lm-grad`（`background-clip: text`），脚下有一个椭圆影子（`::after`，宽 70% 高 8px，`rgba(110,123,255,.5)` 的径向渐变，随跳跃缩小变淡）。
- **说明**：最大宽 520。
  - 中：「LanmiaoTV 是给创作团队的 AI 动漫制作工作台：从剧本、角色与场景，到分镜和成片，都在一块无限画布上完成。」
  - 英：「LanmiaoTV is an AI anime studio for creative teams. Script, characters, storyboards and the final cut, all on one infinite canvas.」
- **按钮行**（间距 20）：
  - 主按钮「进入工作台」（英文 Enter the studio）+ `ArrowUpRight`：高 52，圆角 26，左右内边距 28，`--lm-grad` 底，白字 16/650，阴影 `0 12px 32px -8px rgba(155,107,255,.6)`。`<Link href={{ pathname: '/auth/signin' }} data-lm-enter data-testid="home-enter">`。
  - 文字按钮「先看看流程」（英文 See how it flows）+ `ArrowDown`：`--lm-ink-2`，悬停变白；点击平滑滚到 `#flow`。
- **电视** `HomeTv`（右列，水平居中）：
  - 外层 `.lm-tv-rig`（承担倾斜，§4.5），宽 `min(520px, 100%)`。
  - 外壳 `.lm-tv`：`aspect-ratio: 16 / 10.5`，圆角 30，内边距 12，底色 `--lm-bg-3`，边框 `1px solid var(--lm-line-2)`，阴影 `0 40px 80px -30px rgba(5,6,20,.9), inset 0 1px 0 rgba(255,255,255,.12)`。右下角外壳上有两个 6px 的小圆点（一个 `--lm-pink` 常亮，一个 `--lm-line-2`），是「电源灯」。
  - 屏幕 `.lm-tv-screen`：填满外壳内部，圆角 20，`overflow: hidden`，里面依次是：当前频道画面（§3.2.1）、扫描线层、一道斜向高光（每 6 秒从左扫到右一次）、OSD。
  - OSD（都是 `--lm-mono` 12px，白色 85% 不透明，带 1px 深色投影保证可读）：左上 `CH 01 · 故事`（英文 `CH 01 · STORY`）；右上时间码 `00:00:12:08`（时:分:秒:帧，24 帧，从页面打开时开始走，每秒更新 12 次，离开视口暂停）；底部左侧四个频道点（8px 圆点，当前的是 20×8 的胶囊，带主色），底部右侧一条 2px 进度条，随当前频道的 3.2 秒计时走满。频道点是 `<button aria-label="切换到频道 2：资产">`，可以点。
  - 电视正下方 24px 处有一块椭圆光斑（宽 70%，高 40px，`radial-gradient` 取当前频道主色 45% 不透明），换台时颜色跟着变（300ms 过渡）。
- **蓝猫** `HomeCat`：在 `.lm-tv-rig` 里、DOM 顺序在 `.lm-tv` **前面**（所以被电视挡住下半身）。
  - `<NoriBrandMark size={184} alt="" />`（实际渲染约 184×155），绝对定位：`right: 12%; bottom: 100%;`，再 `translateY(40%)`，也就是猫身高的 40% 藏在电视后面，露出耳朵、脸和举起的两只爪子。
  - 猫是一个 `<button class="lm-cat" aria-label="蓝猫（点一下试试）">`（英文 `Lanmiao the cat (give it a tap)`），点击触发彩蛋（§4.5）。
  - 手机上 `size={120}`，平板 `size={152}`。**任何断点、任何动画帧里，猫 PNG 的底边都不能露出来**（§9.3 有专门的断言）。

#### 3.2.1 四个频道画面 `HomeScenes`（纯 CSS + 内联 SVG）
`<HomeScene index={0..3} playing={boolean} />`，首屏电视里一次显示一个；流程区四张卡片里各放一个缩小版（同一个组件，容器小一些）。所有尺寸用百分比或 `em`，保证放大缩小都成立。
| 频道 | 画面 | 循环动作（`playing` 时才动） |
|---|---|---|
| 01 故事 | 左上角一个小标签「SCENE 1」；五条圆角横条模拟台词行，宽度 78% / 64% / 82% / 46% / 58%，从上到下白色不透明度 .85 → .35；最后一行末尾一个闪烁的方块光标 | 横条依次从左展开（`scaleX 0→1`，原点左，每条间隔 140ms，`--lm-out` 420ms）；光标 1 秒闪一次 |
| 02 资产 | 3×2 六块圆角色块，底色依次是紫、洋红、青、暖黄、猫蓝、品牌紫；每块中间一个白色简笔图形：人形（圆 + 圆角矩形）×2、山形（两个三角）×2、星形 ×1、立方体 ×1 | 六块依次翻入（`rotateY 90°→0`，`--lm-spring` 520ms，间隔 80ms） |
| 03 镜头 | 一条横向胶片：三格画面（每格是一个渐变色块 + 一条地平线）；上面叠一个取景框：四个角标 + 中心十字；左上一个红点 + `REC` | 胶片匀速向左移动一格（3.2 秒）；中间那格放大到 1.06 再回来；红点闪烁 |
| 04 成片 | 天空渐变；一个暖黄色太阳；两层深紫色山丘（两个大椭圆）；正中一个 56px 白色圆形播放键；底部一条进度条 | 太阳上升（`translateY 30%→0`，`--lm-out` 1.2 秒）；播放键外圈脉冲（放大到 1.6 并淡出，1.6 秒一次）；进度条走满 |

### 3.3 流程区 `HomeFlow`（`<section id="flow" data-ch="02">`）
上下内边距 140（手机 88）。
- 眉标：`CH 02 · HOW IT FLOWS`。
- 标题：中「一个念头，四次起跳。」英「One idea. Four jumps.」
- 说明：中「每一步都接着上一步的结果往下做，不用在工具之间来回搬运。」英「Each step picks up where the last one landed. No hauling files between tools.」
- 四张卡片一行（`grid-template-columns: repeat(4, minmax(0, 1fr))`，间距 20；平板 2×2；手机单列）。每张卡片：圆角 24，底 `--lm-bg-2`，边框 `1px solid var(--lm-line)`，内边距 20；上半部分是缩小版频道画面（`aspect-ratio: 16/10`，圆角 14），下面是编号、标题、说明。卡片顶边有一条 3px 的主色线（各频道主色）。

| 编号 | 标题（中 / 英） | 说明（中 / 英） |
|---|---|---|
| `01 故事` / `01 STORY` | 写下一句话 / Write one line | 把一句灵感扩成剧本和分集大纲。 / Grow a single idea into a script and episode outline. |
| `02 资产` / `02 ASSETS` | 搭好你的世界 / Build your world | 角色、场景、道具统一管理，前后不走样。 / Characters, scenes and props in one library, consistent from shot to shot. |
| `03 镜头` / `03 SHOTS` | 排出每个镜头 / Block every shot | 分镜、机位、提示词，逐个镜头都能改。 / Storyboard, camera and prompt, editable shot by shot. |
| `04 成片` / `04 FILM` | 按下播放 / Press play | 生成、超分、剪辑，一路做到成片。 / Generate, upscale and edit, all the way to the final cut. |

- **小球**（仅在四张卡片排成一行时显示，即宽度 ≥ 1200）：一颗 18px 的圆球（`--lm-grad`，外发光 `0 0 24px rgba(155,107,255,.8)`），在卡片上沿上方，从第 1 张跳到第 4 张，每跳 1.2 秒，落到哪张卡片，那张卡片就往下沉 6px 再弹回、顶边的线亮一下、卡片里的画面开始播放（§4.4）。`aria-hidden`。
- 平板和手机没有小球：卡片按 1.2 秒间隔轮流「被踩一下」并播放画面，节奏一样。

### 3.4 能力区 `HomeBento`（`<section id="canvas" data-ch="03">`）
- 眉标：`CH 03 · ONE CANVAS`。
- 标题：中「一块画布，装下整个片场。」英「One canvas. The whole studio.」
- 说明：中「文本、图片、视频、3D 和互动剧情，都是画布上可以连线的节点。」英「Text, images, video, 3D and interactive story are all nodes you can wire together.」
- 六块卡片，12 列网格，行高 `minmax(220px, auto)`，间距 20：

| 块 | 位置（桌面） | 标签 | 标题（中 / 英） | 里面的小动画（都是示意，`aria-hidden`） |
|---|---|---|---|---|
| A | 第 1–7 列，跨 2 行 | 无限画布 / Infinite canvas | 把想法连起来 / Wire ideas together | 点阵背景（`radial-gradient(rgba(163,172,255,.14) 1px, transparent 1px) 0 0 / 18px 18px`，和真实画布一样）；三张节点小卡片「文本」「图片」「视频」沿左下到右上斜向排开，圆点颜色分别是紫、洋红、青；两条贝塞尔连线依次画出来（`stroke-dashoffset`，各 600ms）；一颗小光点沿连线跑过去；「视频」节点里一个小圆环转满后变成 ▶。6 秒一轮 |
| B | 第 8–12 列，第 1 行 | 剧本与分镜 / Script to storyboard | 从文字到镜头 / From words to shots | 左边三条文字横条，右边三格分镜小方块；横条依次变亮，对应的方块跟着弹出来 |
| C | 第 8–12 列，第 2 行 | 资产库 / Asset library | 角色不走样 / Characters stay in character | 五个圆形头像色块叠成一排（每个压住前一个 30%），依次从下方弹入；悬停时散开成不重叠的一排 |
| D | 第 1–4 列，第 3 行 | 生成 · 超分 · 编辑 / Generate · Upscale · Edit | 一镜一镜打磨 / Polish shot by shot | 一格画面，一条竖线从左扫到右，线左边清晰（纯色块边缘锐利）、右边是低清（用 6×4 的大色块马赛克表示）；扫完停 1 秒再重来 |
| E | 第 5–8 列，第 3 行 | 3D 导演台 / 3D director's stage | 先摆机位，再开拍 / Set the camera, then roll | 一个线框立方体缓慢自转（CSS 3D，六个只有边框的面）；旁边一个小摄像机图标绕着它做 90° 的弧线往返 |
| F | 第 9–12 列，第 3 行 | 互动影游 / Interactive story | 让观众选下一幕 / Let the audience pick the next scene | 一个起点圆点分出两条岔路，各通向一个选项胶囊「A」「B」；两条路轮流点亮（2.4 秒一换），悬停某个胶囊时那条路常亮 |

  - 卡片样式：圆角 28，底 `--lm-bg-2`，边框 `1px solid var(--lm-line)`，内边距 24；标签是 `--lm-mono` 12px 的小胶囊（边框 `--lm-line-2`）；标题在左下角。
  - 平板：两列，A 占满一行；手机：单列，每块最小高 200，A 高 300。
  - **实现前核对**：六块对应的功能在产品里都要有入口（画布、编剧工作台、资产库、视频超分 / 视频编辑、3D 导演台、互动影游，对应 `src/app/[locale]/` 下的 `canvas`、`screenwriter` 或 `writer-workbench`、`asset-hub`、`video-enhance`、`interactive`，以及画布「添加节点」里的 3D 导演台）。哪一块在当前线上版本没有入口，就删掉那一块，D/E/F 那一行改成剩余块等分，写进部署记录。

### 3.5 收尾区 `HomeFinale`（`<section id="start" data-ch="04">`）
最小高 `86vh`，内容居中。
- 背景：和首屏同样的三团光晕；外加一圈缓慢旋转的放射光（`conic-gradient`，12 条浅色光束，整体不透明度 .10，120 秒转一圈，中心在按钮位置）。
- 眉标：`CH 04 · YOUR TURN`。
- 标题（居中，h2 用主标题的字号档）：中「下一幕，轮到你。」英「The next scene is yours.」
- 一块「舞台」卡片（宽 `min(560px, 100%)`，圆角 32，底 `--lm-bg-2`，边框 `--lm-line-2`，内边距 36，居中）：
  - 蓝猫从卡片**上沿后面**探出来（同 §3.2 的做法：DOM 在卡片前面，`bottom: 100%; translateY(40%)`，水平居中，`size={168}`）；
  - 大按钮「登录，开始创作」（英文 Sign in and start creating）：高 60，圆角 30，宽 100%，`--lm-grad`，18/700；`<Link … data-lm-enter data-testid="home-enter-final">`；
  - 小字（`--lm-ink-3`，13px，居中）：中「账号由团队管理员分配，暂不开放自行注册。」英「Accounts are issued by your team admin. Self sign-up is closed.」

### 3.6 页脚
一行，上边 `1px solid var(--lm-line)`，上下内边距 24，12px `--lm-ink-3`；手机上分两行居中。
- 左：`© {年份} LanmiaoTV`，后面跟 ` · ` 和备案号链接（`<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" data-testid="home-icp">`），没有备案号就只显示版权。
- 右：中「故事，由你定义。」英「MADE FOR STORIES. BUILT FOR CREATORS.」（和登录页页脚一致）。

### 3.7 频道拨盘 `HomeChannelDial`（仅宽度 ≥ 1200 且高度 ≥ 640）
- `position: fixed; right: 28px; top: 50%; transform: translateY(-50%); z-index: 40`。
- 四项竖排，间距 14：`01`、`02`、`03`、`04`（`--lm-mono` 11px），每项左边一条 2px 高的短横线（宽 14）。当前所在区块那一项：横线变成 28px 宽的渐变条，数字变白，右边滑出标签（中：开机 / 流程 / 画布 / 开始；英：ON AIR / FLOW / CANVAS / START）。
- 每项是 `<a href="#top|#flow|#canvas|#start">`，点击平滑滚动。当前项由 §4.3 的进入视口监听决定。

## 4. 动效规范（批次 2）

### 4.0 总规则
1. 所有动画规则都包在 `@media (prefers-reduced-motion: no-preference) { … }` 里。**没有动画时的默认样式就是最终画面**（文字可见、卡片在位），所以关掉动效、CSS 动画不执行、JS 没加载，页面都是完整的。
2. 只动 `transform` 和 `opacity`。需要挤压拉伸的元素设 `transform-origin: 50% 100%`（脚底）。
3. 循环动画离开视口就暂停：每个 `<section>` 由 §8 的 hook 写 `data-lm-live="true|false"`，样式 `.lm-home [data-lm-live="false"] * { animation-play-state: paused !important; }`。
4. 需要保持同步的一组动画（流程区的小球和四张卡片、「跃」字和猫），靠「同一时刻开始 + 相同周期」同步：它们的 `animation` 都由同一个祖先类（`.is-in`）触发，不要用 JS 定时器对拍。
5. 一个元素同时有两种运动（比如猫既要轻轻起伏又要跳），用嵌套的两层元素分别承担，不要在一个元素上叠两个 `transform` 动画。

### 4.1 时间线：首屏进场（纯 CSS，不依赖 JS）
| 时刻 | 元素 | 动作 |
|---|---|---|
| 0 ms | `.lm-boot`（固定全屏，`z-index: 100`，上下两片底色挡板 + 中间一条 2px 白色亮线） | 亮线 `scaleX(0 → 1)`，180 ms，`--lm-out` |
| 180 ms | 上下挡板 | 上片 `translateY(0 → -100%)`、下片 `translateY(0 → 100%)`，360 ms，`--lm-out`；亮线同时淡出 |
| 540 ms | `.lm-boot` | `visibility: hidden`（用 `animation-fill-mode: forwards` 的关键帧收尾，不靠 JS 移除） |
| 380 ms 起 | 标题每个字 `.lm-ch` | `lm-hop` 720 ms，延迟 `calc(380ms + var(--i) * 70ms)`，`animation-fill-mode: both` |
| 520 ms | 眉标、说明、按钮行 | 说明只做 `translateY(16px → 0)`（**不从透明开始**，保证首屏文字立刻被浏览器计入）；眉标和按钮行 `opacity 0 → 1` + `translateY(12px → 0)`，420 ms，`--lm-out`，依次间隔 80 ms |
| 600 ms | 电视 `.lm-tv` | `scale(.92) translateY(24px) → 无`，`opacity 0 → 1`，640 ms，`--lm-spring` |
| 900 ms | 猫（外层 `.lm-cat`） | `translateY(105% → 40%)`，620 ms，`--lm-spring`（从电视后面冒出来） |
| 1,400 ms 起 | 「跃」字和猫的循环跳（§4.2）、频道进度条开始走 | |

`lm-hop`（字的跳入）：
```css
@keyframes lm-hop {
  0%   { opacity: 0; transform: translateY(110%) scale(.9, 1.15); }
  20%  { opacity: 1; }
  55%  { transform: translateY(-18%) scale(.96, 1.06); }
  76%  { transform: translateY(0) scale(1.12, .86); }   /* 落地压扁 */
  90%  { transform: translateY(-3%) scale(.98, 1.03); }
  100% { opacity: 1; transform: none; }
}
```
`.lm-ch { display: inline-block; transform-origin: 50% 100%; }`。

### 4.2 「跃」字与猫：同一拍的循环跳
周期 4.8 秒，无限循环，第一次从 1,400 ms 开始（`animation-delay: 1.4s`）。
```css
@keyframes lm-leap {            /* 「跃」字 / 英文 leap 一词 */
  0%, 22%, 100% { transform: none; }
  4%  { transform: scale(1.14, .82); }                       /* 下蹲蓄力 */
  10% { transform: translateY(-34%) scale(.92, 1.14); }      /* 起跳拉长 */
  13% { transform: translateY(-42%) scale(1, 1); }           /* 最高点 */
  17% { transform: translateY(0) scale(1.16, .80); }         /* 落地压扁 */
  20% { transform: translateY(-6%) scale(.98, 1.03); }       /* 小回弹 */
}
@keyframes lm-leap-shadow {     /* 「跃」字脚下的影子，同周期 */
  0%, 22%, 100% { transform: scaleX(1); opacity: .5; }
  13% { transform: scaleX(.55); opacity: .2; }
  17% { transform: scaleX(1.15); opacity: .6; }
}
@keyframes lm-cat-jump {        /* 猫的内层 .lm-cat-jump，同周期同延迟 */
  0%, 22%, 100% { transform: none; }
  4%  { transform: translateY(4%) scale(1.06, .94); }
  12% { transform: translateY(-22%) scale(.97, 1.05); }
  17% { transform: translateY(2%) scale(1.05, .95); }
  20% { transform: translateY(-3%); }
}
```
- 「跃」字在进场时先用 `lm-hop` 跳入，再接 `lm-leap`：写成 `animation: lm-hop 720ms … both, lm-leap 4.8s 1.4s infinite;`（两个动画先后作用在同一个元素上是允许的，因为第一个结束后才开始第二个；`lm-hop` 的延迟保证它在 1,400 ms 前结束）。
- 猫的三层：外层 `.lm-cat`（定位 + 进场 + 静止偏移 `translateY(40%)`）→ 中层 `.lm-cat-bob`（呼吸：`translateY(0 ↔ -3%)`，3.2 秒往返）→ 内层 `.lm-cat-jump`（上面的跳）。最高点时猫仍有约 15% 藏在电视后面，底边不会露出。**猫不做旋转**（旋转会把底边的角翘出来）。
- 收尾区的猫用同样的三层和同样的 `lm-cat-jump`，但没有「跃」字陪它，周期改 3.6 秒。

### 4.3 滚动进入（JS：一个 `IntersectionObserver`）
- 需要进场的元素写 `data-lm-reveal`（可选 `style="--d: 80ms"` 作为延迟）。进入视口 15% 后加类 `is-in`，**只加不减**（往回滚不重播）。
- 隐藏的初始状态只在 JS 已接管时生效，避免 JS 失败时内容永远不可见：
  ```css
  @media (prefers-reduced-motion: no-preference) {
    .lm-home[data-lm-js] [data-lm-reveal]:not(.is-in) { opacity: 0; transform: translateY(28px) scale(.98); }
    .lm-home[data-lm-js] [data-lm-reveal] { transition: opacity .5s var(--lm-out) var(--d, 0ms), transform .7s var(--lm-spring) var(--d, 0ms); }
  }
  ```
  `data-lm-js` 由 hook 在 `useLayoutEffect` 里设置，并且**同一次执行里**先给已经在视口内的元素加上 `is-in`，再设 `data-lm-js`（顺序不能反，否则首屏内容会闪一下）。
- 区块标题（h2）不拆字，整行用上面的进场；眉标比标题早 80 ms，说明晚 80 ms，卡片按顺序每张晚 70 ms。
- 同一个 observer 还负责：给每个 `<section>` 写 `data-lm-live`（§4.0 第 3 条，阈值 0，`rootMargin: '10% 0px'`）；把视口中线所在区块的 `data-ch` 写到根节点 `data-lm-ch`，频道拨盘据此高亮。

### 4.4 电视换台与流程区小球
**换台**（首屏电视）
- 当前频道是 React state `channel`（0–3）。底部进度条是一个 CSS 动画（`scaleX(0 → 1)`，3.2 秒，`linear`，原点左），**它的 `onAnimationEnd` 触发 `setChannel((c) => (c + 1) % 4)`**。不用 `setInterval`：这样悬停暂停、离开视口暂停、关闭动效（不自动换台）都自动成立。
- 进度条、画面容器、闪光层都带 `key={channel}`，换台时重新挂载，动画自然重播：
  - 画面容器 `lm-tune-in`：`scaleY(.03) → scaleY(1)`，420 ms，`--lm-spring`，原点居中（一条亮线撑开成画面）；
  - 闪光层 `lm-tune-flash`：一层带噪点底纹的白色（`opacity .85 → 0`，260 ms）；
  - 左上角 OSD 文字 `lm-osd-in`：`translateY(100%) → 0`，240 ms，`--lm-out`（外面套一个 `overflow: hidden` 的行）。
- 鼠标悬停或键盘焦点在电视上时暂停（`.lm-tv:hover *, .lm-tv:focus-within * { animation-play-state: paused }`，只对进度条和画面循环生效）。
- 点底部的频道点：直接 `setChannel(i)`。
- **画面里的动作**（§3.2.1 表格的「循环动作」）：统一写成 `animation: <名字> var(--lm-cycle) infinite both`，动作集中在周期的前 18%，其余时间保持最终状态；需要错开的子元素用 `animation-delay`。电视里 `--lm-cycle: 3.2s`，流程卡片里 `--lm-cycle: 4.8s`。光标闪烁、REC 红点、播放键脉冲这三种是独立的小循环，周期按 §3.2.1。

**小球**（流程区，宽度 ≥ 1200）
- 结构：`.lm-ball-track`（绝对定位在卡片行上方，左右各缩进半张卡片的宽度：`left: calc((100% - 60px) / 8); right: calc((100% - 60px) / 8)`，60px 是三个 20px 间距）→ `.lm-ball-x`（宽度 100%，只做横向移动）→ `.lm-ball`（18px 圆球，在 `.lm-ball-x` 的左端，做纵向的跳）。
  横向用百分比的技巧：`translateX` 的百分比相对元素自己的宽度，`.lm-ball-x` 和轨道同宽，所以 `33.333%` 正好是一张卡片的间隔。
- 周期 4.8 秒，四段各 1.2 秒：
  ```css
  @keyframes lm-ball-x {
    0%, 5%   { transform: translateX(0); }
    25%, 30% { transform: translateX(33.333%); }
    50%, 55% { transform: translateX(66.667%); }
    75%, 88% { transform: translateX(100%); }
    88.01%, 100% { transform: translateX(0); }
  }
  @keyframes lm-ball-y {   /* 每段：停 → 起跳 → 最高点 → 落地压扁 */
    0%, 5%, 25%, 30%, 50%, 55%, 75% { transform: translateY(0) scale(1); opacity: 1; }
    1.5%, 26.5%, 51.5%, 76.5% { transform: translateY(0) scale(1.25, .75); }
    15%, 40%, 65% { transform: translateY(-64px) scale(.92, 1.1); }
    82%  { transform: translateY(0) scale(1); opacity: 1; }
    88%  { transform: translateY(-28px) scale(.6); opacity: 0; }       /* 在第 4 张上淡出 */
    92%  { transform: translateY(-80px) scale(.8); opacity: 0; }       /* 回到第 1 张上方 */
    100% { transform: translateY(0) scale(1); opacity: 1; }            /* 落下 */
  }
  ```
  `lm-ball-x` 用 `linear`；`lm-ball-y` 上升段用 `--lm-out`、下落段用 `--lm-in`（在对应关键帧里写 `animation-timing-function`）。
- 卡片被踩：四张卡片都跑同一个 4.8 秒动画 `lm-stomp`（`0% 无 → 2% translateY(6px) → 7% 无`，其余不动），第 n 张（从 0 数）`animation-delay: calc(n * 1.2s)`；卡片顶边的主色线同步亮一下（`opacity .5 → 1 → .5`）；卡片里画面的 `--lm-cycle` 动画也用同样的延迟，于是小球落到哪张，哪张的画面就从头播放。
- 平板和手机没有小球，其余（卡片轮流被踩、画面轮流播放）不变。

### 4.5 指针交互（仅 `(hover: hover) and (pointer: fine)`）
- **电视倾斜 + 光斑**：首屏监听一次 `pointermove`（`requestAnimationFrame` 节流，离开首屏不处理），把指针相对首屏中心的位置（−1 到 1）写进首屏元素的 CSS 变量 `--lm-px`、`--lm-py`。
  - `.lm-tv-rig { transform: perspective(1200px) rotateY(calc(var(--lm-px, 0) * 5deg)) rotateX(calc(var(--lm-py, 0) * -4deg)); transition: transform .25s var(--lm-out); }`
  - 背景里一块 520px 的柔光（`radial-gradient(closest-side, rgba(110,123,255,.22), transparent)`）跟着指针平移（`translate3d(calc(var(--lm-px) * 18vw), calc(var(--lm-py) * 14vh), 0)`，过渡 .4 秒）。
- **按钮**：主按钮悬停 `translateY(-3px) scale(1.03)`（260 ms，`--lm-spring`），里面的箭头向右上弹 3px；按下 `scale(.97, .94)`（80 ms）。「登录」按钮同理（§3.1）。
- **卡片**：悬停上浮 6px、边框变 `--lm-line-2`、底色变 `--lm-bg-3`（300 ms，`--lm-spring`）；能力区卡片里的小动画悬停时速度不变。
- **猫的彩蛋**：点猫 → 内层加类 `is-pounce` 播放一次大跳（`translateY(-34%)`，其余同 `lm-cat-jump`，700 ms），同时猫头右上方弹出一个气泡「喵！」（英文 `Meow!`；圆角胶囊，白底深字 14/700，`scale(0) → 1` 用 `--lm-spring`，停 900 ms 后缩回）。连续点第 5 次，气泡文字换成「开拍！」（英文 `Action!`），之后重新计数。动画播放期间忽略新的点击。气泡 `aria-live="polite"`。关闭动效时：不跳，只显示气泡。

### 4.6 进入登录页的转场（批次 3）
所有带 `data-lm-enter` 的链接（顶栏「登录」、首屏「进入工作台」、收尾「登录，开始创作」）共用：
1. 点击处理：按了 Ctrl / ⌘ / Shift / Alt、或不是左键 → 不拦截（让浏览器正常新开标签页）。系统关闭动效 → 不拦截（直接跳转）。
2. 否则 `preventDefault()`，给根节点加 `data-lm-leaving`，显示 `.lm-off`（和 `.lm-boot` 相同的结构，动作相反）：上下挡板合拢 260 ms（`--lm-in`）→ 中间亮线 `scaleX(1 → 0)` 160 ms → 剩一个亮点淡出 60 ms。**总计 480 ms**。挡板颜色 `#0B0D1A`，和登录页底色一样，跳转前后不闪。
3. 480 ms 后 `router.push({ pathname: '/auth/signin' })`（`useRouter` 来自 `@/i18n/navigation`）。挡板保持到页面切换完成。
4. 鼠标移入或键盘聚焦这些链接时先 `router.prefetch`，保证动画结束时登录页已经准备好。
5. 兜底：`push` 之后 4 秒页面还没切走（网络问题），撤掉 `data-lm-leaving`，恢复首页；监听 `pageshow`，`event.persisted` 为真（从浏览器的后退缓存回来）时同样撤掉。
6. 转场期间重复点击无效（用 ref 挡住）。

## 5. 无障碍与关闭动效

- 语义：`<header>`、`<main>`、四个 `<section aria-labelledby>`、`<footer>`；一个 `h1`，每个区块一个 `h2`，卡片标题 `h3`。
- 所有装饰（滚动大字、光晕、频道画面、小球、能力区的小动画、电视的 OSD 时间码）加 `aria-hidden="true"`。拆字的标题用 `aria-label` 给出完整句子。
- 键盘：Tab 顺序 = 品牌 → 锚点链接 → 登录 → 进入工作台 → 先看看流程 → 猫 → 四个频道点 → 后面各区块 → 收尾按钮 → 备案号。所有可聚焦元素有 `:focus-visible` 样式：`outline: 2px solid #8F99FF; outline-offset: 3px`。
- 顶栏前加一个「跳到主要内容」链接（英文 Skip to content），平时隐藏，聚焦时出现在左上角。
- 文字对比度：正文 `--lm-ink-2` 在 `--lm-bg` 上约 9:1；`--lm-ink-3` 只用于页脚、备注这类 12–13px 的次要文字（约 5:1）。渐变字「跃」最暗处（`#6E7BFF` 对 `#0B0D1A`）约 5.6:1。
- **关闭动效（`prefers-reduced-motion: reduce`）时**：没有开机动画、没有任何循环动画、不自动换台（停在频道 01，仍可点频道点切换，切换没有过渡）、没有指针倾斜、锚点滚动用 `behavior: 'auto'`、登录链接直接跳转。页面内容和布局完全一样。

## 6. 响应式与兼容

| 断点 | 变化 |
|---|---|
| ≥ 1200 | §3 的完整布局；有频道拨盘、小球、指针倾斜 |
| 768–1199 | 首屏单列居中：眉标、标题、说明、按钮（居中对齐），下面是电视（最大宽 520）和猫；顶栏隐藏中间的锚点链接；流程 2×2，能力区两列；没有拨盘和小球；滚动大字 96px |
| < 768 | 标题 46px 左对齐；按钮行竖排，主按钮占满宽度；电视占满宽度（左右留 16），猫 120px；滚动大字 64px，只留第一行；流程、能力区单列；页脚两行居中 |
| 高度 < 640（横屏手机、小笔记本） | 首屏 `min-height` 取消，隐藏说明文字和滚动大字，电视最大宽 380 |
| 宽度 < 360 | 标题 40px，左右留白 12 |

- 任何宽度都不能出现横向滚动条。滚动大字、光晕、倾斜的电视都要被 `.lm-home` 的 `overflow-x: clip` 裁住。
- **不用的 CSS 特性**（旧内核不支持会坏布局）：`dvh` 只能跟在同属性的 `vh` 后面（防回归测试见编辑/主题方案 §3.2 的 `css-viewport-units`，这个文件同样受它检查）；不用 `:has()`、容器查询、`@scope`、滚动驱动动画（`animation-timeline`）。`aspect-ratio`（Chrome 88+）、`clip-path`、CSS 变量、`IntersectionObserver` 可以用。
- `linear()` 弹簧曲线不支持时自动退回 `cubic-bezier`（§2.1 已处理）。`backdrop-filter` 不支持时顶栏用不透明底色。
- 首页不在 `.fos-app` 里：根节点是 `<div className="lm-home">`，**不能**出现 `fos-app` 类（否则会被放大 1.2 倍并且固定定位）。

## 7. 性能预算（硬指标，批次 3 验收）

| 项 | 预算 |
|---|---|
| 首页相比登录页多出来的 JS（gzip） | ≤ 30 KB |
| `lanmiao-home.css`（gzip） | ≤ 16 KB |
| 图片请求 | 只有蓝猫 PNG 和站点图标；**0 个**视频、字体、第三方域名的请求 |
| 首屏最大内容绘制 LCP（1440×900 和 390×844，本机无头 Chrome） | ≤ 2,500 ms |
| 布局偏移 CLS | ≤ 0.02（进场动画只用 `transform`，电视和猫的位置用固定比例占位） |
| 动画流畅度：首屏停留 5 秒 + 匀速滚到底 | 帧间隔超过 34 ms 的帧 ≤ 5%（测法见 §9.3） |
| 同时在跑的动画数（`document.getAnimations()` 里 `playState === 'running'` 的） | 任意时刻 ≤ 40 |
| 离开首屏后首屏的循环动画 | 全部 `paused` |

- 不要给大量元素加 `will-change`。只给：电视 `.lm-tv-rig`、小球、两行滚动大字、三团光晕。
- 颗粒层是固定定位的静态图案，不做动画、不用 `mix-blend-mode`。
- 首页不需要的东西不加载：`grep` 首页的客户端 chunk，确认里面没有 `three`、`@xyflow/react`、`remotion`。它们如果是被 `providers.tsx` 带进来的，属于性能方案 §5.6 的范围，在那边处理，本文不动 `providers.tsx`。

## 8. 实现骨架

### 8.1 根组件
```tsx
// src/components/home/LanmiaoHome.tsx
'use client'
export function LanmiaoHome({ locale, icp }: { locale: 'zh' | 'en'; icp: string | null }) {
  const copy = HOME_COPY[locale]
  const rootRef = useRef<HTMLDivElement>(null)
  useHomeReveal(rootRef)                    // §4.3：is-in、data-lm-live、data-lm-ch、data-lm-js
  const enter = useEnterStudio(rootRef)     // §4.6：{ onClick, onPointerEnter, onFocus }
  return (
    <div ref={rootRef} className="lm-home" data-lm-ch="01" lang={locale === 'en' ? 'en' : 'zh-CN'}>
      <a className="lm-skip" href="#main">{copy.skip}</a>
      <div className="lm-boot" aria-hidden><i /><i /><b /></div>
      <div className="lm-off" aria-hidden><i /><i /><b /></div>
      <HomeHeader copy={copy} enter={enter} />
      <main id="main">
        <HomeHero copy={copy} enter={enter} />
        <HomeFlow copy={copy} />
        <HomeBento copy={copy} />
        <HomeFinale copy={copy} enter={enter} />
      </main>
      <HomeFooter copy={copy} icp={icp} />
      <HomeChannelDial copy={copy} />
    </div>
  )
}
```
- `page.tsx` 是服务端组件，`LanmiaoHome` 是客户端组件，首屏 HTML 由服务端渲染出来（文字、按钮、链接都在 HTML 里，JS 没加载完也能点登录）。
- 首屏进场动画是纯 CSS（§4.1），**不能依赖 JS 加类名才开始**，否则 JS 慢的时候会先看到静止画面再突然重播。

### 8.2 四个 hook（`useHomeMotion.ts`）
| hook | 做什么 | 要点 |
|---|---|---|
| `useHomeReveal(rootRef)` | 一个 `IntersectionObserver` 完成 §4.3 的三件事 | `useLayoutEffect`；先给视口内的 `[data-lm-reveal]` 加 `is-in`，再设 `data-lm-js`；卸载时 `disconnect`；浏览器没有 `IntersectionObserver` 时什么都不做（内容保持可见） |
| `usePointerTilt(heroRef)` | §4.5 的 `--lm-px`、`--lm-py` | 只在 `matchMedia('(hover: hover) and (pointer: fine)')` 且没关动效时挂监听；`requestAnimationFrame` 节流；指针离开首屏时两个变量归零 |
| `useTimecode(live)` | 电视右上角时间码 | `requestAnimationFrame` 循环，每 83 ms 更新一次文本（直接写 `ref.current.textContent`，**不要 `setState`**，避免每秒重渲染 12 次）；`live` 为假时停；关动效时显示固定的 `00:00:00:00` |
| `useEnterStudio(rootRef)` | §4.6 的转场 | 返回的处理函数挂在三个 `data-lm-enter` 链接上；用 `useRouter` / `router.prefetch`（来自 `@/i18n/navigation`）；4 秒兜底和 `pageshow` 恢复 |

关动效的判断统一用一个小函数 `prefersReducedMotion()`（`window.matchMedia('(prefers-reduced-motion: reduce)').matches`），在事件处理里现读，不存 state。

### 8.3 电视组件要点
```tsx
const [channel, setChannel] = useState(0)
// 进度条走完 → 下一个频道。animation-play-state 暂停时不会触发，所以悬停、离屏、关动效都自动不换台
<i key={channel} className="lm-tv-progress" onAnimationEnd={() => setChannel((c) => (c + 1) % 4)} />
<div key={`s${channel}`} className="lm-tv-picture"><HomeScene index={channel} playing /></div>
<i key={`f${channel}`} className="lm-tv-flash" />
```
- 首次渲染（频道 0）不播 `lm-tune-in`（进场已经有电视的弹入）：`lm-tv-picture` 只在 `channel` 变化过之后才带动画类（用一个 `useRef(false)` 记「是否换过台」）。
- 屏幕的 `aria-label`：中「示意画面：{频道名}」，英「Illustration: {channel}」；频道变化不朗读（不加 `aria-live`）。
- 电视底下光斑和 OSD 颜色通过 `style={{ '--lm-ch-color': … }}` 传入。

### 8.4 图标
`@/components/ui/icons` 里有 `ArrowUpRight`、`ArrowRight`；**没有 `ArrowDown`**，「先看看流程」的向下箭头用内联 SVG（`<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>`）。频道画面里的简笔图形全部是内联 SVG 或 CSS 形状，不引图标库。

### 8.5 备案号
`ICP_NUMBER` 是新的可选环境变量：没设置时页脚不显示备案号，功能不受影响。在 `.env.example`（有的话）加一行注释说明；生产环境的值由用户提供（§11），**不要猜、不要写进仓库**。

## 9. 验证

### 9.1 单元测试
1. `tests/unit/home/default-route.test.ts`（现有）必须仍然通过：已登录的默认去向还是 `/works`。
2. 新增 `tests/unit/home/home-page-contract.test.ts`（读源码做字符串断言，写法照抄 `tests/unit/frameos/auth-homepage.test.ts`）：
   - `src/app/[locale]/page.tsx` 包含 `getServerSession(`、`AUTHENTICATED_HOME_PATHNAME`、`<LanmiaoHome`；
   - `LanmiaoHome.tsx` 包含 `className="lm-home"`，不包含 `fos-app`；
   - `src/components/home/**` 里没有 `import('three')`、`from 'three'`、`<video`、`https://`（备案链接 `beian.miit.gov.cn` 除外）、`@font-face`；
   - `home-copy.ts` 的 `zh` 和 `en` 键完全一致；两种语言里都没有「注册」/`Sign up` 按钮文案；没有连续 3 位以上的数字（防止出现编造的统计数字，年份由代码生成不在文案里）；
   - `lanmiao-home.css` 包含 `prefers-reduced-motion`；不包含 `:has(`、`animation-timeline`、`@container`；每个 `dvh` 前一条声明是同属性的 `vh`。
3. `npm run check:locale-navigation`（现有的守卫）通过：首页的链接都用 `@/i18n/navigation` 的 `Link`。

### 9.2 预览与浏览器测试（全部无头，不启动 dev server）
沿用登录页的做法（`scripts/auth-home-preview.mjs` + `tests/browser/auth-home.fixture.tsx` + `tests/browser/auth-home.browser.mjs`）：
- `auth-home.fixture.tsx` 加一个分支：`params.get('home') === '1'` 时渲染 `<LanmiaoHome locale={locale} icp="测试备案号-1" />`。
- `tests/browser/stubs/navigation.tsx` 的 `useRouter` 加 `prefetch: () => {}`，`push` 改成把目标记到 `window.__lmPushed`（数组），供断言用。
- 新建 `tests/browser/home.browser.mjs`，截图放 `test-results/home/`。用例：
  1. **11 个视口**（和登录页同一组：1920×1080、1440×900、1366×768、1280×720、1024×600、900×600、768×480、540×700、390×844、375×667、320×568）：没有横向滚动条；`[data-testid="home-enter"]` 和 `[data-testid="home-signin"]` 在首屏可见且完全在视口内；`.lm-home` 存在、`.fos-app` 不存在；等 2 秒后首屏截图。
  2. **首屏文字立刻可读**：页面加载后 100 ms 内，`h1` 的 `aria-label` 正确，说明文字的 `opacity` 是 1。
  3. **进场结束**：2 秒后 `.lm-boot` 的 `visibility` 是 `hidden`；每个 `.lm-ch` 的计算后 `transform` 是 `none`（重点字除外）、`opacity` 是 1。
  4. **换台**：记下 OSD 文本，等 3.6 秒，文本变成下一个频道；点第 4 个频道点 → OSD 显示 `CH 04`；鼠标停在电视上 5 秒 → 频道不变。
  5. **猫不露底**（1440×900、768×1024、390×844 各测一次，分别在加载后 1.2 s、2.1 s（跳到最高点附近）、点击猫后 250 ms 三个时刻）：猫图片 BCR 的底边 ≥ 电视外壳 BCR 的顶边 + 8px；收尾区的猫同理对卡片上沿。
  6. **猫彩蛋**：点猫 → 出现文本「喵！」的气泡，1.5 秒后消失；连点到第 5 次 → 「开拍！」。
  7. **滚动**：滚到 `#flow` → 四张卡片都有 `is-in`；根节点 `data-lm-ch="02"`，拨盘第 2 项是当前项（1440 宽）；首屏 `data-lm-live="false"`，且首屏里所有 `getAnimations()` 的 `playState` 都不是 `running`。点顶栏「画布」→ 滚到 `#canvas`。
  8. **登录转场**：点「进入工作台」→ 100 ms 内根节点有 `data-lm-leaving`；600 ms 后 `window.__lmPushed` 里有 `/auth/signin`；连点 3 次只 push 一次。按住 Meta 点击 → 不出现 `data-lm-leaving`。三个入口（顶栏、首屏、收尾）各测一次。
  9. **关闭动效**（`page.emulateMedia({ reducedMotion: 'reduce' })`）：没有 `running` 的动画；全部内容可见；等 5 秒频道不变；点频道点仍能切换；点「进入工作台」立即 push（不等 480 ms）。
  10. **没有 JS**（`javaScriptEnabled: false` 的 context，直接加载预览页的服务端 HTML 做不到，所以改为：用 `react-dom/server` 的 `renderToString(<LanmiaoHome …/>)` 生成 HTML，配同一份 CSS 打开）：标题、说明、三个登录链接（`href` 指向 `/auth/signin`）都可见可点；没有任何元素停在 `opacity: 0`。
  11. **英文**（`?home=1&lang=en`，1440×900 和 390×844）：标题不溢出、不挤压按钮；所有文案是英文。
  12. **键盘**：从页面开头连按 Tab，顺序符合 §5；每个聚焦元素有可见的 outline；聚焦「进入工作台」按 Enter → 触发转场。
  13. **备案号**：有 `icp` 时 `[data-testid="home-icp"]` 存在且 `href` 是 `https://beian.miit.gov.cn/`；`icp={null}` 时不存在。
  14. 全程 `pageerror` 为 0；除预览服务器本身外没有任何外部域名的请求。

### 9.3 性能测量（批次 3，写进部署记录）
- **流畅度**：在预览页里注入脚本，用 `requestAnimationFrame` 记录相邻两帧的间隔。场景：首屏停 5 秒 → 用 `window.scrollBy(0, 12)` 每帧滚一次直到页面底。算「间隔 > 34 ms 的帧占比」，要求 ≤ 5%（无头 Chrome 加 `--enable-gpu-rasterization`；沿用 `tests/browser/canvas-pan-performance.browser.mjs` 里启用 GPU 的参数）。同时记录 `document.getAnimations().filter(a => a.playState === 'running').length` 的最大值，要求 ≤ 40。
- **LCP / CLS**：`PerformanceObserver`（`largest-contentful-paint`、`layout-shift`）在预览页读数，1440×900 和 390×844 各一次，要求见 §7。
- **体积**：测试机上 `next build` 后，对比 `/zh` 和 `/zh/auth/signin` 两个路由的 First Load JS（构建输出表格里有），差值 ≤ 30 KB；`gzip -c src/styles/lanmiao-home.css | wc -c` ≤ 16,384（源文件压缩后的近似值即可）。
- **真实环境**：测试机部署后，无头 Chrome 打开测试机首页（未登录），统计全部请求的传输字节数，写进部署记录（预期：首页比登录页多出的传输量 < 80 KB）。

### 9.4 品味自检清单（每批结束对着截图逐条打勾，写进部署记录）
1. 首屏在 1440×900 截图里：标题是画面里最大的东西，其次是电视；视线顺序是标题 →「跃」字 → 电视和猫 → 按钮。
2. 「跃」字的渐变和主按钮的渐变是同一个；全页没有第二种渐变按钮。
3. 所有运动都是「弹」的（有过冲或压扁），没有一处是匀速直线滑入或单纯淡入（光晕漂移、滚动大字、进度条这三种匀速的除外）。
4. 静止 3 秒的截图里，同一屏同时在动的东西不超过 4 处（首屏：「跃」字、猫、电视画面、滚动大字）。
5. 猫在任何截图里都不露出裁切的底边，没有被拉伸变形（宽高比和原图一致），没有锯齿（显示宽度 ≤ 200px）。
6. 没有任何「大数字」、客户 logo、用户评价、定价。
7. 四个频道的颜色在电视、流程卡片顶线、拨盘里是一致的。
8. 手机截图（390×844）：首屏不滚动就能看到标题和「进入工作台」按钮；电视可以在首屏下半部分露出一部分。
9. 英文版截图没有换行难看的孤字（标题第二行不少于两个词）。
10. 从首页点进登录页，再点登录页左上角品牌回到首页：两页底色一致，过渡时不闪白。

### 9.5 测试机验收
部署测试机后（R4），未登录访问 `http://<测试机>/` → 看到首页；点「进入工作台」→ 登录页；用测试账号登录 → 进入 `/zh/works`；登录状态下再访问 `/` → 直接到 `/zh/works`；退出登录 → 登录页；登录页点左上角品牌 → 首页。平台管理端口（8080）访问 `/` 的行为和改动前一致。结果和截图写进部署记录。

## 10. 批次、提交与完成标准

| 批次 | 内容 | 提交（建议） | 完成标准 |
|---|---|---|---|
| 1 | 路由（§1）、令牌与全部静态样式（§2）、全部区块的结构和文案（§3）、响应式（§6）、无障碍结构（§5）。**此时不写任何 `@keyframes`** | `feat(home): add the public LanmiaoTV landing route`、`feat(home): build the static landing sections` | 11 个视口截图通过 §9.2 第 1、10、11、13 条；§9.1 全部通过；截图里页面不靠动画也完整好看（§9.4 第 1、2、5–9 条） |
| 2 | 全部动效（§4.0–§4.5）、四个频道画面的循环动作、能力区的小动画、频道拨盘、猫彩蛋 | 按区块拆：`feat(home): animate the hero boot and headline`、`…tv channels`、`…flow ball`、`…bento loops`、`…pointer tilt and cat` | §9.2 第 2–7、9、12 条通过；§9.4 全部打勾 |
| 3 | 登录转场（§4.6）、性能测量与修正（§7、§9.3）、测试机部署与验收（§9.5） | `feat(home): add the power-off transition into sign-in`、`perf(home): …`（如有） | §9.2 第 8、14 条通过；§7 的预算全部达标；§9.5 通过；部署记录写好 |

- 三个批次都完成后，一次性申请生产放行（H-R1）。放行消息里附：部署记录路径、1440×900 和 390×844 的首屏截图各一张、§7 的实测数字。
- 回滚：不改数据库和接口。回滚 = 换回上一个发布产物；或者只把 `src/app/[locale]/page.tsx` 恢复成原来的 `redirect`（一行改动），首页即下线，其余文件留着不影响任何功能。
- 性能预算不达标时的取舍顺序（先删前面的）：收尾区的放射光 → 滚动大字第二行 → 能力区 D/E/F 的小动画改为悬停才播放 → 指针跟随的柔光 → 颗粒层。标题跳入、「跃」字、猫、电视换台、小球这五样是概念本身，不删。

## 11. 需要用户做的事

1. **生产放行**（R6）：三个批次在测试机验收通过后，回复一次「同意上线」。
2. **备案号**（可选）：如果希望页脚显示 ICP 备案号，在放行时把备案号告诉实现方，由它写进生产环境变量 `ICP_NUMBER`（属于生产配置改动，包含在同一次放行里）。不提供就不显示。

除此之外不需要任何确认。

## 12. 不做（以及原因）

- **不用 three.js / WebGL / 视频 / Lottie / 动画库**：流量按量计费，首页是所有人的第一个请求；CSS 和 SVG 足够做出这套「弹跳」语言，而且在旧内核里更稳。
- **不重绘、不放大蓝猫**：只有 250×210 的 PNG，放大会糊；所以设计成「躲在电视后面探头」，小尺寸正好。将来有矢量或高清 IP 图再升级（换图即可，结构不变）。
- **不做滚动劫持、整屏吸附、横向滚动叙事**：在触控板和旧内核上体验不稳，也违反「能点到登录优先」。
- **不展示「用户作品」、不写统计数字、不放客户 logo**：没有可公开的真实素材和数据，不造假。
- **不做注册入口、定价、文档中心、博客**：产品不开放自行注册，这些内容目前不存在。
- **不改登录页**：登录页重设计在性能方案 §5，本文只负责首页和「进入登录页」的转场。
- **不做日间版首页**：品牌页始终深色。
- **不加统计/埋点脚本**。

