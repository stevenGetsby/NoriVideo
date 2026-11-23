# LanmiaoTV 动画首页测试机验收（2026-11-16）

依据：`docs/design/2026-11-15-lanmiaotv-animated-home-plan.md`。三个实现批次均已完成，当前仅部署测试机，未提交、未推送、未部署生产。

## 实现范围

- 未登录根路径显示完整公开首页；已登录用户仍进入 `/works`。独立 Admin surface 同时检查进程 surface 与请求端口，保持进入 `/works`。
- 完成中英文首屏、四步流程、六块能力卡、收尾、页脚、响应式和无 JS 静态结构；无注册入口，ICP 仅在 `ICP_NUMBER` 有值时显示。
- 完成开机、逐字跳入、「跃」字周期跳、四频道电视、时间码、蓝猫探头/点击彩蛋、流程小球、能力示意、频道拨盘和指针跟随。
- 三个登录入口共用关机转场，支持预取、单次导航、modifier 原生行为、reduced-motion 即时导航和 4.48 秒失败恢复。
- 样式只由 `src/components/home/LanmiaoHome.tsx` 引入；首页始终深色，不使用 `.fos-app`。
- 六块能力对应的产品入口均已确认存在：画布、编剧工作台、资产库、视频超分/编辑、互动影游及画布 3D 节点，无需删块。

未修改 `signin/page.tsx`、`FosAuthShell.tsx`、`nori-auth.css`、数据库 schema、API 路由或 `providers.tsx`；未新增 npm 依赖，未触碰 Finder 重复文件。

## 测试与构建

- 完整无头 Chromium 回归：30/30，通过；页面错误与外部域名请求均为 0。结果：`test-results/home/result.json`。
- 首页路由、默认路由和 Admin surface 聚焦单测：11/11 通过。
- `npm run check:locale-navigation` 通过；`git diff --check` 通过。
- 首页相关 TypeScript 检查无新增错误；全量 `tsc --noEmit` 仍有既有 Finder 重复文件错误，未修改这些文件。
- 既有 `tests/unit/frameos/auth-homepage.test.ts` 两项旧失败仍是登录页类名精确匹配及 `LanMiaoTV`/`LanmiaoTV` 大小写断言；没有为迎合旧断言修改受保护的登录页。
- 本机真实 Next build 成功；测试机候选版本真实 build 成功。路由构建输出：`/[locale]` 7.89 kB / First Load 155 kB；`/[locale]/auth/signin` 2.41 kB / First Load 164 kB，首页无正向 First Load JS 增量。

## 性能实测

| 指标 | 实测 | 预算 |
|---|---:|---:|
| 首页相对登录页 First Load JS | 无正向增量 | ≤ 30 KB gzip |
| `lanmiao-home.css` gzip | 8,941 B | ≤ 16,384 B |
| 1440×900 LCP | 132 ms | ≤ 2,500 ms |
| 390×844 LCP | 132–136 ms | ≤ 2,500 ms |
| 1440×900 CLS | 0 | ≤ 0.02 |
| 390×844 CLS | 0–0.000985 | ≤ 0.02 |
| 慢帧比例（首屏 5 秒 + 滚到底） | 0% | ≤ 5% |
| 同时 running 动画峰值 | 36（修正后复测） | ≤ 40 |
| 离开首屏后的首屏循环动画 | 全部暂停 | 全部暂停 |
| 第三方域名请求 | 0 | 0 |
| 视频请求 | 0 | 0 |

LCP/CLS、慢帧和动画峰值来自本机无头 Chrome，结果以 `test-results/home/result.json` 为准。同一指标的重复运行差异同时列出，不把峰值放宽为通过条件。

### 测试机真实传输量

使用无缓存、全新 context 的无头 Chromium + CDP，在 1440×900 下分别完整加载 `/zh` 与 `/zh/auth/signin`，稳定后统计 `Network.loadingFinished.encodedDataLength`（含响应头）。原始明细：`test-results/home/remote-transfer.json`。

