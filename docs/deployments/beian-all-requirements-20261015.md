# 备案机发布：全部在范围内的需求与修复

验收完成时间：2026-10-15 11:40（Asia/Shanghai）。

## 目标与版本

- 用户明确指定备案机 `14.103.65.61`；本次未访问或修改其它服务器。
- 版本：`norivideo:release-20261015-all-requirements`。
- 最终源码指纹：`4fee053cca7a9558e1e51dcc29dc262a7d2ea6719305553ff42d98cd175f3b97`。
- 镜像归档 SHA-256：`cded2b6772c2c7cfd4f5652c4c3ef416366b33d1fb88e2556bbd5b6112900b51`。
- 已核对归档、amd64 架构及镜像源码标签；工作台与管理台使用同一候选镜像。
- 需求范围与实现说明见 [完成与验证记录](../fixes/all-requirements-20261015.md)。

## 数据与部署安全

- 发布前备份服务器原配置、业务数据库与原镜像 ID，目录为 `/opt/norivideo/backups/20261015-all-requirements/`；备份目录仅 root 可访问。
- 第一次切换检查发现正在生成的视频，未执行切换。等待其自然完成、队列无 queued/processing 后，再做新鲜业务库备份 `nori-pre-switch.sql.gz`，完成安全切换。没有取消任务。
- 只重建 `app`、`admin`；MySQL、Redis 和业务数据卷未重建，也没有导入本地测试数据库或重置账号、余额、项目、任务、素材。
- 服务器 `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 数据库严格检查后只新增 `novel_promotion_projects.exportNamingTemplate`、`exportDirectoryHint` 两个可空字段；迁移后的数据库与候选 Prisma schema 无结构差异。
- 固定 TOS 守卫通过，仍为 Volcengine `cn-beijing / nori-test`。切换前后均完成随机对象上传、读取、签名读取、精确删除，探测对象已删除。
- `BILLING_MODE=ENFORCE`，测试模式关闭。旧生产镜像和数据库备份保留供回滚；不会通过回灌旧库覆盖新业务数据。

## 测试与线上验收

本地已完成 581 个测试文件、2689 项单元/API/供应商协议回归，无跳过；另有源码测试、临时真实 MySQL 计费/并发/素材事务测试、真实浏览器交互与多视口边界测试，详见需求完成记录。

线上只读验收通过：

- 四个容器均 healthy；app/admin 无重启、无 OOM。
- 工作台与管理台 HTTPS 登录入口均 HTTP 200，真实会话及管理员账号接口正常。
- 项目、作品、素材、余额、既有画布数据、新导出设置可读取；无效输入与不存在素材的权限/错误响应正确。
- 1280×720、1024×600、390×700：人物/场景/道具/音色选择器、确认关闭、纯文生/全能参考切换、历史刷新反馈、批量上传弹窗均通过；390px 新建项目按钮位于视口内。
- 20 个既有视频均成功分段读取（HTTP 206，正确 Content-Range、inline 视频类型）；素材下载成功返回 UTF-8 文件名。
- 浏览器中 9 个既有生成视频均加载出有效分辨率和时长，没有媒体错误；已实际启动并验证视频播放时间前进。
- 页面切换时有浏览器 `net::ERR_ABORTED` 视频请求，服务端日志将部分中止记录为 EXTERNAL_ERROR；稳定页面的 9 个视频无媒体错误、20 条分段读取成功，未观察到实际播放失败。没有将这些日志表述为“零错误日志”。
- 验收未提交付费生成、未修改真实项目/素材/账号。供应商协议模拟测试不等于上游实时生成可用性实测。

验收证据保存在忽略的 `test-results/production-all-requirements-20261015/`，含多视口截图、`final-audit.json`、`video-browser.json` 和实际播放截图。部署与只读验收脚本位于忽略的 `.runtime/canvas-reference-release/`。

## 清理

仅移除本轮临时测试容器 `norivideo-all-check-20261015`、`nori-assets-test-mysql-20261014`、`nori-all-review-redis-20261015` 及专用网络、匿名测试缓存。临时测试数据可按测试脚本重建，结果报告保留。本地业务 MySQL、MinIO、Redis 未改动；未全局清理镜像或卷。

## 访问入口

- 工作台：`https://14.103.65.61/zh/auth/signin`
- 管理台：`https://14.103.65.61:8080/zh/admin/signin`

IP 证书可能触发浏览器证书提示。本记录不包含任何密码、密钥、会话令牌或签名 URL。
