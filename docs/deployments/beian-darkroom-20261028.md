# 备案机发布：A 暗房设计系统与交互人性化

完成时间：2026-10-28 14:50（Asia/Shanghai）。发布目录标签：`20261028-darkroom`。

## 发布内容

- 全局采用「A 暗房」配色：黑与中性灰分层，白色是唯一强调色，红色只用于危险操作；统一 32/28/40 控件高度与 12/8/4 圆角。
- 图标换成内置 Phosphor 图标集，`lucide-react` 从 `package.json` / `package-lock.json` 移除，并从镜像中清除残留目录。
- 所有原生 `alert` / `confirm` 改走站内提示：排队确认弹窗（危险操作默认聚焦「取消」）、按等级着色的轻提示（成功/警告/信息/错误）。
- 删除剧本、删除有正文的分集、清空机位截图、取消运行中任务补上二次确认。
- 创建作品、新增资产等弹窗在已填写内容时，点背景、按 Esc 或点关闭会先询问是否放弃；多个弹窗叠加时 Esc 只关最上层。
- 按钮禁用时给出原因提示（如创建作品提示先填名称、出场集显示已选集数）。
- 侧栏「问题反馈」可真实提交到 `/api/feedback`；「检查更新」显示当前版本号；分集删除按钮放大并支持触屏。
- 一并提交此前已部署但未入库的画布「一键整理」菜单与节点视频播放器。

## 构建与制品

| 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- |
| `81a5e6b1492d2b34a705a4b6a91e1a671d7c7c677b1a5c094f2f0ad01e1112cd` | `a0265695a8bfaaa5aaf795690a3ad6e1fde89fadf3e43553e489fde89804a953` | `norivideo:release-20261028-darkroom` / `sha256:b1c713c7a71007e5d5392ef90183543d71e9c841cc57182039e201998e96b72b` |

- 相对上一版源码变化 232 个文件（含 131 个 Phosphor 图标文件），`prisma/schema.prisma`、`Dockerfile` 未变。
- 本次是首个改动依赖清单的发布：`lucide-react` 仅移除、无新增依赖，因此仍可在 `--network none` 隔离容器内基于上一版镜像的 `node_modules` 完成构建，不需联网安装。
- 为让镜像与清单一致，先从 `norivideo:release-20261027-canvas-organize` 派生出 `norivideo:release-20261028-darkroom-base`（删除 `/app/node_modules/lucide-react`），制品镜像再基于该中间层构建；`switch` 阶段会断言运行容器内不存在该目录。
- Linux 平台 Tailwind oxide 与 lightningcss 原生包沿用与上一版相同的版本（tailwindcss/oxide 4.1.13、lightningcss 1.30.1）。
- 在备案机 `--network none` 隔离容器内构建，`next build` 通过（仅剩既有 bullmq 动态依赖告警）。

## 切换记录

- 发布前 `fixed-tos-config-guard` 通过（bucket `nori-test`）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 切换前后各备份一次业务库（`/opt/norivideo/backups/20261028-darkroom/nori.sql.gz` 与 `nori-pre-switch.sql.gz`）。
- Prisma schema diff 为空；切换时 queued/processing 任务为 0。
- 仅重建 app/admin；MySQL/Redis 未重建。`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261027-canvas-organize` / `sha256:d57e1d171b5ade2823c9902c122a20a7c14a07f3b15b1ebd41822dcaec1a4aec`。

## 线上验证

- app/admin 均 healthy，使用同一镜像，源码标签 `81a5e6b1…` 一致。
- `lucide-react absent` 断言通过；`billing=ENFORCE test-mode=OFF`。
- 新代码标识「感谢反馈」已出现在 `.next/server/chunks/22785.js` 与静态 chunk `1599-ca5e861109ad2f4c.js`；上一版画布「整理方式」标识仍在，确认无回退。
- TOS 上传/读取/签名读取/删除探针通过。
- `https://lanmiaoai.com/zh/auth/signin` 与 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 发布前本地 `tsc --noEmit` 无错误；全量单测 522 个文件、2275 项全部通过（移除依赖后复跑）。
- 未在真实账号下逐项点验收；建议重点试一遍：新建作品放弃确认、删除剧本/分集、问题反馈提交、画布一键整理。

## 清理

- 已删除 `/opt/norivideo/build`（源码、原生包与构建目录），保留发布目录、制品、业务库备份、上一版回滚镜像与 `darkroom-base` 中间层。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
