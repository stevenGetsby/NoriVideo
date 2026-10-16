# 所有需求发布：本地预检状态（历史记录）

以下为发布前的历史状态，不代表当前上线状态。用户随后确认部署至备案机；2026-10-15 已完成发布与线上验收，实际结果见 [正式部署记录](./beian-all-requirements-20261015.md)。

- 目标需要最终确认：此前反复指定的备案机 `14.103.65.61`；不修改 `45.76.215.9`，不访问退役机。
- 完整源码阶段：`.runtime/canvas-reference-release/all-requirements-Mfgq2Z`。
- 最终源码指纹：`4fee053cca7a9558e1e51dcc29dc262a7d2ea6719305553ff42d98cd175f3b97`。
- 候选标签：`norivideo:release-20261015-all-requirements`。最终镜像仍在构建，使用前必须核对镜像标签里的源码指纹等于上面指纹；旧指纹 `596a…`、`8a2c…` 都不是最终候选。
- 全项目单元/API/供应商协议：581 文件、2689 项通过，无跳过。源码媒体额外 21 项 Vitest 和 6 项原生 node:test 通过；原生测试使用 `tsx --test` 独立执行。
- 真实临时 MySQL：计费并发 38 项、素材/音色事务 7 项通过。
- 浏览器：素材/音色/下载目录 20 组，批量连接 10 组，画布六视口与 48 个弹窗边界，项目/资产操作与层级/分页等通过。
- 修改文件 ESLint、TypeScript、固定 TOS、定价/能力目录、API 路由守卫通过；SQL 守卫已验证仅允许新增两个可空导出字段，拒绝删列。
- 测试报告保存在忽略的 `test-results/all-requirements-20261015/`。没有在业务数据库执行重置或导入测试数据。

## 发布工具

`.runtime/canvas-reference-release/deploy.sh`、`validate-schema.mjs` 已准备，本地 Shell 语法检查通过，但尚未在服务器执行。发布前保留并备份 `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 和业务库，核对归档及镜像指纹；先 TOS 守卫，再上传/读取/签名读取/删除探测。只允许 `novel_promotion_projects` 的 `exportNamingTemplate`、`exportDirectoryHint` 两列新增。

只有生成队列无 queued/processing 时才重建 app/admin；不重建 MySQL/Redis 或数据卷。两者使用同一新镜像和原 `nori` 业务库，ENFORCE 与非测试模式必须保持。切换后重新检查受保护文件、TOS、健康状态、登录、项目/素材/余额/账号接口及关键界面。未进行真实付费生成，不能将模拟协议测试当作上游持续可用性证明。

本轮临时容器/网络：`norivideo-all-check-20261015`、`nori-assets-test-mysql-20261014`（tmpfs 临时库）、`nori-all-review-redis-20261015`、网络 `nori-all-review-20261015`。与真实业务 MySQL/Redis 无关联；交付后仅清理这些本轮精确目标。
