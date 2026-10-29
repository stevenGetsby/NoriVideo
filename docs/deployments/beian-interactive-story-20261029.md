# 备案机发布：互动影游画布与品牌配色

完成时间：2026-10-29 12:00（Asia/Shanghai）。发布目录标签：`20261029-interactive-story`。

## 发布内容

- 互动影游（影游）第一期：`interactive_stories` 数据模型、章节/作品 API、剧情编译与校验引擎、剧情总览页和试玩播放器。
- 章节画布新增剧情节点（开场、选择、片段、镜头、结局等）与剧情连线：端口吸附、空白处松手弹出建节点菜单、不可连目标给出原因、重连替换旧线、连线可删除。
- 画布交互重做：新建/粘贴/复制节点放进最近空位不互相遮挡；「生成画面」在片段上方腾出位置；标题拖动卡片、双击改名；剧情画布支持一键整理。
- 全局配色替换暗房灰白：单一品牌蓝紫渐变主色、分媒体/功能色相，统一控件高度沿用 32/28/40。
- 素材接口测试同步账号隔离后的项目可见范围（`projectParticipantWhere`）。

## 构建与制品

| 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- |
| `92ee0e8575301dc11b05827a5d55f871bde4a93836a8b8f01e3855a00b08c254` | `46dc1bcc963ece17d1d59dc20e259630049b24702b79823a784c13fb174b17b4` | `norivideo:release-20261029-interactive-story` / `sha256:f7a31ed57eeafaac493cf31679b96c6e2e28945c683aa4819c7509599aa3005f` |

- 相对上一版源码变化 119 个文件（哈希根目录内），新增影游服务端/前端/测试文件。
- `package.json` / `package-lock.json` 未变，沿用上一版镜像的依赖与本地的 Linux 原生包 `node_modules.tar.gz`，全程 `--network none` 构建。
- `prisma/schema.prisma` 本次有变更。制品镜像沿用上一版镜像作为基底，因此构建产物在 `.next`/`dist`/`public`/`messages` 之外额外带上 `prisma/` 与重新生成的 Prisma Client（`node_modules/.prisma/client`，含 linux query engine）；load 阶段断言两处均含 `InteractiveStory`。
- 在备案机隔离容器内 `next build` 通过，静态页面 164/164 生成成功。

## 数据库

- 结构差异经 `prisma migrate diff` 审阅，仅新增一张表和一个外键：

  ```sql
  CREATE TABLE `interactive_stories` (...);
  ALTER TABLE `interactive_stories` ADD CONSTRAINT `interactive_stories_workId_fkey`
    FOREIGN KEY (`workId`) REFERENCES `works`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
  ```

- 切换脚本拒绝任何 `DROP/TRUNCATE/RENAME/ALTER COLUMN/MODIFY`；确认仅新增后，通过既有 `prisma db push --skip-generate` 工作流同步，未删除表或已有列。
- 同步后再次 diff 为空；`interactive_stories` 表存在。
- 切换前后各备份一次业务库（`/opt/norivideo/backups/20261029-interactive-story/nori.sql.gz` 与 `nori-pre-switch.sql.gz`，各 7.2M）。

## 切换记录

- 发布前 `fixed-tos-config-guard` 通过（bucket `nori-test`）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- Prisma 差异为纯新增；切换时 queued/processing 任务为 0。
- 仅重建 app/admin；MySQL/Redis 未重建。`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261028-darkroom` / `sha256:b1c713c7a71007e5d5392ef90183543d71e9c841cc57182039e201998e96b72b`。

## 线上验证

- app/admin 均 healthy，使用同一镜像，源码标签 `92ee0e85…` 一致。
- 在 app 容器内实例化 Prisma Client 查询 `interactive_stories` 成功（0 行），确认新生成的客户端与表均可用。
- 工作台 `https://lanmiaoai.com/zh/auth/signin`、管理台 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 发布前本地 `tsc --noEmit` 无错误；单测 531 文件、2333 项通过；数据库集成/系统/回归套件中隔离相关接口测试已更新并通过。既有系统/回归用例仍受零余额计费门槛与陈旧断言影响，与本次改动无关。
- 未在真实账号下逐项点验收；建议重点试一遍：创建影游、在章节画布里建剧情节点与连线、剧情总览与试玩。

## 清理

- 已删除 `/opt/norivideo/build`（源码与构建目录），保留发布目录、制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
