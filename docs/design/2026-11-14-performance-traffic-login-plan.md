# LanmiaoTV 多人延迟 · 画布卡顿 · 流量 · 登录页 · 方案 v1 · 2026-11-14

> 实现方：kimi3.1。本文自足：照「执行规则」自己做完，不需要问用户。
> 需要用户的只有两件事：① 每批上生产前的放行（R6）；② §4.4 CDN 的控制台操作（§7 清单）。
> 关联文档：`docs/design/2026-11-14-lanmiaotv-ux-plan.md`（下称「UX 方案」）。两份文档的批次互不依赖，但同一天只上生产一批（不管属于哪份文档）。

---

## 证据（2026-11-13 / 11-14 生产只读采样）

**出口流量（11-14 00:00–19:51，nginx gzip 已在 11-13 开启，合计约 14.4 GB）**

| 路由组 | 请求数 | 流量 | 单次平均 | 占比 |
|---|---|---|---|---|
| 视频代理 `/api/storage/sign?…&playback=1` | 16,606 | 12,481 MB | 770 KB | 约 87% |
| 素材下载 `/api/frameos/materials/[id]/download` | 55 | 1,146 MB | 21 MB | 约 8% |
| 画布保存 `…/canvas/[id]/ops` 的响应 | 2,092 | 316 MB | 155 KB | 约 2% |
| 公开媒体 `/m/m_…`（给 AI 供应商取参考图） | 97 | 283 MB | 3 MB | 约 2% |
| 打开画布 `GET …/canvas/[id]` | 1,059 | 162 MB | 157 KB | 约 1% |
| 其余（余额、工具箱资产、静态资源等） | — | < 1% | — | — |

- 视频代理的状态码：206 → 14,874；307 → 3,985；**499（浏览器中途取消）→ 1,788**，基本是滚动、缩放时视频卡片被卸载。
- 视频代理是「Node 从北京 TOS 拉，再推给用户」：同一字节付两次钱（TOS 外网流出 + ECS 出口 0.8 元/GB）。ECS 在上海，TOS 在北京，走公网。

**请求量（11-13 全天）**
- 余额 `/api/user/balance` 70,707 次；session 18,873 次；工具箱资产 13,002 次；ops 7,380 次（6.4 GB，当时未压缩）；499 共 3,397 次。
- 峰值：09:17 一分钟 381.8 MB（约 51 Mbps）；10:10 一分钟 1,192 个请求；每小时最多 60 个不同 IP。

**生成队列（近 7 天视频任务）**：平均等待 7 s；14 个等待 > 60 s，6 个 > 300 s，最长 1,208 s；平均运行 314 s。

**数据库**：MySQL 8.0.46，`innodb_buffer_pool_size` 为默认 128 MB；binlog 为 FULL 行镜像，每次提交都刷盘；画布自动保存产生了约 94 GB binlog；`Max_used_connections` 20，没有 P2024（连接池耗尽）错误。

**登录页（headless 实测，`test-results/login-audit/shot.mjs`）**：24 个请求，解码后 2,101 KB，其中 JS 1,239 KB；LCP 桌面 4,944 ms、手机 2,164 ms；约 35 s 才 network idle。

### 根因 → 任务

| # | 根因（已核对代码或日志） | 任务 |
|---|---|---|
| 1 | 视频代理吃掉出口带宽；高峰分钟约 51 Mbps，带宽上限未知 | T1、T2、T4，L0 测带宽 |
| 2 | 视频队列全局只有 4 个槽；按用户限流的「闸门」在进程内等待，等待中的任务占着槽；而且按团队管理账号计数，一个团队批量生成会堵住所有人（最长等 20 分钟） | L4 |
| 3 | MySQL 缓冲池 128 MB；每次自动保存都在事务里写一份整画布快照并清理旧快照 | L1、L2 |
| 4 | 轮询过密：余额每 3 s，session 每 30 s（每次查库 2–4 次，登录页也在轮询），工具箱资产每 2.5 s，后台标签页不停 | L3 |
| 5 | Web 进程里做 sharp 缩略图、整文件读进内存再下载、同步写日志；libuv 线程池只有 4 个 | L5 |
| 6 | 每个视频节点都挂一个 `<video preload="metadata">`，打开画布就同时请求几十个视频 | C1、T1 |
| 7 | 每个视频节点的控制条用了 `backdrop-filter: blur`（实测去掉后 50% 视频的画布帧时间 39 → 26 ms） | C2 |
| 8 | 每个节点都订阅 zoom（`CreativeNode.tsx:164`），缩放时全部节点重渲；缩到很小时仍渲染完整卡片 | C3 |
| 9 | `CreativeNode` 没有 `memo` | C4 |
| 10 | 自动保存每次把全部节点重新序列化后比较（`canvas-operations.ts:9-21`） | C5 |
| 11 | 撤销栈每一步 `structuredClone` 整张图，最多 80 份 | C6 |
| 12 | 素材库、素材选择器一次拉全部页（最多 500 条/页），用原图，每张视频卡片一个 `<video controls>` | C7 |
| 13 | 切换过的画布文档在 React Query 缓存里留 10 分钟 | C7 |

---

## 全部功能改动一览

| 编号 | 问题 | 用户能看到的变化 | 章节 | 批次 |
|---|---|---|---|---|
| L0 | 多人延迟 | 无（运维：每个请求的耗时、每分钟带宽、慢查询） | §1.1 | 0 |
| L1 | 多人延迟 | 打开、保存画布更快；高峰期不再整体变慢 | §1.2 | 0 |
| L2 | 多人延迟 | 自动保存更快；「历史版本」改为最密 5 分钟一版 | §2.1 | 1 |
| L3 | 多人延迟 | 无感；后台请求约减少 70% | §2.2 | 1 |
| L4 | 多人延迟 | 有人批量生成时，别人的任务不再长时间「排队中」 | §2.3 | 2 |
| L5 | 多人延迟 | 有人上传、打包下载时，其他人不再卡 | §2.4 | 2 |
| C1 | 画布卡顿 | 视频节点先显示封面和播放键，点了才加载视频 | §3.1 | 1 |
| C2 | 画布卡顿 | 拖动、缩放更顺；控制条外观基本不变 | §3.2 | 1 |
| C3 | 画布卡顿 | 缩小看全局时只显示标题和缩略图 | §3.3 | 3 |
| C4 | 画布卡顿 | 无感 | §3.4 | 3 |
| C5 | 画布卡顿 | 大画布编辑时不再周期性掉帧 | §3.5 | 3 |
| C6 | 画布卡顿 | 大画布撤销、重做不卡，内存下降 | §3.6 | 3 |
| C7 | 素材 / 多画布卡顿 | 素材库、素材选择器秒开，滚动加载；多画布切换不涨内存 | §3.7 | 3 |
| C8 | 画布卡顿 + 流量 | 无感；保存响应从约 155 KB 降到约 1 KB | §3.8 | 1 |
| T1 | 流量 | 同 C1（封面由服务器生成并缓存） | §4.1 | 1 |
| T2 | 流量 | 同一个视频重复看不再重新下载 | §4.2 | 1 |
| T3 | 流量 | 下载直接从对象存储取，不经过服务器 | §4.3 | 2 |
| T4 | 流量 | 视频、图片从 CDN 加载 | §4.4 | 4（需用户控制台） |
| T5 | 流量 | 图片能命中浏览器缓存 | §4.5 | 1 |
| T6 | 流量 | 无感 | §4.6 | 2 |
| T7 | 流量 | 无感 | §4.7 | 1 |
| U1 | 登录页 | 新的品牌化登录页（桌面 / 平板 / 手机） | §5.1–5.4 | 5 |
| U2 | 登录页 | 登录过期后重新登录，回到原来的页面 | §5.5 | 5 |
| U3 | 登录页 | 密码正确但账号已停用时，明确提示 | §5.5 | 5 |
| U4 | 登录页 | 页脚显示 ICP 备案号 | §5.5 | 5 |
| U5 | 登录页 | 「忘记密码？」说明找谁重置 | §5.5 | 5 |
| U6 | 登录页 | 首屏更快 | §5.6 | 5 |

**目标（验收用，§8 有测法）**
- 生产服务器日出口：约 15–18 GB → 批次 1 后 ≤ 8 GB → 批次 4 后 ≤ 2 GB（媒体改由 CDN 计费）。
- 别人批量生成时，其他团队视频任务的排队等待 p95 ≤ 30 s。
- 请求耗时：以批次 0 测出的基线为准，批次 2 完成后 `ops`、`GET canvas`、`balance` 的 p95 都下降 ≥ 40%，且 `ops` p95 ≤ 1 s。
- 画布：`canvas-pan-performance` 场景（200 节点、其中 50 个视频）平移和缩放的平均帧时间 ≤ 20 ms。
- 登录页：LCP 桌面和手机都 ≤ 2,500 ms；JS 解码体积 ≤ 870 KB（基线的 70%）；请求数 ≤ 18；5 s 内 network idle。

---

## 执行规则（照此自主完成，不需要再问用户）

**沿用 UX 方案的 R2、R3、R4、R5、R7**（本文和代码对不上时怎么判断、别人的未提交改动、测试机与测试账号、部署测试机、提交与部署记录）。下面只写不同或新增的。

**R1 顺序**
- 批次 0 → 批次 1 → 批次 2、3、5 可以并行开发 → 批次 4 等用户做完控制台操作。
- 每批流程：改代码 → 跑本批测试（§8）→ 部署测试机 → 按 §8 验收并记录前后数据 → 提交并写部署记录 → 通知用户可以上生产。
- 批次 0 没有代码：直接准备好 §1 的命令，第一时间向用户申请放行（它见效最快）。

