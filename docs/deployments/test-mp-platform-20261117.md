# 万一（原蓝喵剧场）微信小程序内容平台 测试机部署记录（2026-11-17）

依据 `docs/design/2026-11-16-wechat-miniprogram-content-platform-plan.md`，批次 B1–B5 全部实现并部署（B6 支付按文档仅设计、不实现）。品牌口径：**万一**（原名蓝喵剧场，2026-11-18 改名；本文下文历史记录仍保留旧名）。

**仅部署测试机 `45.76.215.9`，未部署生产、未推送远端、未运行真实付费生成、未上传小程序体验版。** 生产放行与小程序上传/提审/发布均由用户另行批准。

## 实现范围与提交

| 批次 | 内容 | 提交 |
|---|---|---|
| B1 | 小程序工作区隔离 + env keys | `0330a7e` |
| B1 | 内容平台 schema（17 张表） | `f601706` |
| B1 | 无会话 story loader（发布专用） | `9c99730` |
| B1 | 版本生成任务（流水线） | `3c8d7a8` |
| B1 | 发布页（上架信息/预检/版本） | `2e3e7bd` |
| B1 | 后台内容审核 | `c8e83e5` |
| B2 | 微信登录 + 独立 JWT | `cc1ff9b` |
| B2 | CDN 签名媒体地址 | `321f07d` |
| B2 | C 端内容 API | `61111a3` |
| B2 | 存档/收藏/评分/举报 | `7db19ee` |
| B3 | 小程序工程骨架 + runtime bundle | `bb06d43` |
| B3 | 小程序 lib（api/auth/track/attribution/cache） | `8aea613` |
| B3 | 发现页（首页/探索/搜索/排行/专题） | `19e9c01` |
| B3 | 详情与我的页 | `c296d81` |
| B4 | 播放器控制器（注入端口） | `4837e95` |
| B4 | 视频舞台/互动/联系表 | `3176168` |
| B4 | 结局卡/成就/资料同步 | `b6022b0` |
| B4 | 本地优先存档 + 云合并 | `c2d6891` |
| B5 | 定时上线/预约/订阅消息 | `1e907de` |
| B5 | 分享卡片/wxacode/海报 | `8b2bac8` |
| B5 | 渠道码与归因 | `92477bb` |
| B5 | 排行/推荐位/专题 | `ac3e24d` |
| B5 | 统计聚合/创作者与运营看板 | `1e3501a` |
| 验收修复 | 构建复跑 preflight 排除自身 | `49efd24` |
| 验收修复 | 画布代理媒体地址解析 | `5b79436` |

随源码包一并部署的既有未提交改动（动画首页、主题 token、性能、转绘、存储/媒体代理等）与 2026-11-16 部署记录一致，本次未新增改动。设计文档本身按约定不提交。

## 部署机制

- 源码包：`/tmp/mp-manifest.txt` 清单 2007 文件（`git ls-files` + `--others --exclude-standard`，过滤 test-results/node_modules/.next/coverage），`COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata` 打包约 12 MB。三轮部署共用同一清单（修复只改已跟踪文件）。
- 第一轮（`remote-build-20261117.sh` / `swap-20261117.sh`）：候选 `app-20261117-candidate`，`HUSKY=0 npm ci` → `NODE_OPTIONS=--max-old-space-size=3072 npm run build` → `npx prisma db push --skip-generate`（**17 张新表 create-only，无数据丢失**：mp_branch_stats、mp_channels、mp_events、mp_feature_slots、mp_job_states、mp_reports、mp_reservations、mp_shares、mp_subscriptions、mp_topics、mp_work_daily_stats、mp_works、consumer_favorites、consumer_ratings、consumer_saves、consumer_users、story_releases）。`BUILD_ID=gFyHT7syCxwv1ayCrw2uh`，回退点 `app-pre-20261117`。
- 第二轮 b（修复 `49efd24`）：package.json/package-lock.json/prisma schema 与现网 md5 一致 → 候选复用现网 node_modules，完整 `npm run build`；db push **already in sync**。`BUILD_ID=_c7KBCCJzXWXe_V3va7dE`，回退点 `app-pre-20261117b`。
- 第三轮 c（修复 `5b79436`）：同 b 机制，db push already in sync。`BUILD_ID=fJaRf-3CHLmRXEpGaPsf0`，回退点 `app-pre-20261117c`。
- 切换前置校验：build-done 存在、无 build-failed、候选 `.next/BUILD_ID`/`dist/worker.js`/`dist/storage-init.js`/`.next/server/app` 齐全、无同名备份 → 停 4 服务 → mv 备份 → mv 候选 → 起 4 服务。三轮均 4 服务 active，web 健康检查通过。
- 审核后台：测试机原无 admin surface（8080 无监听）。新增 `norivideo-test-admin.service`（web 单元克隆，仅端口改 8080），enabled + active；combined 镜像按请求端口解析 surface，admin 会话 cookie 命名空间 `nori-admin` 与 workspace 隔离。
- 候选配置继承现网 `.env`/`.env.local` 与 guard 校验过的 `app/config`、`app/data`，不携带本机 secret。测试机 env 增补：`MP_ENV_VERSION=trial`、`MP_ALLOW_TOS_DIRECT=1`、`MP_JOBS_ENABLED=1`、`MP_JWT_SECRET`（服务器端生成，不入仓库/文档/日志）。`MEDIA_CDN_BASE_URL` 未设 → 按 R5 测试机口径走 TOS presigned 兜底。`MP_APP_ID`/`MP_APP_SECRET` 留空待用户自填（C 端微信登录因此暂返回 503 `MP_WX_UNAVAILABLE`，属预期）。

