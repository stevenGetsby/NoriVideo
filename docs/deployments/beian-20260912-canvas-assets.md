# 备案机发布记录：2026-09-12（画布资产库上传 + 引用素材加号 + 首尾帧模式修复）

用户明确指定部署到备案机 `14.103.65.61`。本次包含三项改动：

1. 右键画布内的图片节点可直接归类上传到资产库。
2. 视频/图片/音频生成节点的「引用素材」行最右侧新增素材库加号，无需连线即可引用素材。
3. 修复打开已保存的「首尾帧」视频节点时模式被错误降级为「全能参考」的问题。

未修改 `45.76.215.9`，未访问退役服务器。

## 关键实现

- `src/app/api/projects/[projectId]/canvas/[canvasId]/materials/route.ts`：JSON 分支新增 `register: 'library'` 模式。
  以 `source: 'upload'` 写入当前项目素材，并写入 `assetCategory`、`canvasId`、`canvasNodeId`、`uploadedFromCanvas`；
  仅接受图片节点；原 `reference` 模式行为不变。
- `src/features/canvas/components/CanvasAssetLibraryDialog.tsx`：新增归类上传对话框（名称 + 角色/场景/道具）。
- `src/features/canvas/components/CanvasMenus.tsx`、`CanvasGraph.tsx`：节点右键菜单新增「上传到资产库」，仅图片节点且可写时出现。
- `src/features/canvas/components/CanvasGenerator.tsx`：引用素材行始终渲染，行尾新增素材库加号；
  按模式选择素材类型（全能参考=全部、图生视频/首尾帧/图片=图片、音频=音频），上限按模型能力计算；
  新增 `injectedReferenceNodeIds` 注入，素材库选中的素材落到画布后直接成为引用，不需要连线。
- `CanvasGenerator` 的模式校正改为在 `currentModel` 就绪后才降级：
  原先 `!currentModel?.raw?.firstLastFrame` 在配置未加载时恒为「不支持」，
  会把已保存的首尾帧模式重置为全能参考；现在只在确认模型不支持时才降级。

## 版本与备份

- 发布镜像：`norivideo:release-20260912T064817Z-canvas-assets`
- 镜像 ID：`611c97c3af41579b0b704462afcae3dd192850ef7c92533f270a84e412f77f93`（原生 amd64）
- 回退镜像：`norivideo:predeploy-20260912T064817Z`（`e3ec978995a1`，即 9/12 上午的上传修复版本）
- 源码与构建记录：`/opt/norivideo/releases/20260912T064817Z-canvas-assets`
- 数据库与配置备份：`/opt/norivideo/backups/20260912T064817Z-canvas-assets`（目录 700，数据库备份 600）

源码以归档方式传输，未上传任何密钥文件；构建在服务器原生完成。本次无 Prisma schema 变更。

## 验证结果

- 部署前确认无排队或进行中的生成任务。
- 候选镜像与上线后的容器均通过固定 TOS 守卫与上传/读取/签名读取/删除探测，临时对象已删除。
- 容器内确认改动均在产物中：`nori-canvas-generator-ref-add`、`上传到资产库`、`uploadedFromCanvas`，以及带 `if (currentModel)` 保护的首尾帧判定。
- 公网工作台 `https://lanmiaoai.com`、管理台 `https://lanmiaoai.com:8080` 均返回 HTTP 200；
  公网静态资源 `/_next/static/chunks/4676-0a391d177dae8bb4.js` 已包含新引用加号代码。
- `.env`、`data/services.prod.json`、`.deploy.env`、`docker-compose.prod.yml` 与备份逐字节一致，权限 600。
- 切换后日志中的 `api.request.error` 仅有一条与本次无关的业务提示（管理台加积分时平台积分不足），非新版本引入的异常。

## 配套测试

- 单测：新增画布资产库入口、归类写入、非图片拒绝、引用加号接线、引用上限计算、首尾帧不降级等用例；
  `tests/unit/canvas` 374 项中 373 项通过，唯一失败 `scoped-capability-routes` 为改动前既有问题。
- 浏览器回归：`tests/browser/generator-refs.browser.mjs` 用真实组件验证加号位置与点击类型，
  并断言首尾帧节点在配置加载后仍保持 `firstlastframe`。