**R2 补充：本文没写到的细节，按这个优先级选**
1. 不改变扣费、不丢数据；
2. 旧数据、旧画布照常能读、能打开；
3. 除本文写明的变化外，用户看到的行为不变；
4. 改动最小，沿用相邻代码的写法。

**R6 上生产**：同 UX 方案 R6（备份检查、发布目录、`deploy.sh prepare|load|switch`、不许删 `/data` 下任何文件、不用 `lanmiao-prod` 别名）。补充：
- 本文所有批次都**不改表结构**，`switch` 时断言 `migrate diff` 为空。
- 批次 0 和批次 2 有生产配置改动（MySQL、nginx、compose 环境变量），一次放行覆盖该批列出的全部命令。
- 第一次申请放行（批次 0）时，在同一条消息里请用户提供：
  1. 公网 IP 的带宽上限（Mbps）；
  2. 是否同意开始 §7 的 CDN 控制台操作（清单附在消息里）。
- 申请批次 5 放行时，请用户提供 ICP 备案号（例如「京ICP备XXXXXXXX号-1」）。没有就先不显示备案号上线，其余照常。
- 上线后观察 30 分钟。出现下面任一情况，立即回滚到上一个发布产物（方法同 UX 方案 §2.6 第 6 步），再告诉用户：
  - 本批改动涉及的路由 5xx 比例 > 1% 持续 5 分钟；
  - 新代码路径的错误日志 > 20 条/分钟；
  - 视频无法播放、画布无法打开或保存、无法登录。

**R9 生产只读排查（随时可做，不用问）**
- 允许：`cat`/`tail`/`zcat` 日志、`nginx -T`、`docker ps|stats --no-stream|logs`、MySQL 的 `SELECT` 和 `SHOW`。
- 不允许（需要 R6 放行）：改任何配置文件、重启任何服务、`SET`/`UPDATE`/`DELETE`、安装软件包。

**R10 前后数据**：每批的部署记录都写「改前 / 改后」数据：§8.1 的流量分组、p95 耗时、相关的 harness 帧时间或体积。改后数据在测试机上测；流量和 p95 在生产上线 24 小时后补测。

**R8 只在这几种时候联系用户**
1. 批次 0 申请放行（同时发 §7 CDN 清单）；
2. 某批测试机验收通过，可以上生产；
3. 生产上线完成，或者回滚了；
4. 全部批次完成。

---

## 1. 批次 0 · 生产观测与数据库配置（无代码，需 R6 放行）

所有命令在生产机执行：`ssh -i ~/.ssh/norivideo.pem root@14.103.65.61`。改任何文件前先在同目录备份成 `<原名>.bak-20261114-<主题>`。

### 1.1 L0 观测

**1）nginx 记录每个请求的耗时**
- 在 `/etc/nginx/nginx.conf` 的 `http {}` 里加：
  ```nginx
  log_format nori_timing '$remote_addr - $remote_user [$time_local] "$request" '
                         '$status $body_bytes_sent "$http_referer" "$http_user_agent" '
                         'rt=$request_time urt=$upstream_response_time';
  ```
- 把生效的 `access_log /var/log/nginx/access.log;`（先看 `/etc/nginx/sites-available/lanmiaoai.com`，没有再看 `nginx.conf`）改为 `access_log /var/log/nginx/access.log nori_timing;`。
- `nginx -t && systemctl reload nginx`。
- 字段位置不变（`$9` 状态码、`$10` 字节数），`rt=` 是倒数第二个字段。§8.1 的脚本依赖这一点。

**2）每分钟带宽峰值**
- 新建 `/usr/local/bin/nori-netrate.sh`（`chmod +x`）：
  ```bash
  #!/bin/bash
  IF=$(ip route show default | awk '{print $5; exit}')
  sample() { sed 's/:/ /' /proc/net/dev | awk -v i="$IF" '$1==i {print $2, $10}'; }
  read rx0 tx0 < <(sample); minute=$(date +%Y-%m-%dT%H:%M); maxtx=0; maxrx=0
  while sleep 5; do
    read rx1 tx1 < <(sample)
    tx=$(( (tx1-tx0)*8/5/1000000 )); rx=$(( (rx1-rx0)*8/5/1000000 )); rx0=$rx1; tx0=$tx1
    now=$(date +%Y-%m-%dT%H:%M)
    if [ "$now" != "$minute" ]; then echo "$minute tx_max_mbps=$maxtx rx_max_mbps=$maxrx" >> /var/log/nori-netrate.log; minute=$now; maxtx=0; maxrx=0; fi
    [ "$tx" -gt "$maxtx" ] && maxtx=$tx; [ "$rx" -gt "$maxrx" ] && maxrx=$rx
  done
  ```
- 新建 `/etc/systemd/system/nori-netrate.service`（`ExecStart=/usr/local/bin/nori-netrate.sh`，`Restart=always`），`systemctl enable --now nori-netrate`。
- 判断：工作时间内任一分钟 `tx_max_mbps` ≥ 用户给的带宽上限 × 90%，就是带宽打满。写进部署记录，并在 R8 第 3 条的消息里建议用户在控制台调高上限（按流量计费时，上限只是封顶值，以控制台计费说明为准）。

**3）MySQL 慢查询**（日志放在容器的 `/tmp`，不放 `/data`，因为 `/data` 下的文件不许删）
```bash
docker exec norivideo-mysql-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SET PERSIST slow_query_log_file=\"/tmp/mysql-slow.log\"; SET PERSIST long_query_time=0.5; SET PERSIST slow_query_log=ON;"'
```
批次 2 在生产验收完成后，执行 `SET PERSIST slow_query_log=OFF` 关掉。

### 1.2 L1 MySQL 内存与 binlog

**先只读检查（R9）**
```bash
free -m; docker stats --no-stream
docker exec norivideo-mysql-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SELECT ROUND(SUM(data_length+index_length)/1048576) FROM information_schema.tables WHERE table_schema=\"nori\"; SELECT @@innodb_buffer_pool_size, @@innodb_redo_log_capacity, @@binlog_transaction_compression, @@binlog_row_image, @@sync_binlog, @@innodb_flush_log_at_trx_commit;"'
```

**缓冲池大小 B（MB）** = min(4096, `free -m` 的 available × 0.5, max(1024, 数据+索引 × 1.3))，向下取整到 128 的倍数。

**执行**（22:00 以后，调整期间可能有几秒停顿）
```sql
SET PERSIST innodb_buffer_pool_size = <B × 1048576>;
SET PERSIST innodb_redo_log_capacity = 1073741824;
SET PERSIST binlog_transaction_compression = ON;
```
- 用 `SHOW STATUS LIKE 'Innodb_buffer_pool_resize_status'` 轮询到完成，再 `SELECT @@…` 确认三项都生效。
- `SET PERSIST` 写进数据目录里的 `mysqld-auto.cnf`，容器重启后仍然有效。
- **不要改** `sync_binlog`、`innodb_flush_log_at_trx_commit`（数据安全）和 `binlog_row_image`（备份和按时间点恢复依赖它）。
- 回滚：`RESET PERSIST innodb_buffer_pool_size; SET GLOBAL innodb_buffer_pool_size = 134217728;`，另外两项同理。

**批次 0 验收**
- `tail -3 /var/log/nginx/access.log` 每行末尾有 `rt=… urt=…`；
- `/var/log/nori-netrate.log` 每分钟一行；
- 三项 MySQL 变量是新值；
- 用 §8.1 的脚本采一整个工作日，作为全文的「改前基线」写进 `docs/deployments/beian-perf-baseline-<日期>.md`。

---

## 2. 多人使用延迟（L2–L5）

### 2.1 L2 画布快照节流（批次 1）

**位置**：`src/lib/canvas/persistence.ts`。`recordCanvasSnapshotInTransaction`（`:207-264`）在每次保存的事务里都被调用（grep `recordCanvasSnapshotInTransaction(`，约 `:749`）。它写一份整画布 JSON，再 `findMany skip SNAPSHOT_LIMIT`（`:21`，40）并 `deleteMany`。快照只被 `…/canvas/[canvasId]/revisions/route.ts:18,52` 读取。

**改为**
- 在 `SNAPSHOT_LIMIT` 旁边加 `const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60_000`。
- 调用前判断是否需要快照，满足任一条就记录：
  1. 这个画布还没有任何快照；
  2. 最新快照的 `createdAt` 早于 5 分钟前（`tx.canvasSnapshot.findFirst({ where: { canvasId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })`，走 `[canvasId, createdAt]` 索引）；
  3. 本次保存删除的节点数 ≥ 5（用 diff 结果里删除节点的数量，`persistence.ts:677-735` 附近）；
  4. 本次保存来自「恢复历史版本」（看 revisions 的恢复走哪条路径，给它传 `forceSnapshot: true`）。
- 不记录时，`recordStudioDocumentsForSnapshotInTransaction` 和清理旧快照也一起跳过。
- `canvas.revision` 照常每次 +1；快照只是不再每个 revision 都有。检查 revisions 路由和恢复逻辑没有假设「revision N−1 一定有快照」（grep `revision - 1`）；有就改成取「≤ N 的最近一份」。

**测试**（放在已有的 persistence 测试旁边，grep `recordCanvasSnapshotInTransaction` 找到 tests 目录里的位置）
- 首次保存记录；5 分钟内第二次不记录；把时间推过 5 分钟后记录；删 5 个节点记录；不记录时不触发清理。

