# 备案机发布：画布一键整理规则与节点视频播放器

完成时间：2026-10-27 19:46（Asia/Shanghai）。发布目录标签：`20261027-canvas-organize`。

## 发布内容

- 画布「一键整理」右侧下拉改为完整的整理规则菜单，分两组共 5 种规则：
  - 按连线：从左到右、从上到下（沿用分层布局）。
  - 按内容：宫格排列、按类型分栏（文本/图片/视频/音频等各自成栏，栏过满时自动均衡拆成多列）、对齐行列（保留现有行列，左对齐并拉开间距）。
- 菜单交互：每个规则配一张 24px 布局缩略图；当前规则打勾；主按钮显示当前规则的缩略图，标题带规则名；选择后记录该规则，下次打开沿用；末尾保留「重置视图」。
- 新增 `type`、`tidy` 两种布局算法；分组与其成员仍作为整体移动，不会被拆散。
- 画布节点视频改用自绘播放器（`CanvasNodeVideo`）：播放按钮、悬停控制条、静音、全屏，拖拽节点时不误触播放控件；创作节点与生产节点共用。

## 构建与制品

| 源码指纹 | 制品 SHA-256 | 镜像 |
| --- | --- | --- |
| `114462c4b98d42d3b55416464407f6953fd8634ffd05b4e8ac84c6981868d343` | `fe1412da1290fc663af311fd0f1170bc0f101b2bace6b1c51de58103035a0b3b` | `norivideo:release-20261027-canvas-organize` / `sha256:d57e1d171b5ade2823c9902c122a20a7c14a07f3b15b1ebd41822dcaec1a4aec` |

- 相对上一版源码仅 10 个前端文件变化，`package.json`、`package-lock.json`、`prisma/schema.prisma`、`Dockerfile` 未变。
- 在备案机 `--network none` 隔离容器内、从上一版镜像构建；补入 Linux 平台的 Tailwind oxide 与 lightningcss 原生包。
- 制品只含 `.next`、`dist`、`public`、`messages`，已剔除 `.next/cache`。
- 打包源码需用 `tar --no-xattrs --no-mac-metadata`：macOS 默认会把扩展属性写成 `.__document.tsx` 一类 AppleDouble 文件，Next 会把它当页面编译并报非 UTF-8 错误。

## 切换记录

- 发布前 `fixed-tos-config-guard` 通过（bucket `nori-test`）。
- `.env`、`.env.local`、`.deploy.env`、`docker-compose.prod.yml`、`data/services.prod.json` 与备份逐字节一致。
- 切换前后各备份一次业务库（`/opt/norivideo/backups/20261027-canvas-organize/nori.sql.gz` 与 `nori-pre-switch.sql.gz`）。
- Prisma schema diff 为空；切换时 queued/processing 任务为 0。
- 仅重建 app/admin；MySQL/Redis 未重建。`BILLING_MODE=ENFORCE`，测试模式关闭。
- 回滚镜像保留：`norivideo:release-20261027-account-isolation` / `sha256:1b29b62ea2afc88dab92fa80bc5ec1702287f5dff54f9e2335b53add3c886a1f`。

## 线上验证

- app/admin 均 healthy，使用同一镜像，源码标签 `114462c4…` 一致。
- 新代码标识「整理方式」「已按类型分栏整理画布」已出现在 `.next/server/app/[locale]/canvas/[[...segments]]/page.js` 与静态 chunk `2213-af56c7f10c00238f.js`。
- TOS 上传/读取/签名读取/删除探针通过。
- `https://lanmiaoai.com/zh/auth/signin` 与 `https://lanmiaoai.com:8080/zh/admin/signin` 均返回 200。
- 发布前本地 `tsc --noEmit` 无错误；画布单测 72 个文件、414 项全部通过；菜单与 5 种规则在无头 Chrome 中截图核对。
- 未在真实账号下逐项点验收；建议在画布上逐个试一遍「按类型分栏」「对齐行列」。

## 清理

- 已删除 `/opt/norivideo/build`（源码、原生包补丁与构建目录），保留发布目录、制品、业务库备份与上一版回滚镜像。

## 入口

- 工作台：`https://lanmiaoai.com/zh/auth/signin`
- 管理台：`https://lanmiaoai.com:8080/zh/admin/signin`