## L.3 验收（无头 Chromium + curl，SSH 隧道 13000/18080）

验收账号 `duhongbo`（workspace admin），作品 workId `28b17b54-deab-4e1c-b4da-c43503ce36bd`（影游「测试」），上架草稿「千金迷局」slug `XTDcXq3a`。截图在 `test-results/mp-platform/`（不提交）。

| # | 步骤 | 结果 |
|---|---|---|
| 1 | 总览「发布到小程序」 | 通过：按钮出现（01-overview.png）；入口按 `story.canManage` 门控（代码复核）。无管理权限协作者负例未测（测试机无第二可用账号） |
| 2 | 上架信息保存 | 通过：PATCH listing 成功，刷新后 GET 仍在（02-publish.png） |
| 3 | 发布前检查 | 通过：0 error / 4 warning（interaction_no_picture ×2、choice_no_picture、mp_no_cover，均为可接受提示），「生成版本」可点 |
| 4 | 生成版本 | 通过（第三次）：release `a7a4dedb-4ccf-470f-b3f9-fd63260f3ee8` v3，任务走 text 队列（text.worker 处理 STORY_RELEASE_BUILD），状态 reviewing/progress 100，1 章 2 结局 76s。TOS `mp/releases/<rid>/` 下 20 个产物齐全（range-GET 逐一核实非空）：3 视频 ×{720.mp4,480.mp4,poster.jpg,last.jpg,sheet.jpg} + 1 图片 img.png + cover.jpg + share.jpg + trailer.mp4(2.9MB) + trailer_poster.jpg + program.json。前两次 build_failed 暴露两个真 bug（见下）。注意：测试机跨境拉 TOS 北京源仅 ~14KB/s，整轮构建约 30 分钟，单 ffmpeg pass 逼近 10 分钟超时上限——环境带宽问题，非代码 bug |
| 5 | program.json 红线 | 通过：4764 B，sha256 与 programHash 一致；全文无 `http`、`/api/storage`、`/m/`、manifest.source 原始 key、原始 key 前缀；5 处 `mp:<16hex>` 引用 ↔ 4 个 manifest 媒体条目 |
| 6 | 后台内容审核 | **受阻**：测试库 super_admin 数量为 0（部署后复查仍为 0）。按文档停下请用户提供 super_admin 账号；未建账号、未重置任何密码。审核后台已就绪：新增 `norivideo-test-admin.service`（web 单元克隆，`next start -p 8080`，同目录同 env，combined 镜像按端口解析 admin surface），active；负例已验：无 cookie → 401 UNAUTHORIZED，duhongbo workspace cookie → 403 FORBIDDEN |
| 7 | 立即/定时上线 | 待第 6 步 |
| 8 | C 端 home/works 红线 | 部分：`GET /api/mp/home` 200，`{"hero":[],"picks":[],"continue":[],"hot":[],"newest":[],"upcoming":[],"topics":[]}`（无 live 作品，无任何红线字段）；`POST /api/mp/auth/login` 503 `MP_WX_UNAVAILABLE`（未填 AppID，预期）。作品级验证待上线 |
| 9 | 下架/重新上线 | 待第 7 步 |
| 10 | 第二版本 immutable | 待第 7 步 |

### 验收暴露并修复的两个真 bug