### 2.2 L3 轮询减量（批次 1）

**新建** `src/hooks/common/useVisiblePolling.ts`：
```ts
export function useVisiblePolling(callback: () => void | Promise<void>, intervalMs: number | null): void
```
- `intervalMs` 为 `null` 时不轮询；
- 页面隐藏（`document.visibilityState === 'hidden'`）时暂停；重新可见时立即执行一次，再继续；
- 用 `setTimeout` 链，上一次的 Promise 完成后才排下一次，不重叠；
- `callback` 放进 ref，换回调不重置计时。

**逐处修改**

| 位置（锚点） | 现在 | 改为 |
|---|---|---|
| `src/app/[locale]/providers.tsx:15-16` `SessionProvider` | `refetchInterval={30}`，focus 时刷新 | 普通页面 `refetchInterval={300}`；`usePathname()` 含 `/auth/` 时 `refetchInterval={0}` 且 `refetchOnWindowFocus={false}` |
| `src/hooks/common/useAccountBalance.ts:59-113` | 可见时每 3 s | 可见时每 20 s；保留 focus、visibility、`subscribeBalanceChanges` 的即时刷新 |
| grep `useTaskTargetStateMap`（`:299-305`） | 每 2 s，后台不停 | 有排队中或生成中的目标时 2 s，否则 `null` |
| `CanvasGraph.tsx:3499,3648` generation-tasks | 1.5 s | 有运行中任务时 3 s，否则 `null` |
| `CanvasGraph.tsx:3701,3794` toolbox assets | 2.5 s，后台不停 | 有未完成资产时 3 s，否则 `null` |
| `PlaylistNode.tsx:225` | 1.5 s | 合成中 3 s，否则 `null` |
| `FosProductionShot.tsx:252`、`FosToolbox.tsx:621` | 2.5 s | 有未完成任务时 3 s，否则 `null` |
| `FosStoryboard.tsx:1158` | 3 s | 有未完成任务时 3 s，否则 `null` |
| `FosAssetSetting.tsx:252` | 无条件 3 s | 有未完成任务时 3 s，否则 `null` |
| `FosShell.tsx:219-224` | 15 s，已按可见性暂停 | 不改 |

- 「未完成」用各组件已有的状态判断（queued / processing / running 一类）。实在判断不了的地方，保留轮询，但改用新 hook（后台暂停），间隔 5 s。
- 新任务提交成功后要立刻开始轮询：提交处已有的 `refetch()` / `invalidateQueries` 保留；如果某处提交后不会触发状态变化，提交成功后手动调一次。
- session 改成 5 分钟后，强制下线最慢 5 分钟才在空闲页面生效；所有 API 请求每次都会在服务端校验 session（`validateSessionUser`），不受影响。

**测试**：`tests/unit/hooks/use-visible-polling.test.ts`（fake timers）：间隔正确；隐藏时不调；恢复可见立即调一次；上一次没完成不重叠；`null` 不调。

### 2.3 L4 生成队列公平（批次 2）

**现状**：`src/lib/workers/video.worker.ts:647-657` 在 `withTaskLifecycle` 里面调用 `withUserConcurrencyGate`（`src/lib/workers/user-concurrency-gate.ts`）。闸门满时在进程内等待，等待的任务占着 BullMQ 的槽（视频全局 4 个，`:661`）；闸门按 `job.data.userId` 计数，子账号的 `userId` 是团队管理账号，所以整个团队共用 5 个名额。`image.worker.ts:64` 同样如此（全局 20）。

**改为**：拿不到名额时不等待，把任务放回延迟队列，让出槽位。
1. `user-concurrency-gate.ts` 改为非阻塞：
   ```ts
   export function tryAcquireGenerationSlot(input: {
     scope: 'image' | 'video'; actorId: string; teamId: string; actorLimit: number; teamLimit: number
   }): (() => void) | null
   ```
   - 两个内存计数器：`${scope}:actor:${actorId}`、`${scope}:team:${teamId}`；两者都没满才占用并返回 `release`，否则返回 `null`；
   - `release` 只生效一次（重复调用不会多减）；
   - 删除 `withUserConcurrencyGate`（只有这两个 worker 在用）。
2. 两个 worker 的处理函数改为（视频为例，图片同理）：
   ```ts
   async (job, token) => {
     const actorId = job.data.payload?.meta?.quotaUserId || job.data.userId
     const { video: actorLimit } = await getUserWorkflowConcurrencyConfig(job.data.userId)
     const release = tryAcquireGenerationSlot({ scope: 'video', actorId, teamId: job.data.userId, actorLimit, teamLimit: VIDEO_TEAM_LIMIT })
     if (!release) {
       await job.moveToDelayed(Date.now() + 3_000 + Math.floor(Math.random() * 2_000), token)
       throw new DelayedError()
     }
     try {
       return await withTaskLifecycle(job, async (taskJob) => await processVideoTask(taskJob))
     } finally {
       release()
     }
   }
   ```
   - `DelayedError` 从 `bullmq` 导入（5.67.3 支持）。`moveToDelayed` 不消耗重试次数。
   - `VIDEO_TEAM_LIMIT = Math.max(1, Math.ceil(concurrency * 0.6))`，`concurrency` 是该 worker 的全局并发（视频 10 → 6，图片 20 → 12）。
   - 每个成员的上限 `actorLimit` 仍读管理账号的设置（默认 5），含义从「整个团队」变为「每个人」。
   - 延迟期间任务行保持 QUEUED；看门狗把 delayed 视为存活（`src/lib/task/reconcile.ts:48-61`），不用改。
   - `withTaskLifecycle` 现在拿到名额后才开始，`startedAt` 变成真正的开始时间，排队时长统计因此更准。
3. 全局并发：`docker-compose.prod.yml` 的 app 服务 `environment` 加 `QUEUE_CONCURRENCY_VIDEO: "10"`；测试机在 `/opt/norivideo-test/.env` 加同样的变量。
4. 上线后 24 小时 grep worker 日志里的 `429` / `rate limit`。超过 1% 的视频任务被供应商限流，就改回 `"6"`（属于本批放行范围）。

**测试**
- `tests/unit/worker/generation-slot.test.ts`：成员上限、团队上限、不同团队互不影响、`release` 幂等。
- worker 测试：名额满时调用了 `moveToDelayed(…, token)` 并抛出 `DelayedError`，`withTaskLifecycle` 没有被调用。
- `tests/integration/task/generation-fairness.test.ts`（用本机 Redis 6380，没有 Redis 时 `skip`）：假处理函数每个任务睡 2 s，团队 A 两个成员各入队 12 个，团队 B 入队 2 个；断言团队 B 的两个任务都在 5 s 内开始。
- 测试机上不为验收批量调用真实供应商（会花钱）；只提交 1 个视频任务确认流程正常。

### 2.4 L5 Web 进程减负（批次 2）

1. `scripts/docker-start.sh` 开头加 `export UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-16}"`（对 4 个进程都生效）。
2. `src/lib/media/thumbnail.ts:9-49`：在已有的 inFlight 去重之外，加一个模块级信号量，同时最多 2 个 sharp 生成。
3. 打包下载改为流式：grep `archiver(`，至少包括 `src/app/api/novel-promotion/[projectId]/download-videos/route.ts:221-275` 以及同目录的 download-images、download-voices。
   - `archive` 用 `Readable.toWeb(archive)` 直接作为 `Response` 的 body，不再把输出攒进内存；不设 `Content-Length`；
   - 逐个文件 `fetch`，`archive.append(Readable.fromWeb(res.body), { name })`，等 `archive` 的 `entry` 事件后再取下一个（不要同时打开所有连接）；全部追加后 `finalize()`；
   - `request.signal` 中止时调用 `archive.abort()`。
4. 单文件下载：`src/app/api/video-enhance/[taskId]/download/route.ts:46,62` 按 §4.3 的方式处理；`src/app/api/files/[...path]/route.ts:59-69`（本地存储）改为 `fs.createReadStream` 加 `Readable.toWeb` 流式返回。
5. `src/lib/logging/file-writer.ts:129,288-303`：同步追加改为每个文件一个 `fs.createWriteStream(path, { flags: 'a' })`；轮转时先 `end()` 旧流再打开新流。

**验收（测试机）**
- 对一个有 ≥ 10 个视频的项目执行打包下载。期间 `ps -o rss` 看 next 进程，峰值增量 < 150 MB；同时 curl 循环请求 `/api/user/balance`，p95 < 200 ms。
- 下载得到的 zip 能正常解压，文件数和大小与原文件一致。

---

## 3. 画布与素材卡顿（C1–C8）

### 3.1 C1 视频节点先显示封面（批次 1；服务端封面接口见 §4.1）

**现状**：`CreativeNode.tsx:446-449` 对每个视频节点直接渲染 `<CanvasNodeVideo>`，它是 `<video src poster playsInline preload="metadata">`（`CanvasNodeVideo.tsx:71-77`）。生成的视频节点通常没有 `posterUrl`（只有 3D 模型和播放列表素材会写），所以 `poster` 多半为空，浏览器只能去拉视频本身。

**改为**
1. `src/lib/media/image-url.ts` 在 `toPlayableVideoUrl`（`:79-87`）旁新增：
   ```ts
   export function toVideoPosterUrl(input: string | null | undefined, width: 480 | 960): string | null
   ```
   - `toDisplayImageUrl(input)` 是 `/api/storage/sign?key=…` 时：设置 `poster=<width>`，删掉 `expires`、`inline`、`playback`、`thumbnail`，返回；
   - 其它（外部 URL 等）返回 `null`。
   - 在 `image-url.test.ts` 补用例。
