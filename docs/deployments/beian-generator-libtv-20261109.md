# 2026-11-09 画布生成器 LibTV 式编辑框

## 变更范围

- 节点生成器（storyboard 编辑框）移除悬停自动放大预览与“自动放大”开关。
- 引用素材改为 42px 方形编号缩略图：缩略图铺满，左上角显示序号（首尾帧模式显示“首/尾”），名称仅保留给读屏；聚焦、故事版入口与添加按钮同尺寸排在同一行。
- 提示词改为无边框主输入区：12px 字号、1.7 行高、最小 96px，随内容增高至 260px；非全屏时不再显示底部提示文案。
- 模型、参数、报价与发送收进底部单行，发送为 32px 圆形箭头按钮，提交中显示加载图标；面板圆角 12px，宽度拖拽手柄仅在悬停、拖动或聚焦时显示。
- 修复提交生成时的保存竞态：预提交保存进行中若又有画布改动（例如视口平移落定），会继续保存后再提交，不再因“画布仍有未保存的更改”导致生成失败。

## 验证

- 画布与菜单相关单元测试 525 条通过；另有 5 条失败在 HEAD 上同样失败（chrome-hierarchy ×3、multi-image-client-handoff、parity-polish），与本次改动无关。
- 新增浏览器回归：预提交保存挂起期间中键平移画布，生成仍正常提交且不出现未保存错误；未修复时 2/2 失败，修复后 2/2 通过。
- 生成器引用浏览器测试、批量节点连线浏览器测试通过。
- 完整画布浏览器回归 4 次中 3 次通过；1 次在 1280×480 视口的“放大预览”悬停按钮处超时（鼠标未移动时悬停控制条未显示，属未改动场景的时序抖动），随后两次复跑均通过。
- 修改文件 ESLint 通过，`git diff --check` 通过；`tsc --noEmit` 仅报告未纳入发布的 Finder 重复文件。

## 发布

- 基础镜像：`norivideo:release-20261109-lanmiao-brand-canvas`。
- 候选镜像：`norivideo:release-20261109-generator-libtv`。
- 源指纹：`e797db67fea13ef77476f9b05f4371c1141219b8b06906485d189bd91766d16f`。
- 源包 SHA256：`413d314738fcb37c6efa23f02f1594155d0172ff6d758def843fd79eeb6ac81a`。
- 制品 SHA256：`a2f25e8870c8b7c2fd0b9191b61e92b09a481e1fdc71e3bbcecef48b1aa9bf1a`。
- 镜像 ID：`sha256:c6a21a40e3de71e22333fb8f067eaceeec2b8c163f211a26d7f3a5edb5f8ffdb`。
- 相比上一版仅 3 个源文件变化：`canvas.css`、`CanvasGenerator.tsx`、`useCanvasAutosave.ts`。
- 发布包排除服务密钥配置、软著材料、`.runtime/`、测试输出及全部 Finder 副本。
- 服务器使用 `--network none` 构建；候选镜像校验编号标签存在、旧悬停预览样式已移除；schema diff 为空，未执行 `prisma db push`。
- 切换前无排队或处理中的生成任务；切换后 app/admin 均 healthy、镜像与源码指纹一致、billing=ENFORCE、test-mode=OFF、TOS 上传/读/签名读/删除探针通过、受保护配置文件与备份逐字节一致。
- 登录页 200、管理台 200、未认证 `/api/tasks` 401，切换后 app/admin 日志无错误。

## 回滚

- 重新将 `norivideo:release-20261109-lanmiao-brand-canvas` 标记为 `norivideo:latest`，仅重建 app/admin。
- 数据库无变更；切换前备份位于 `/opt/norivideo/backups/20261109-generator-libtv/`。
