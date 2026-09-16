# 备案机发布记录：2026-09-12（3D 导演台节点 + 大文件上传）

用户明确指定部署到备案机 `14.103.65.61`，包含两项修复：

1. 3D 导演台节点拖不动、文字错位。
2. 素材选择器上传超过约 10MB 的图片（典型为场景图）时报 `Failed to parse body as FormData.`。

未修改 `45.76.215.9`，未访问退役服务器，未接入 MiniMax H3。

## 根因

`next.config.ts` 未设置 `experimental.middlewareClientMaxBodySize`。中间件匹配全部 `/api/*`，
Next.js 会把请求体克隆一份交给中间件运行时，默认只克隆 10 MiB，超出部分被静默丢弃，
导致路由里 `request.formData()` 解析 multipart 失败。人物图、资产图通常小于 10MB 因而正常，
场景图超过 10MB 时必然失败。本地实测阈值：10.4MB 成功、10.485MB 起失败。

3D 导演台节点则是整张卡片与标题都带 `nodrag`，可拖动区域几乎只剩图标；同时元信息使用 7–10px 字号和固定高度，文字挤压错位。

## 变更

- `next.config.ts`：`experimental.middlewareClientMaxBodySize` 设为 `220mb`，覆盖素材接口自身 200MB 单文件上限。
- `src/lib/http/request-form-data.ts`：新增，把残留的截断报错转成可读提示；素材上传与视频超清接入。
- `src/lib/frameos/material-upload.ts`：图片像素超限时明确提示尺寸，不再笼统提示“无法读取这张图片”。
- `src/features/canvas/nodes/Studio3DNode.tsx`、`studio-types.ts`、`editor-types.ts`、`canvas.css`：
  恢复卡片与标题拖动、保留双击/键盘进入导演台、隔离工具栏与缩放控制点、元信息分行显示并统一最小尺寸。

## 版本与备份

- 发布镜像：`norivideo:release-20260912T060251Z-studio-upload`
- 镜像 ID：`e3ec978995a12ad46f15450f67c111e19c71e7d2aa4d001169050737ed4d33d4`（原生 amd64）
- 回退镜像：`norivideo:predeploy-20260912T060251Z`（`20e0d9ed0f3b`，即 9/8 发布版本）
- 源码与构建记录：`/opt/norivideo/releases/20260912T060251Z-studio-upload`
- 数据库与配置备份：`/opt/norivideo/backups/20260912T060251Z-studio-upload`（目录 700，数据库备份 600）

源码以归档方式传输，未上传任何密钥文件；构建在服务器原生完成。
本次无 Prisma schema 变更，`database` 未做结构变更。

## 验证结果

- 部署前确认无排队或进行中的生成任务。
- 候选镜像与上线后的容器均通过固定 TOS 守卫与上传/读取/签名读取/删除探测，临时对象已删除。
- 容器内确认三项修复均存在：`middlewareClientMaxBodySize`、`UPLOAD_BODY_INCOMPLETE`、`nori-canvas-studio-node-stats`。
- 公网上传 30MB 请求体不再触发 Next 的 “Request body exceeded” 截断告警（部署前会截断）。
- 工作台 `https://lanmiaoai.com`、管理台 `https://lanmiaoai.com:8080` 均返回 HTTP 200，且为真实 Next 应用页面。
- `.env`、`data/services.prod.json`、`.deploy.env`、`docker-compose.prod.yml` 与备份逐字节一致，权限保持 600。
- 生产库中无探测残留素材（`probe*` 计数为 0）。

本次未使用真实账号发起付费生成，也未用生产账号做端到端上传；上传修复由本地端到端用例
（25.7MB 真实图片上传成功、30MB 损坏文件返回明确 400）与上述线上截断告警验证共同覆盖。