2. 新建 `src/features/canvas/nodes/CanvasNodeVideoPoster.tsx`：
   - 结构：外层 `div.nori-canvas-video-poster`（不加 `nodrag`，整张卡片仍可拖动）→ `<img src={posterUrl} alt="" loading="lazy" decoding="async">` → 居中的圆形播放按钮。
   - 播放按钮：`<button type="button" className="nodrag nori-canvas-video-poster-play" aria-label="播放视频" data-testid="canvas-video-play">`，直径 40px，图标沿用 `CanvasNodeVideo` 的 `Play`。
   - 没有封面或封面加载失败：隐藏 `img`，显示深色底加 `Clapperboard` 图标，播放按钮照常可点。
3. `CreativeNode.tsx`：
   - 新增 `const [videoActive, setVideoActive] = useState(() => recallPlayback(videoUrl)?.playing === true)`（之前正在播放的卡片重挂载后直接进入播放态，保留现有的续播体验；`recallPlayback` 的返回结构以 `media-playback.ts` 为准）；
   - `videoActive` 为 false 时渲染 `<CanvasNodeVideoPoster posterUrl={imageUrl || toVideoPosterUrl(data.videoUrl || data.contentUrl, 480)} onPlay={() => setVideoActive(true)} />`；
   - 为 true 时渲染原来的 `<CanvasNodeVideo … />`，并新增 `autoPlay` 属性：挂载后调用一次 `video.play()`，失败就停在暂停态。
4. `CreativeNode.tsx:146` 引用预览里的 `<video … preload="metadata" />`：有 `toVideoPosterUrl(reference.previewUrl, 480)` 就改成 `<img>`；没有就保留 `<video>` 但改 `preload="none"`。
5. 其它同时渲染多个视频的列表或网格（grep `<video`，范围 `src/components`、`src/features`）：一律改成封面卡片，点击后才播放。素材库和选择器见 C7。只播放一个视频的地方（预览弹窗、`PlayerStage`、`FosVideoReviewWorkspace`）保留 `<video>`，没有 `poster` 的补上 `toVideoPosterUrl(…, 960)`。

**测试**：`tests/browser/canvas-ui-regression.browser.mjs` 增加：载入含 10 个视频节点的画布，`document.querySelectorAll('video').length === 0`；点击一个 `canvas-video-play` 后为 1 且开始播放；拖动封面区域能移动节点。

### 3.2 C2 去掉节点上的毛玻璃（批次 1）

- `src/features/canvas/canvas.css:7427` `.nori-canvas-video-toggle`、`:7453` `.nori-canvas-video-bar`：删除 `backdrop-filter` 和 `-webkit-backdrop-filter`，背景改为 `rgba(12, 14, 22, 0.72)`。
- 再 grep `backdrop-filter`（已知还有 `:362`、`:1189`、`:1416`）：
  - 选择器作用在每个节点里的元素上（节点内部、节点工具条、徽标）→ 同样改成相近色调的半透明纯色；
  - 页面上只出现一次的元素（顶部工具栏、侧栏、弹窗、小地图）→ 保留。
- 用 gallery harness 截图对比，外观差异只允许在模糊效果本身。

### 3.3 C3 缩小时简化 + zoom 分档（批次 3）

1. 新建 `src/features/canvas/zoom-bucket.ts`：
   ```ts
   export const CANVAS_LOW_DETAIL_ZOOM = 0.35
   export const selectZoomBucket = (s: ReactFlowState) => { const z = s.transform[2]; return z < 0.35 ? 0 : z < 0.7 ? 1 : z < 1.4 ? 2 : 3 }
   ```
2. `CreativeNode.tsx:164` 的 `useStore((state) => state.transform[2])` 改为 `useStore(selectZoomBucket)`。缩略图宽度的 effect（`:238-256`）依赖改成 `zoomBucket`，计算时用 `useStoreApi().getState().transform[2]` 读当前 zoom。这样缩放时只有跨档才重渲，不再每帧重渲全部节点。
3. grep `transform[2]`（范围 `src/features/canvas`），所有在节点组件里订阅 zoom 的地方都改用分档。
4. 低细节模式（`zoomBucket === 0`）：
   - 节点根元素加 `is-low-detail`；
   - 只渲染一行标题（单行省略）和媒体缩略图（图片用 480 缩略图，视频用封面，文本、音频显示类型图标）；
   - 不渲染工具条、徽标、提示词、历史条、视频组件；生成中的任务只保留 4px 进度条；
   - 连接点保留在 DOM 里，用 CSS 隐藏外观；
   - `CanvasGraph` 的画布外层同样按分档加 `nori-canvas-lod`，用 CSS 隐藏连线文字。

### 3.4 C4 节点 memo（批次 3）

- `CreativeNode.tsx:152` 改为 `export const CreativeNode = memo(function CreativeNode(props) { … })`。`nodeTypes` 里注册的其它自定义节点没有 memo 的，同样处理。
- 检查 `useCanvasEditor()` 和 `useCanvasMultiSelection()` 的 Provider：`value` 必须用 `useMemo`，平移、缩放、拖动时不能变。如果 `value` 里的回调每次渲染都重建，改为「ref 保存最新实现 + `useCallback(…, [])` 的稳定包装」。
- 验收：用 React Profiler 在 harness 里平移 200 节点的画布 3 s，`CreativeNode` 的提交次数只来自新进入视口的节点。

### 3.5 C5 自动保存 diff 缓存（批次 3）

- 位置：`src/features/canvas/state/canvas-operations.ts`（`stable()` `:9-21`，比较 `:50-71`、`:78-114`），调用方 `useCanvasAutosave.ts:234-256`。
- 加缓存：
  ```ts
  const stableCache = new WeakMap<object, string>()
  function stableOf(value: object): string {
    let text = stableCache.get(value)
    if (text === undefined) { text = stable(value); stableCache.set(value, text) }
    return text
  }
  ```
- 比较时先 `if (previous === next) continue`，引用不同时再比 `stableOf(previous) !== stableOf(next)`。
- 引用要能跨两次保存保持：如果 `useCanvasAutosave` 每次都从 flow 节点重新映射出新的文档节点，就再加一个 `WeakMap<flow 节点, 文档节点>`，没变的 flow 节点映射出同一个对象。「上次已保存」的基线也保存这些对象本身，不要保存重新解析出来的副本。
- 测试 `tests/unit/canvas/canvas-operations-cache.test.ts`：
  - 对 200 节点的样例，新旧实现输出的 operations 完全相同（先用旧实现生成快照文件）；
  - 500 节点、只改 1 个节点，预热后 20 次 `buildCanvasOperations` 平均 < 5 ms。

### 3.6 C6 撤销结构共享（批次 3）

- `src/features/canvas/state/useCanvasHistory.ts:15-17` 的 `cloneSnapshot` 从 `structuredClone` 改为浅拷贝：`{ nodes: s.nodes.slice(), edges: s.edges.slice(), viewport: { ...s.viewport } }`。节点对象在多条历史之间共享（React 状态本来就不可变）。
- 防止有人原地修改：开发环境和测试里，存入历史的节点递归 `Object.freeze`。跑画布单测和 `canvas-ui-regression`、`batch-node-connection`、`material-interactions` 这几个浏览器测试，修掉报出的原地修改（这些本来就是 bug）。
- 兜底：如果发现超过 5 处原地修改，或者修起来有风险，就退回「只克隆变过的节点」：用 `WeakMap<节点, 克隆>`，没变的节点复用上一份克隆。
- 测试：record / undo / redo 的状态正确；开发环境下原地修改会抛错。

### 3.7 C7 素材库、素材选择器、多画布（批次 3）

1. **素材库** `src/components/frameos/views/FosMaterialLibrary.tsx`（`:52`、`:87-92`、`:567-592`、`:806-823`）：
   - 图片卡用 `toCanvasDisplayImageUrl(url, 480)`，不用原图；
   - 视频卡改成封面卡（`toVideoPosterUrl(…, 480)` + 播放图标），点击打开已有的预览；删掉每张卡上的 `<video controls muted playsInline>`；
   - 每页仍 60 条，用 IntersectionObserver 哨兵滚动加载下一页，同时保留「加载更多」按钮作兜底；
   - 卡片加 `content-visibility: auto; contain-intrinsic-size: <卡片宽> <卡片高>;`。
2. **资产库** `FosAssetLibrary.tsx`（`:206-210`、`:395-400`、`:711-712`）：`limit=500` 并一次拉完全部页，改为每页 60、滚动加载；缩略图和封面同上。
3. **素材选择器** `MaterialPickerDialog.tsx`（`:240-258`、`:545-551`）和 `material-picker-query.ts:84`：每页 300 并一次拉完，改为首屏 60、滚动加载；缩略图和封面同上。
   - 已选中的 id 独立保存，翻页、筛选都不丢；
   - 如果有「全选」，文案改为「全选（已加载 N 个）」。
4. **筛选**：前端如果对「全部已加载项」做筛选或搜索，改成把条件传给接口。`/api/frameos/materials` 已支持 `type`、`limit`、`cursor`（`route.ts:40-69`、`:127`、`:151-152`、`:178`）；接口不支持的条件，加在该接口的 `where` 里。
5. **画布素材面板**：grep 调用 `…/canvas/[canvasId]/materials` 的前端组件，缩略图和封面同上。
6. `MediaImage.tsx:31-48` 的 `<img>` 加 `decoding="async"`。
7. **多画布**：`useCanvasSync.ts:9-13` 的画布文档查询单独设 `gcTime: 60_000`（全局默认的 10 分钟不动），切换过的画布文档 1 分钟后释放。