| 路由 | 请求数 | 总传输 | JS | CSS | 同域字体 | 图片 |
|---|---:|---:|---:|---:|---:|---:|
| 首页 `/zh` | 23 | 572,286 B | 183,762 B | 107,649 B | 141,132 B | 56,960 B |
| 登录页 `/zh/auth/signin` | 24 | 739,157 B | 360,907 B | 98,594 B | 141,132 B | 56,960 B |
| 首页减登录页 | -1 | **-166,871 B（-162.96 KiB）** | -177,145 B | +9,055 B | 0 B | 0 B |

首页未增加总体传输量，满足比登录页多出的传输量低于 80 KB 的预期。两页均加载既有的两个同域品牌字体，未新增网络字体；图片只有既有蓝猫 PNG，另有站点图标请求。页面错误与外部域名请求均为 0。

## §9.4 截图品味自检

- [x] 1440×900 首屏标题最大，电视次之；视线顺序为标题 →「跃」→ 电视与猫 → 按钮。
- [x] 「跃」字与主按钮使用同一品牌渐变，没有第二种渐变按钮。
- [x] 主要运动采用起跳、压扁和回弹；匀速运动仅保留光晕、滚动大字和进度条。
- [x] 首屏循环视觉集中在「跃」、猫、电视和滚动大字；离屏区块暂停。
- [x] 首屏与收尾蓝猫均保持原图比例、显示宽度 ≤ 200px；桌面、平板、手机及点击跳跃采样均未露出裁切底边。
- [x] 无虚假统计、客户 logo、用户评价或定价。
- [x] 四个频道在电视、流程顶线与拨盘中保持一致配色。
- [x] 390×844 首屏无需滚动即可看到标题与「进入工作台」，电视在下方完整展示；全页无横向溢出。
- [x] 英文标题第二行含多个词，无单字孤行；桌面和手机均无标题/按钮挤压。
- [x] 首页关机进入登录页、登录页品牌返回首页已走通；两页底色一致，转场无闪白。

截图：`test-results/home/home-test-server-1440.png`、`home-test-server-390.png`、`home-en-1440.png`、`home-en-390.png`、`home-flow-motion.png`、`home-finale-motion.png`。

## §9.5 测试机真实验收

测试机：`http://nori.45-76-215-9.sslip.io`；仅使用测试成员账号，无付费生成。

1. [x] 匿名访问根路径：公开首页。
2. [x] 点击首屏「进入工作台」：关机转场后进入登录页。
3. [x] 测试成员登录：进入 `/zh/works`。
4. [x] 登录状态再访问根路径：直接进入 `/zh/works`。
5. [x] 退出登录：返回登录页。
6. [x] 登录页点击品牌：返回公开首页。
7. [x] Admin surface：带 `X-Forwarded-Port: 8080` 的 `/zh` 返回 307 `location: /zh/works`，公开首页仍为 200。

真实鉴权过程中页面错误与外部请求均为 0。截图：`test-results/home/home-test-server-signed-in.png`。验收后 `norivideo-test-web`、`norivideo-test-worker`、`norivideo-test-watchdog` 均为 active；公开首页和登录页当前均为 HTTP 200。

## 发布与回退

- 最终源码包：`.runtime/20261116-home-release/source.tar.gz`；SHA-256：`58acb33d6c3c27b2bd41a1c765ec19b0c861d6ad3b2f25bca4fd58c464cac959`，本机与测试机一致。
- 首轮 Admin 根路径回归根因是只检查进程级 surface；测试机通过请求端口区分。补上 `headers()` + `resolveRequestSurface()` 后恢复。
- 为避免旧发布脚本清空正在服务的目录，修正版在 `/opt/norivideo-test/app-home-candidate` 独立完整构建，成功后切换到 `/opt/norivideo-test/app`。回退版本保留在 `/opt/norivideo-test/app-pre-home-admin-fix`。
- 首轮 `prisma db push` 仅确认数据库已同步，无 schema 变更；独立修复构建未修改数据库。
- 回滚可换回上一发布产物，或只恢复原根路径重定向；其余首页文件不影响工作台。

## 生产状态

尚未提交、推送或部署生产，未运行真实付费生成。按 H-R1，三个批次现已合并为一次生产放行申请；ICP 仍不预设，需由生产环境变量提供。
