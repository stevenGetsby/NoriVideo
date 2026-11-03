# 2026-11-03 视频预览时间线发布

## 版本

- 候选镜像：`norivideo:release-20261103-video-timeline`
- 源指纹：`8a9631400e37876816abbf429f06ce6192189ed6404e17543562bf4e1bd2cbcb`
- 提交：`41e8e22 feat: JianYing-style preview timeline for enlarged video nodes`
- 上一版本：`release-20261101-scoped-permissions`（`adfe624f…`）
- 纯代码发布，Prisma schema 未变（`schemaChanged: false`）

## 变更范围

只改了画布视频节点放大预览相关 9 个文件：三条轨时间线（缩略图 / 波形 / 可拖关键帧）、悬停帧预览、
MP4 容器读取真实帧率、镜头切换识别、关键帧面板与批量存画布、关键帧随节点持久化（`videoKeyframes`）、
播放速度 / 循环 / 静音 / 全屏、快捷键与响应式布局。

## 验证

- 部署守卫全过：备份、上一镜像指纹核对、产物校验、架构 amd64、schema diff 为空（纯代码发布）、
  无在跑任务、健康检查 app/admin 通过、billing=ENFORCE test-mode=OFF、线上签名 200/200。
- 本地：tsc / eslint 干净，画布相关 468 个单测通过，时间线浏览器测试全过
  （镜头识别精确到 1.00s/2.00s；1440/1280/768/390 截图无横向溢出；只读模式拦截）。