**验收（本机种子账号，素材 300 条，其中视频 100 条）**
- 打开素材库：首屏请求 ≤ 70 个；点击视频卡之前 `document.querySelectorAll('video').length === 0`；滚到底加载下一页。素材选择器、资产库同样。
- 在 6 个画布之间来回切换两轮，第二轮结束后（手动 GC）的 JS 堆不超过第一轮结束时的 130%。用 headless Chrome 加 `--enable-precise-memory-info` 读 `performance.memory`。

### 3.8 C8 增量保存上线（批次 1）

- 工作区里已有、未提交、未部署：
  - `src/app/api/projects/[projectId]/canvas/[canvasId]/ops/route.ts:45-58`：请求带 `x-nori-canvas-response: delta`（`src/features/canvas/types.ts:168`）时只返回增量；
  - 客户端：`useCanvasAutosave.ts:495-499`、`:674`，`src/features/canvas/api/client.ts:24`。
- 这几处属于本方案，随批次 1 提交（R3 的例外）。提交前 `git diff` 这些文件，确认 hunk 都是增量响应相关；同文件里的无关改动按 R3 处理。
- 测试：grep `x-nori-canvas-response`（范围 `tests`），没有就新增 `tests/integration/api/contract/canvas-ops-delta.test.ts`：带头时响应里没有完整 `data`，只有 revision 和变化的 id；不带头时返回旧的完整响应（旧客户端照常能用）。
- 验收（测试机）：编辑画布，记录 `ops` 响应体长度 < 5 KB。

---

## 4. 减少流量（T1–T7）

### 4.1 T1 视频封面接口（批次 1）

**接口**：在 `src/app/api/storage/sign/route.ts` 的 `thumbnail` 分支（`:136-142`）旁边加 `poster` 分支。
- 只接受视频 key（`getMimeType(key).startsWith('video/')`）；宽度只认 480、960，其它值按 480 处理；不能和 `inline`、`playback`、`thumbnail` 同时出现。
- `const posterKey = await ensureVideoPoster(key, width)`，然后 `signedRedirect(await getSignedObjectUrl(posterKey, ttl, …), ttl)`（签名方式见 T5）。
- 生成失败返回 404，带 `Cache-Control: private, max-age=600`；前端显示占位。

**新建 `src/lib/media/video-poster.ts`**（照 `src/lib/media/thumbnail.ts:9-49` 的写法）：
- 封面 key：和缩略图同一套哈希目录规则，前缀换成 `images/posters/`，文件名 `w<width>.webp`。
- 对象已存在就直接返回 key（用 thumbnail 判断存在的同一个方法）。
- 不存在就生成：
  1. `getSignedObjectUrl(key, 600)` 拿到视频直链；
  2. `ffmpeg -hide_banner -loglevel error -ss 0.5 -i <直链> -frames:v 1 -vf scale=<width>:-2 -f image2pipe -vcodec png pipe:1`（`-ss` 放在 `-i` 前面，快速定位；ffmpeg 只按 Range 读需要的部分，通常 1–3 MB）；
  3. 没有输出（视频短于 0.5 s）就用 `-ss 0` 再试一次；
  4. sharp 转 WebP，质量 80，用 thumbnail 同样的上传方法写回存储。
- 并发：模块级信号量，最多 2 个 ffmpeg；同一个 key 正在生成时复用同一个 Promise；单次超时 20 s（超时 kill 进程）。
- 失败记进内存 Map，10 分钟内同一个 key 直接 404，不重复跑 ffmpeg。
- 本地存储（开发环境）：能拿到本地文件路径就用路径，拿不到返回 404。
- 新视频主动生成：在视频 worker 把结果上传存储之后（grep `video.worker.ts` 及其 handler 里的上传调用），`void ensureVideoPoster(resultKey, 480).catch(…)` 记一条 warn 日志，不影响任务结果。历史视频不批量回填，第一次被看到时生成。

**测试**：`tests/unit/media/video-poster.test.ts`（mock ffmpeg 和存储）：已存在直接返回；并发同 key 只生成一次；失败 10 分钟内不重试；超时会 kill。

### 4.2 T2 视频代理可缓存（批次 1）

位置：`src/app/api/storage/sign/route.ts` 的 `playback` 分支（`:165-196`）和 `src/lib/media/image-url.ts` 的 `toPlayableVideoUrl`（`:79-87`）。
1. `toPlayableVideoUrl` 删掉 `expires` 参数：代理每次都会重新签名，URL 去掉它以后，同一个视频永远是同一个地址，浏览器缓存才能命中。同步更新 `image-url.test.ts:41-43` 的期望值。
2. 转发条件请求头：除了 `Range`，再把 `If-None-Match`、`If-Modified-Since`、`If-Range` 原样转给 TOS。
3. 允许的上游状态码加上 304（`[200, 206, 304, 416]`）。上游 304 时返回 `new NextResponse(null, { status: 304, headers })`，带上 `ETag`、`Cache-Control`。
4. `Cache-Control` 从 `private, max-age=300` 改为 `private, max-age=86400`。`ETag`、`Last-Modified` 已经在转发（`:189-192`）。
5. 测试（mock `fetch`）：条件头被转发；上游 304 时返回 304；`Cache-Control` 正确；URL 不再带 `expires`。

### 4.3 T3 下载直连对象存储（批次 2）

**现状**：`src/app/api/frameos/materials/[materialId]/download/route.ts:23-32` 把整个文件读进内存再返回，响应头 `x-nori-filename`；前端 `src/components/frameos/materials/download-material.ts:6-13` 取 blob 后用 `saveProjectDownload` 存进用户选择的项目目录（File System Access），所以必须拿到 blob，不能直接用 `<a download>`。

**改为**
1. 接口新增 `?mode=url`：权限检查不变，返回 JSON `{ url, filename }`。
   - `url = getSignedObjectUrl(storageKey, 600, { responseContentDisposition: "attachment; filename*=UTF-8''" + encodeURIComponent(filename) })`；
   - CDN 开启后（T4）改用 CDN 地址。
2. 不带 `mode` 时（旧前端，或者直连失败后的兜底）：改成流式转发，不再整文件读进内存。写法同视频代理：`fetch(签名直链)`，把 `upstream.body` 直接作为响应体，转发 `Content-Length`。
3. 前端 `download-material.ts`：
   - 先 `GET …/download?mode=url`，再 `fetch(url)` 直接从对象存储取 blob，然后照旧 `saveProjectDownload`；
   - 直连抛错（`TypeError`，一般是 CORS 没配或网络问题）时，退回旧的 `GET …/download` 一次，`console.warn` 记原因。
4. 生产上，要等用户按 §7 给存储桶配好 CORS 后，直连才会生效；在那之前一直走兜底流式，功能不受影响。
5. `src/app/api/video-enhance/[taskId]/download/route.ts:46,62`：先看它的前端调用方。也是取 blob 的，照上面同样处理；是直接打开链接的，改为 302 跳转到带 `attachment` 的签名直链。
6. 验证 CORS（R9 只读）：在生产容器里生成一个签名直链，执行 `curl -sI -H 'Origin: https://lanmiaoai.com' '<直链>'`，响应里要有 `Access-Control-Allow-Origin`。

### 4.4 T4 媒体走 CDN（批次 4，依赖用户先完成 §7）

**环境变量**（都不设就和现在完全一样；密钥只放生产 `.env`，不进仓库）

| 变量 | 例子 | 说明 |
|---|---|---|
| `MEDIA_CDN_BASE_URL` | `https://media.lanmiaoai.com` | 为空表示关闭 CDN（同时也是开关） |
| `MEDIA_CDN_AUTH_KEY` | （控制台生成） | URL 鉴权主密钥 |
| `MEDIA_CDN_AUTH_PARAM` | `auth_key` | 鉴权参数名，和控制台一致 |

**新建 `src/lib/storage/cdn.ts`**
- `isMediaCdnEnabled()`；
- `buildMediaCdnUrl(key)`：
  - `path = '/' + key 按段 encodeURIComponent`；
  - `timestamp` 取当前 6 小时时间段的起点（秒），同一时间段内 URL 不变，浏览器缓存能命中；
  - 按 Type A：`hash = md5(\`${path}-${timestamp}-0-0-${authKey}\`)`，URL 为 `${base}${path}?${param}=${timestamp}-0-0-${hash}`；
  - 以控制台「URL 鉴权」页的算法说明为准。和上面不一致就按控制台改，并用控制台给的示例写单测。
- 控制台的鉴权有效时长设 24 小时（§7）。

**使用位置**（CDN 开启时）
- `sign` 路由：图片 307、缩略图、封面都改为跳到 CDN 地址；`playback` 不再代理，改为 302 跳到 CDN 地址；跳转响应 `Cache-Control: private, max-age=<当前时间段剩余秒数，至少 60>`。
- `inline=1`（同源音频、全景图）不变，流量小。
- T3 的下载 `mode=url`、T6 的 `/m/` 跳转都改用 CDN 地址。
- 生成 CDN 地址抛错时，退回现有逻辑，并记一条 warn 日志。

**跨域**：grep `drawImage(`、`captureStream`、`toDataURL`、`getImageData`，凡是用存储里的图片或视频画到 canvas 上的地方，给对应的 `<img>`/`<video>` 加 `crossOrigin="anonymous"`（CDN 需要按 §7 返回 CORS 头）。

