# 流量/流畅度优化 + 工作区全量同步（2026-11-17）

## 发布范围

按用户要求「先流量优化、再流畅度优化、检查服务健康后部署最新版本」，本次发布携带当前工作区全量源码（相对 20261115-current-workspace 基线 168 个文件变更），包括：

- **流量（T 批）**：素材/资产/选择器网格改走缩略图（GIF 与非光栅图回退原图）；`/m/{publicId}` 默认 302 到桶签名直链（`Cache-Control: public, max-age=300`，签名按小时桶缓存），`?proxy=1` 或 `PUBLIC_MEDIA_REDIRECT=0` 保留同源代理供 CORS 敏感消费方（取帧/波形/全景）；素材下载与视频增强下载改流式转发并新增 `mode=url` 直连（客户端失败自动回退服务器转发）；视频节点 `preload="metadata"`。
- **流畅度（C 批）**：新增 `selectZoomBucket` 粗粒度缩放订阅 + `CreativeNode` memo，缩放/平移不再逐帧重渲染全部节点；可见轮询与海报优先媒体沿用上一批成果。C5（自动保存差量缓存）、C6（undo 结构共享）风险较高，本次未动。
- **工作区同步**：小程序内容平台（mp 发布/审核/统计/消费者 API）、TGG 服务商模块与 standards 目录、LanmiaoTV 首页、互动节点批次、影游协作成员、主题 token 等已完成的未发布改动。TGG 仅代码与目录上线，**未切换服务商、未发起任何 TGG 请求**。

## 发布记录

- 发布目录：`/opt/norivideo/releases/20261117-perf-media`
- source fingerprint：`b7cf2cc8cd007192fed22e94e7f3d547a6d5ca69aa282f8fb6d8b27231ba1733`
- 构建产物 sha256：`ae6178e5fc51686ec3de50152c0e421fffb6e76687ca342e72ad883d4eb1ed3b`
- 候选镜像：`norivideo:release-20261117-perf-media`（`sha256:20fda0a8dec7…`）
- 上一版本：`norivideo:release-20261116-billing-float`（`sha256:95bd7b9af549…`，source label `d0a66388…`）
- 构建：服务器 `--network none` 容器内 `npm run build`，179 静态页，Prisma Client v6.19.2 重新生成；`prisma/` 与 `node_modules/.prisma/client` 随产物 COPY 覆盖基镜像。

## Schema 变更（纯增量）

f601706 起新增 17 张表：`story_releases`、`mp_works`、`mp_channels`、`mp_topics`、`mp_events`、`mp_shares`、`mp_subscriptions`、`mp_reservations`、`mp_reports`、`mp_job_states`、`mp_feature_slots`、`mp_work_daily_stats`、`mp_branch_stats`、`consumer_users`、`consumer_saves`、`consumer_favorites`、`consumer_ratings`，另有两个新表对 `works` 的外键。

- 本地 `prisma migrate diff`（基线 schema → 工作区 schema）确认：**0 行删除/修改，仅 17 CREATE TABLE + 2 ADD CONSTRAINT**，无既有表列变更。
- switch 守卫：拒绝任何 DROP/TRUNCATE/RENAME/ADD COLUMN/MODIFY；要求恰好 17 张新表与关键表名/外键；活动任务数为 0 才继续。
- `prisma db push --skip-generate` 后再次 diff 为空。无回填脚本（全部新表）。
- 回滚路径：`docker tag` 上一镜像为 latest 并 recreate app/admin；新表为增量，旧代码忽略即可，无需回滚数据库。

## 验证

- 本地：聚焦单测 34 通过（image-url 10 / zoom-bucket 2 / public-media-route 5 / storage 13 / material-download 4）；`tsc --noEmit` 无真实错误（仅 Finder「 2」副本噪声）；`git diff --check` 干净。
- 回归对照：`tests/unit/canvas` 9 失败 | 661 通过，与 HEAD 基线的 9 个失败一致；`tests/unit/frameos` 14 失败 | 538 通过，全部为早先主题 token / 资产归属批次的源码契约漂移（字面 hex vs token、上传归属默认值），与本批改动无关。
- load 离线校验：mp 模型存在于 schema 与生成客户端、`PUBLIC_MEDIA_REDIRECT`/`private, max-age=86400`/`signingBucketSeconds`/下载回退文案/LanmiaoTV/Decimal 计费修复均在产物中。
- switch 后健康：app/admin healthy 且同镜像；mysql `SELECT 1` 与 17 张新表确认；redis 认证 PONG；4 个 worker ready、watchdog tick 正常；nginx active，80→301、443→200；TOS guard + probe 通过；`BILLING_MODE=ENFORCE`、测试模式关闭；受保护文件逐字节一致。
- 线上行为探针：`/m/{publicId}` → **302** 到 TOS 签名直链（签名查询串未落日志）；`?proxy=1` → **200 video/mp4** 同源流式；首页 200；`/api/mp/me` 与素材下载未登录 401；admin mp-review 未登录 307。唯一 ERROR 日志为探针自身的 MP_UNAUTHORIZED，属预期。
- 备份：`/opt/norivideo/backups/20261117-perf-media/`（受保护文件、`nori.sql.gz`、`nori-pre-switch.sql.gz`、previous-image-id）。`/opt/norivideo/build` 已清理，`/data` 未触碰。

## 待办（需用户控制台操作）

- T3 直连下载在桶 CORS 配置前自动走服务器转发回退；配置 CORS 后 `mode=url` 直连生效。
- T4 CDN 加速需控制台开通，本次未含。
- C5/C6 画布历史/自动保存性能重构待测量后另行安排。