1. **构建自锁**（`49efd24`）：构建任务复跑 preflight 时自身 `status=building` 命中 `mp_release_in_progress`，所有版本必然 build_failed。`preflightRelease(workId, excludeReleaseId?)` 构建时排除自身；发布页预检口径不变。回归：preflight 自排除单测 + release-build 断言 `preflightRelease('w1','r1')`；线上复核：v3 reviewing 期间再 POST releases → 409 `MP_RELEASE_IN_PROGRESS`（创作者侧守卫不受修复影响）。
2. **画布代理媒体地址漏收**（`5b79436`）：画布节点实际存 `/api/storage/sign?key=…`（TOS `getSignedUrl` 产物）与 `/m/<publicId>` 媒体短链，各 provider 的 `extractStorageKey` 不认相对路径 → `collectMediaRefs` 漏收 → 安全网「存在未处理的素材」。`media-refs` 增 `classifyAppUrl`（sign 取 key 参数、`/api/files/` 解码、`/m/` 留空 key），`downloadSource` 对 `/m/` 查媒体表直取 storageKey（不发 HTTP）。文档 §A 三种引用格式口径不变；原「sign URL 必违规」单测预期与文档矛盾，改为未知代理路径仍违规。回归：media-refs 3 项 + release-build 2 项。

验收数据修复（全部经公开 authoring API，未写库）：画布 document PUT ×2 补两个结局节点、删除断链 exit 与孤儿 scene、修正 timeout 连线（timeoutMode=default 无 timeout handle）、PATCH start 入口、PATCH listing。canvas revision 655。

## 测试命令与结果

- `npx cross-env BILLING_TEST_BOOTSTRAP=0 vitest run tests/unit/mp tests/unit/interactive`：**70 文件 962 通过**（B5 完成时 956，两个修复各 +1/+5）。
- `npx tsc --noEmit`：错误仅在存量 Finder「 2.」重复副本（R9 不处理）。
- `npx eslint`（src/lib/mp、src/app/api/mp、src/app/api/admin/mp、src/features/mp-publish 及触碰的管理文件）：通过。
- `npm run check:api-handler && check:test-route-coverage && check:test-tasktype-coverage`：通过（routes=324 public=11，taskTypes=51；匿名 releases stats 路由按既有 mp 匿名路由先例入 PUBLIC_ROUTE_ALLOWLIST）。
- `npx tsc -p miniprogram/tsconfig.json --noEmit`：通过（ReleaseStats 改本地 interface，避免服务端依赖进入小程序类型图）。
- 小程序包体：主包 416 KB / 总 680 KB（≤2 MB）。
- `git diff --check`：通过。

## 未完成项与原因

- L.3 第 6–10 步：等用户提供 super_admin 账号（测试库为 0，文档明令不自建、不重置密码）。
- C 端微信登录与作品级红线验证：等用户自填 `MP_APP_ID`/`MP_APP_SECRET`。
- L.5 真机预览：等用户提供 AppID + CI 上传密钥 + IP 白名单；上传体验版须用户先说「可以上传」；提审/发布只由用户操作。
- B6 支付：按文档仅设计，不实现。

## 约束遵守（R1–R15）

- R1：引擎语义未改，B 侧测试全绿；两个修复都在 mp/release 层，修代码不修受保护测试（media-refs 一项预期与文档 §A 矛盾，按文档口径更正并注明）。
- R2：版本 immutable，复用只读历史 manifest，不覆写旧版本文件（第 10 步待验）。
- R3：B 侧权限模型未触碰，发布仅 `story.canManage`。
- R4：C 端独立 ConsumerUser + MP_JWT_SECRET + Bearer，`/api/mp/*` 不读 next-auth 会话。
- R5：媒体 CDN-only；测试机 `MEDIA_CDN_BASE_URL` 未设 + `MP_ALLOW_TOS_DIRECT=1` → TOS presigned 兜底；program.json 无 http/代理/原始 key（第 5 步待验）。
- R6：无诱导分享。
- R7：秘钥仅 env；本文档与提交不含任何秘钥/完整 openid/手机号。
- R8：仅测试机；SSH 密码经 SSHPASS 环境变量（不回显）；未动生产、未用 lanmiao-prod 别名、未删 /data。
- R9：Finder「 2/3/4」副本跳过，tsc 存量错误如实记录。
- R10：全程无头（playwright-core + 系统 Chrome headless），无可见窗口。
- R11：小程序依赖仅在 miniprogram/package.json，根依赖零新增。
- R12：文案照文档逐字、最短中文、无 emoji。
- R13：无文档外功能。
- R14：每批 DoD 绿后提交，feat(mp)/fix(mp)，不跨批混提。
- R15：锚点不符即停（media-refs 单测与文档矛盾按文档 §A 口径处理并在提交与本记录注明）。