**上线**：先带着空的 `MEDIA_CDN_BASE_URL` 部署（行为不变）。
- 测试机如果和生产共用同一个存储桶，就在测试机上先设变量并验收；否则在生产放行后再设变量、重启 app 和 admin 容器，并立刻做验收。
- 有问题就把 `MEDIA_CDN_BASE_URL` 设为空并重启（这就是回滚）。
- 验收：
  1. 视频节点点击播放正常、能拖动进度；
  2. 图片、缩略图、封面正常显示；
  3. 下载正常；
  4. 浏览器控制台没有 CORS 报错；
  5. 次日服务器出口 ≤ 2 GB。

### 4.5 T5 图片签名按时间段固定（批次 1）

**现状**：`src/lib/storage/providers/tos.ts:177-213` 每次用 `new Date()` 签名，同一张图每次跳转到的 TOS 地址都不同，浏览器缓存永远不命中；跳转本身只缓存 10 分钟（`sign/route.ts:92-96`）。

**改为**
1. `SignedUrlParams` 增加两个可选字段：
   - `signingBucketSeconds?: number`：设置后签名时间取 `Math.floor(Date.now() / (b * 1000)) * b * 1000`，`X-Tos-Expires = expiresInSeconds + b`（总数不超过 604800）；
   - `responseCacheControl?: string`：签名前 `url.searchParams.set('response-cache-control', value)`。
2. `src/lib/storage/index.ts:80-89` 的 `getSignedObjectUrl` 把这两个字段透传下去；其它存储实现忽略它们。
3. `sign` 路由的图片跳转（`:197`）、缩略图跳转（`:141`）、封面跳转：用 `signingBucketSeconds: 21600`（6 小时）和 `responseCacheControl: 'private, max-age=86400'`。`signedRedirect` 的缓存时间改成「当前时间段剩余秒数」，至少 60。
4. `playback` 分支是代理，不需要这样处理。
5. 测试 `tests/unit/storage/tos-signing.test.ts`：同一时间段内两次签名完全相同；跨时间段不同；过期时间计算正确；`response-cache-control` 参与签名（改它签名会变）。
6. 测试机上用 curl 确认 TOS 返回了 `Cache-Control: private, max-age=86400`。如果 TOS 拒绝这个参数（400/403），就去掉 `responseCacheControl`，只保留固定签名（浏览器仍可凭 ETag 复用），记进「偏差」。

### 4.6 T6 公开媒体改跳转（批次 2）

- `src/app/m/[publicId]/route.ts:43-71`：现在用 `toFetchableUrl(getSignedUrl(…))` 让服务器请求自己的 `sign` 路由，再从 TOS 拉数据转发。主要是 AI 供应商在取参考图（`outbound-image.ts:412,632`）。
- 改为：`GET` 在 304 判断之后，`302` 跳到签名直链（`getSignedObjectUrl(storageKey, 3600, { signingBucketSeconds: 3600 })`，CDN 开启时用 CDN 地址），响应 `Cache-Control: public, max-age=300`。`HEAD` 不变。
- 开关：环境变量 `PUBLIC_MEDIA_REDIRECT`，默认 `1`；设为 `0` 恢复原来的代理。
- 上线后 24 小时 grep worker 日志里和参考图下载有关的供应商报错（关键词 `outbound`、`image_url`、`download`）。失败比上线前明显变多，就设 `PUBLIC_MEDIA_REDIRECT=0` 并重启（属于本批放行范围）。

### 4.7 T7 打开画布支持 304（批次 1）

- `src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts:24-40,69` 的 GET：响应体只序列化一次，`ETag = '"' + sha1(body).slice(0, 27) + '"'`。
  - `If-None-Match` 相同就返回 304；否则 200，带 `ETag` 和 `Cache-Control: private, no-cache`；
  - 用响应体的哈希，不用 revision，避免服务端合并的实时状态变了而 revision 没变。
- 前端取画布文档的请求（`useCanvasSync.ts` → `src/features/canvas/api/client.ts`）不能用 `cache: 'no-store'`；默认缓存模式下，浏览器会自动带 `If-None-Match`。
- 契约测试：第二次带 `If-None-Match` 返回 304；保存后再取返回 200，ETag 变化。

---

## 5. 登录页前端设计（U1–U6，批次 5）

**涉及文件**
- 页面：`src/app/[locale]/auth/signin/page.tsx`（`signIn('credentials', { redirect: false })` `:38-42`；错误 `:44-61`；跳转 `:53-58`；表单 `:74-133`；大写锁定 `:102-118`）。
- 外框：`src/components/frameos/FosAuthShell.tsx`；`src/components/frameos/auth/AuthCreativeScene.tsx`（WebGL）、`AuthHelpButton.tsx`。
- 样式：`src/styles/nori-auth.css`。文案：`messages/{zh,en}/auth.json`。品牌：`src/lib/brand.ts:2-6`、`NoriBrandMark`。

**保留**
- 登录逻辑、现有文案 key 和取值、现有 id（`#username`、`#password`、`#nori-signin-error`、`#nori-caps-lock-hint`）、`FosAuthShell` 的 props（修改密码等页面也在用）。
- 页面结构仍是「左侧品牌叙事 + 右侧登录卡片」，文案沿用 `FosAuthShell.tsx:24-92` 的中英文。

### 5.1 视觉方向

彩色、有质感的创作平台（不要黑白「暗房」风）：深靛蓝底，三团品牌色光晕，一张半透明登录卡片。全部用 CSS 实现，不用 WebGL，不加图片和网络字体。

### 5.2 视觉规范

| 项 | 值 |
|---|---|
| 底色 | `#0B0D1A` |
| 光晕 | 三个大尺寸 `radial-gradient`：品牌紫 `#6E7BFF`（左上，不透明度 0.40）、洋红 `#FF5FA2`（右下，0.28）、青 `#3DD6F5`（右中，0.22）。不要用 `filter: blur` |
| 光晕动效 | 各自 `transform: translate3d()` 缓慢漂移，24 s，`alternate` 循环；`prefers-reduced-motion: reduce` 时不动 |
| 文字色 | 主 `#F5F6FF`；次 `rgba(245,246,255,0.68)`；弱 `rgba(245,246,255,0.48)` |
| 字体 | `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto, sans-serif`，不加载网络字体 |
| 主标题 | 桌面 52/60、700、字距 -0.02em；平板 40/48；手机 30/38。第二行用品牌渐变文字（`background-clip: text`） |
| 卡片 | 宽 420，内边距 36/32，圆角 20；背景 `rgba(20,23,43,0.78)`；边框 `1px solid rgba(255,255,255,0.10)`；阴影 `0 24px 80px rgba(5,6,20,0.55)`；只有这一个元素用 `backdrop-filter: blur(16px)`，不支持时用纯色 `#14172B` |
| 卡片标题 | 24/32、600；说明 15/24 |
| 标签 | 13/20、500 |
| 输入框 | 高 44，圆角 12；背景 `rgba(255,255,255,0.06)`；边框 `rgba(255,255,255,0.14)`；悬停边框 0.24；聚焦边框 `#8F99FF` + `0 0 0 3px rgba(110,123,255,0.35)`；错误边框 `#FF6B8A` + 同样的红色光环 |
| 主按钮 | 高 44，圆角 12；`linear-gradient(135deg, #6E7BFF 0%, #9B6BFF 55%, #FF5FA2 100%)`；白字 15/600；悬停 `filter: brightness(1.08)`；按下下移 1px；禁用不透明度 0.55 |
| 页脚 | 12/18，弱文字色 |
| 进场动效 | 左栏淡入并上移 12px，360 ms，ease-out；卡片 420 ms，延迟 80 ms；减少动效时不做 |

登录页的输入框和按钮用 44px（触屏点击区域），是工作台 32/28/40px 尺寸规范的例外，只限登录相关页面。

### 5.3 布局

**桌面（≥ 1200px）**
```
┌──────────────────────────────────────────────────────────────────┐
│ [猫标] LanMiaoTV STUDIO                    使用指南   进入工作台 ↗ │ 头部 72px
│                                                                  │
│  ✦ THE NEXT SCENE IS YOURS ───                ┌────────────────┐ │
│  让想象，                                     │ 欢迎回来        │ │
│  成为下一幕。（渐变字）                        │ 登录到 LanmiaoTV│ │
│  从第一行灵感，到最后一帧画面……               │ 用户名          │ │
│                                               │ [____________]  │ │
│  [故事构建] → [资产创作] → [镜头叙事]          │ 密码   忘记密码？│ │
│                                               │ [__________ 👁] │ │
│                                               │ [    登 录    ] │ │
│                                               └────────────────┘ │
│ © 2026 LanmiaoTV · 京ICP备…号        故事，由你定义。     平台管理 │ 页脚
└──────────────────────────────────────────────────────────────────┘
```
- 内容区最大宽 1200，两列 `minmax(0, 1fr) 420px`，间距 96，垂直居中，最小高度 `100dvh`。
- 页脚在首屏内可见（备案号要求首页可见）。

**平板（768–1199px）**：单列，最大宽 480，居中。主标题 40px，说明最多两行，下面是卡片；隐藏流程条；页脚分行居中。

**手机（< 768px）**
- 头部 56px：只保留品牌和「使用指南」（图标按钮），隐藏「进入工作台」；
- 主标题 30px，隐藏说明；
- 卡片左右各留 16px，内边距 24/20，圆角 16；
- 页脚分行居中，在内容下方。

**矮屏（高度 < 640px）**：减小上下间距，隐藏说明文字。

### 5.4 表单状态与文案

| 状态 | 表现 |
|---|---|
| 初始 | 桌面（`matchMedia('(pointer: fine)')`）自动聚焦用户名；手机不自动聚焦 |
| 字段为空就提交 | 对应字段显示错误「请输入用户名」/「请输入密码」，聚焦第一个出错的字段 |
| 提交中 | 按钮显示 16px 转圈和「登录中...」（已有 `loginButtonLoading`）；输入框只读；防止重复提交 |
| 账号或密码错误 | `#nori-signin-error`（`role="alert"`）显示已有的 `loginFailed`；保留用户名，清空密码并聚焦密码框 |
| 账号已停用（只在密码正确时出现） | 「该账号已停用，请联系团队管理员」 |
| 请求太频繁 | 已有的 `rateLimited` |
| 其它错误 | 已有的 `loginError` |
| 大写锁定 | 保留现有提示 |
| 显示 / 隐藏密码 | 密码框右侧的眼睛按钮，`aria-pressed`，`aria-label` 为「显示密码」/「隐藏密码」 |
| 已经登录还打开登录页 | 直接 `router.replace` 到目标页（规则见 U2） |

**输入属性**：用户名 `autoComplete="username"`、`autoCapitalize="none"`、`spellCheck={false}`；密码 `autoComplete="current-password"`、`enterKeyHint="go"`。

**新增文案 key（`messages/zh/auth.json` / `messages/en/auth.json`）**

| key | 中文 | English |
|---|---|---|
| `usernameRequired` | 请输入用户名 | Enter your username |
| `passwordRequired` | 请输入密码 | Enter your password |
| `accountDisabled` | 该账号已停用，请联系团队管理员 | This account has been disabled. Contact your team admin. |
| `showPassword` | 显示密码 | Show password |
| `hidePassword` | 隐藏密码 | Hide password |
| `forgotPassword` | 忘记密码？ | Forgot password? |
| `forgotPasswordTitle` | 忘记密码 | Forgot your password |
| `forgotPasswordBody` | LanmiaoTV 的账号由团队管理员创建。请联系你的团队管理员，在「团队管理 → 成员与积分」里为你重置密码。团队管理员忘记密码，请联系平台运营。 | LanmiaoTV accounts are created by your team admin. Ask your team admin to reset your password under "Team → Members & points". Team admins should contact platform support. |
| `forgotPasswordClose` | 我知道了 | Got it |
| `platformAdmin` | 平台管理 | Platform admin |

- 「团队管理 → 成员与积分」以实现时代码里的实际菜单名为准（grep「团队管理」；UX 方案批次还没上线时，用当前账号管理菜单的名字）。

**testid**：`auth-username`、`auth-password`、`auth-password-toggle`、`auth-submit`、`auth-error`、`auth-capslock`、`auth-forgot`、`auth-forgot-dialog`、`auth-icp`、`auth-platform-admin`。

### 5.5 功能修改

**U2 登录后回到原页面**
- 新建 `src/lib/auth/safe-callback.ts`：`resolveSafeCallbackUrl(raw: string | null, origin: string): string | null`。
  - 接受以 `/` 开头的相对路径，以及与 `origin` 同源的绝对地址（转换成 路径+查询+hash）；
  - 拒绝：`//` 开头、含 `\`、其它源、`javascript:` 等协议、任何语言前缀下的 `/auth/` 路径、`/api/` 路径；
  - 返回 路径+查询+hash，不合法返回 `null`。
- `page.tsx:53-58` 登录成功后：
  - 需要改密码 → `/auth/change-password?callbackUrl=<安全地址>`；
  - super_admin → 安全地址以 `/admin` 开头就去那里，否则 `/admin/accounts`；
  - 其他人 → 安全地址，没有就 `/works`。
- 修改密码页成功后同样处理 `callbackUrl`。
- grep `auth/signin`（`src` 下，不含测试）：所有跳去登录页的地方都带上 `callbackUrl`（前端用 `location.pathname + location.search`，服务端用请求路径）。
- 单测 `tests/unit/auth/safe-callback.test.ts`：`/works/1?a=b` 通过；`//evil.com`、`https://evil.com/x`、`/zh/auth/signin`、`/api/x`、`javascript:alert(1)` 都返回 `null`；同源绝对地址通过。

**U3 停用账号提示**
- `src/lib/auth.ts:79-95` 的 `authorize`：现在账号停用时在校验密码之前就返回 `null`（`:79-82`）。改成：
  1. 先校验密码，错误就返回 `null`；
  2. 密码正确但账号停用 → `throw new Error('ACCOUNT_DISABLED')`。
- 用户不存在时也做一次 bcrypt 比较（用一个固定的假哈希），让耗时和存在的用户一致，避免借响应时间判断账号是否存在。已经这样做了就不用改。
- `page.tsx:44-61`：`res.error === 'ACCOUNT_DISABLED'` 时显示 `accountDisabled`。
- 单测 `tests/unit/auth/authorize-disabled.test.ts`：停用 + 错密码 → `null`；停用 + 对密码 → 抛 `ACCOUNT_DISABLED`；正常 + 对密码 → 返回用户。

**U4 ICP 备案号**（运行时读取，不需要重新构建）
- 新建（已存在就修改）`src/app/[locale]/auth/layout.tsx`：服务端组件，`export const dynamic = 'force-dynamic'`，读 `process.env.ICP_NUMBER?.trim()`，通过 `src/components/frameos/auth/AuthSiteInfo.tsx` 的 Context 传给 `FosAuthShell`。
- 页脚左侧：`© 2026 LanmiaoTV · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" data-testid="auth-icp">{备案号}</a>`。没设置时不显示这一段。
- 生产 `.env` 加 `ICP_NUMBER=<用户提供>`，属于批次 5 的放行范围。

**U5 忘记密码**
- 密码标签右侧的文字按钮「忘记密码？」，点击打开弹窗（复用 `AuthHelpButton` 的弹窗写法）：标题 `forgotPasswordTitle`，正文 `forgotPasswordBody`，按钮 `forgotPasswordClose`。
- `Esc` 和点遮罩都能关闭；关闭后焦点回到「忘记密码？」。

**U6a 平台管理入口**
- 卡片上的「平台 Admin 独立管理入口」从卡片移到页脚右侧，文案改为 `platformAdmin`，链接地址不变。

### 5.6 U6 性能

- `FosAuthShell` 去掉 `AuthCreativeScene`（WebGL），改用 §5.2 的 CSS 背景。grep 确认没有其它地方引用后，删除该组件文件。
- 登录相关页面不轮询 session（L3 已改）。
- 检查 `src/styles/frameos-tokens.css`、`frameos-replica.css` 有没有 `@font-face` 或 `@import` 网络字体会在登录页加载；有就去掉或加 `font-display: swap`。
- 用 `test-results/login-audit/shot.mjs` 的请求清单找出体积最大的几个 JS chunk，grep 它们的内容判断来自哪个包。登录页不应加载 `@xyflow/react`、画布相关模块、WebGL；这类模块在 `providers.tsx` 里被静态引入的，改成只在非登录页动态加载。
- **预算**（同一个 harness、同样的条件）：
  - 请求数 ≤ 18；
  - JS 解码后 ≤ 870 KB，总量 ≤ 1,400 KB；
  - LCP 桌面和手机都 ≤ 2,500 ms；
  - 5 s 内 network idle。

### 5.7 测试

- 必须继续通过：`tests/unit/frameos/auth-homepage.test.ts`、`tests/unit/brand/lanmiao-brand.test.ts:107-133`、`tests/unit/auth/password-change-middleware.test.ts`、`tests/browser/auth-home.browser.mjs`（11 个视口）。断言了被删除元素（WebGL 场景、卡片上的管理入口文字）的，按新设计更新断言，并写进「偏差」。
- 扩展 `auth-home.browser.mjs`，每个视口都检查：
  - 没有横向滚动条；
  - 登录卡片完整可见，或滚动可达；
  - 主按钮和输入框高度 ≥ 44px（先确认登录页有没有 1.2 倍 zoom，有就先除）；
  - fixture 设置了备案号时页脚显示 `auth-icp`；
  - 忘记密码弹窗能打开，`Esc` 关闭后焦点回到原按钮；
  - 错误态有 `role="alert"`；
  - 模拟 `prefers-reduced-motion: reduce` 时 `document.getAnimations().length === 0`。
- 截图：桌面 1440×900、平板 834×1112、手机 390×844，放在 `test-results/login-redesign/`，路径写进部署记录。

---

## 6. 批次与提交顺序

| 批次 | 内容 | 提交信息 | 前置 | 上线条件 |
|---|---|---|---|---|
| 0 | L0、L1（生产配置，无代码） | 只有部署记录的 `docs:` 提交 | 无 | R6 放行 |
| 1 | C8 | `perf: return canvas save deltas instead of full documents` | 无 | 与批次 1 其余部分一起上线 |
| 1 | L2、L3、C1、C2、T1、T2、T5、T7 | `perf: poster-first canvas videos, cacheable media and lighter polling` | 无（可以和批次 0 同时开发） | R6 放行 |
| 2 | L4、L5、T3、T6、compose 环境变量 | `perf: fair generation queue and streaming downloads` | 批次 1 | R6 放行 |
| 3 | C3、C4、C5、C6、C7 | `perf: canvas level of detail, cheaper autosave and paged material grids` | 批次 1 | R6 放行 |
| 4 | T4 | `feat: serve media through the CDN when configured` | 批次 1，用户完成 §7 | R6 放行，并设置环境变量 |
| 5 | U1–U6 | `feat: redesign the sign-in page` | 批次 1（L3 的 session 改动） | R6 放行，并提供备案号 |

- 批次 1 是两个提交：先 C8（工作区里已有的改动），再其余部分。其它批次一批一个提交。
- 批次 2、3、5 可以并行开发，但每天最多上线一批（包括 UX 方案的批次）。
- 每批的部署记录：`docs/deployments/beian-perf-<批次>-<日期>.md`；批次 5 用 `beian-login-redesign-<日期>.md`。

---

## 7. 用户控制台清单（随批次 0 的放行申请一起发给用户）

**A. 带宽**：告诉我们公网 IP 当前的带宽上限（Mbps）。L0 发现高峰打满时，再请你在控制台调高。

**B. CDN（T4 需要）**
1. 火山引擎 CDN 控制台 → 添加加速域名 `media.lanmiaoai.com`（主域名已备案），业务类型选「音视频点播」，计费方式选「按流量」。
2. 源站选对象存储 TOS 里现在用的存储桶（北京），开启「私有桶回源」。
3. HTTPS：为 `media.lanmiaoai.com` 申请或上传证书，开启 HTTP→HTTPS 跳转和 HTTP/2。
4. DNS：添加 `media` 的 CNAME，指向 CDN 给出的地址。
5. 访问控制 → URL 鉴权：Type A，参数名 `auth_key`，有效时长 24 小时，自己设置一个主密钥。
   - 密钥不要发在聊天里：像 `SSHPASS` 一样，在启动任务时放进环境变量 `MEDIA_CDN_AUTH_KEY`；
   - 实现方把它写进生产 `.env`，不写进任何其它文件、日志或提交。
6. 缓存规则：`mp4, webm, mov, png, jpg, jpeg, webp, gif, mp3, wav, m4a` 缓存 30 天，缓存键忽略所有 URL 参数。
7. HTTP 响应头（同样这些扩展名）：
   - `Content-Disposition: inline`（覆盖源站可能返回的 attachment）；
   - `Access-Control-Allow-Origin: https://lanmiaoai.com`；
   - `Access-Control-Allow-Methods: GET, HEAD`；
   - `Access-Control-Expose-Headers: Content-Length, Content-Range`。
8. 开启 Range 回源（视频拖动进度需要）。
9. 完成后回复「CDN 已配置」。

**C. 存储桶跨域（T3 直连下载需要）**：TOS 控制台 → 存储桶 → 跨域访问设置：
- 来源 `https://lanmiaoai.com`；测试站也用这个存储桶的话，加上 `http://nori.45-76-215-9.sslip.io`；
- 方法 `GET, HEAD`，允许头 `*`，暴露头 `Content-Length, ETag`，缓存 600 秒。

费用以控制台价格为准。一般来说，CDN 流量单价低于 ECS 公网流量，而且不再有「TOS 流出 + ECS 流出」的双重计费。

---

## 8. 验证

### 8.1 生产流量和耗时（R9 只读；只允许在生产机 `/tmp` 下创建 `nori-*` 临时文件，用完删除）

把下面的脚本保存为 git-ignored 的 `.runtime/perf/traffic-by-route.awk`，上传到生产机的 `/tmp/nori-traffic.awk`：
```awk
# 用法：zcat -f /var/log/nginx/access.log* | awk -v day='15/Nov/2026' -f /tmp/nori-traffic.awk
index($4, day) == 0 { next }
{
  split($7, u, "?"); p = u[1]; g = "other"
  if (index($7, "/api/storage/sign?") == 1 && index($7, "playback=1")) g = "sign-playback"
  else if (p == "/api/storage/sign") g = "sign-redirect"
  else if (p ~ /\/download$/ || p ~ /\/download-[a-z]+$/) g = "download"
  else if (p ~ /\/ops$/) g = "canvas-ops"
  else if (p ~ /\/canvas\/[^\/]+$/ && $6 == "\"GET") g = "canvas-get"
  else if (p ~ /^\/m\//) g = "public-media"
  else if (p == "/api/user/balance") g = "balance"
  else if (p == "/api/auth/session") g = "session"
  else if (p ~ /^\/_next\/static\//) g = "static"
  n[g]++; b[g] += $10
  if (match($0, / rt=[0-9.]+/)) print g, substr($0, RSTART + 4, RLENGTH - 4) > "/tmp/nori-rt.txt"
}
END { for (g in n) printf "%-14s %8d req %10.1f MB\n", g, n[g], b[g] / 1048576 }
```
耗时分位数：
```bash
sort -k1,1 -k2,2n /tmp/nori-rt.txt | awk '{ v[$1, ++c[$1]] = $2 } END { for (g in c) { n = c[g]; i50 = int(n * 0.5); i95 = int(n * 0.95); printf "%-14s n=%d p50=%.3f p95=%.3f\n", g, n, v[g, i50 < 1 ? 1 : i50], v[g, i95 < 1 ? 1 : i95] } }'
rm -f /tmp/nori-rt.txt
```
- 带宽：`tail -n 600 /var/log/nori-netrate.log | sort -t= -k2 -n | tail -5`（最高的 5 分钟）。

### 8.2 排队等待（只读 SQL）

先看 `prisma/schema.prisma` 里 `Task` 模型的字段有没有 `@map`，按实际列名改下面的语句。
```sql
SELECT DATE(queuedAt) d, COUNT(*) n,
  ROUND(AVG(TIMESTAMPDIFF(SECOND, queuedAt, startedAt))) avg_wait_s,
  MAX(TIMESTAMPDIFF(SECOND, queuedAt, startedAt)) max_wait_s,
  SUM(TIMESTAMPDIFF(SECOND, queuedAt, startedAt) > 60) over_60s,
  ROUND(AVG(TIMESTAMPDIFF(SECOND, queuedAt, finishedAt))) avg_total_s
FROM tasks
WHERE queuedAt > NOW() - INTERVAL 7 DAY AND startedAt IS NOT NULL AND type LIKE '%video%'
GROUP BY DATE(queuedAt) ORDER BY d;
```
- L4 之前，在闸门里等待的时间被算进了运行时间，所以前后对比以 `avg_total_s`（排队 + 运行）为主。

### 8.3 画布性能

- harness：`tests/browser/canvas-pan-performance.browser.mjs` 加 fixture，运行方法见 `tests/browser/README.md`。
- 场景改为 200 个节点，其中 50 个视频节点。分别测：
  1. 平移 3 s；
  2. 缩放 0.3 ↔ 1.2 往返；
  3. 打开画布后 2 s 内的请求数和 `<video>` 元素数。
- 批次 1 前、批次 1 后、批次 3 后各测一次，写进部署记录。

### 8.4 每批完成标准

**所有批次**
- `npm run typecheck` 不新增错误（基线的 12 行除外）；改动文件 `npm run lint` 通过；
- 本批列出的单测、集成、浏览器测试全部通过；
- 测试机部署并验收；部署记录写了前后数据（R10）；
- 按 §6 提交。

**各批另外要满足**

| 批次 | 完成标准 |
|---|---|
| 0 | §1 的验收全部满足；基线记录 `beian-perf-baseline-<日期>.md` 已提交 |
| 1 | 打开含 50 个视频节点的画布时 `<video>` 为 0，点击播放后正常；测试机开一个标签页 10 分钟，`balance` 请求 ≤ 35 次，标签页隐藏期间为 0；`ops` 响应 < 5 KB；同一张图片 6 小时内重复打开命中浏览器缓存；生产上线 24 小时后日出口 ≤ 8 GB（没达到就按路由分组分析并写进记录，不算回滚条件） |
| 2 | 公平性集成测试通过；打包下载内存和余额 p95 达标（§2.4）；下载直连或兜底都能用；`curl -sL` 访问 `/m/…` 能拿到文件；生产 24 小时后其它团队的视频排队 p95 ≤ 30 s，供应商 429 ≤ 1% |
| 3 | 平移和缩放平均帧时间 ≤ 20 ms；C5 性能测试、C6 测试、C7 验收都通过 |
| 4 | §4.4 的 5 条验收通过；次日服务器出口 ≤ 2 GB |
| 5 | §5.7 的测试通过；§5.6 预算达标；三种视口的截图已保存 |

---

## 9. 不做（以及原因）

| 不做 | 原因 |
|---|---|
| 把存储桶迁到上海 | 迁移量大、风险高；CDN 上线后 ECS 和 TOS 之间不再有大流量，收益小 |
| 精简画布节点的数据结构（如重复保存的提示词） | 旧版本前端会把裁掉的字段写回去，需要协调版本；diff 缓存和增量保存已经解决了主要成本 |
| 给 session 和用户查询加缓存 | 缓冲池调大后主键查询都在内存里；缓存会让权限变更延迟生效 |
| 调整 Prisma 连接池 | `Max_used_connections` 只有 20，没有出现 P2024 |
| 放宽 MySQL 刷盘设置 | 会牺牲数据安全 |
| 用 SSE / WebSocket 推送代替轮询 | 改动大；轮询减量后请求量已经可以接受；`/api/sse` 保持现状 |
| 把 worker 拆到单独的机器 | 要新服务器和费用；先看 L4、L5 之后的效果 |
| 视频转多码率（HLS） | 转码和存储成本高；先看封面优先和 CDN 之后的流量 |
