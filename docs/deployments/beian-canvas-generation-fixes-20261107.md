# 2026-11-07 视频生成边界修复

## 变更范围

- 对照节点与自动保存遵循真实 operations 白名单；内部 `video_superresolve` 类型持久化为 `video`。
- 自动超分遇到源视频已达到目标清晰度时保留原生成视频；独立超分仍提示源视频已达到所选清晰度。
- 重试保留保存的超分目标；仅真正运行中的任务禁止重复提交。
- 历史参考音频在已授权范围内补探测并回填时长，无法读取时在创建付费任务前拒绝。
- 相比 `20261107-canvas-first-generation` 线上源清单，只有 10 个目标源文件变化；Prisma schema 无变化。

## 验证

- 28 项生成边界单测通过，8 项音频相关路由测试通过，TypeScript 检查通过。
- 真实 ffprobe/ffmpeg 验证自动超分 no-op 保留源视频，独立超分保持拒绝。
- 真实 CanvasGraph headless Chromium 回归通过：首次生成复用原节点、对照保留输入连线、失败清理后可重试并保留 720p 超分目标。
- 所有浏览器 autosave 操作经过真实服务端 operations 校验器。
- 浏览器、provider 与 worker 测试均使用 mock 或本地临时媒体，未创建真实付费生成任务。

## 发布

- 基础镜像：`norivideo:release-20261107-canvas-first-generation`。
- 候选镜像：`norivideo:release-20261107-canvas-generation-fixes`。
- 源指纹：`87633381dd1f96bf1c123a1a3e19f4ca912e4d01f1c7e77a74f7d8f087784259`。
- 源包 SHA256：`636802bef7a446a8ac197fde6df2a2884e9d0597a819c6a8e9683f40b8ecf396`。
- 制品 SHA256：`dc123472b1378a6b5775cd59ac2db212a76ccd17ed9311ab439b49628bde6b78`。
- 镜像 ID：`sha256:e6af79a989f6a9a9f373ae7e83eaa55a798bbaf01f4beaa501fa77db58c3d4da`。
- 发布包排除服务密钥配置、软著材料及三个禁止修改的副本文件。
- 构建依赖沿用已验证的 Tailwind `4.1.13` 本地缓存，SHA256：`f2a08264aea8f9029f8cfc85665bf84c542023cecad8fa95190197f759c6704c`。
- 服务器使用 `--network none` 构建；切换前备份业务数据库及受保护配置，校验 schema diff 与 queued/processing 任务数。
- 仅重建 app/admin，自动健康检查与失败回滚沿用部署脚本。
- 初次切换检测到活动生成任务，未重启线上服务；等待队列归零后安全切换，没有取消或强制中断生成任务。
- 线上 app/admin 均为候选镜像且 healthy，schema diff 无变更，billing=ENFORCE、test-mode=OFF。
- TOS 守卫及上传、读取、签名读取、删除探针通过，登录页与未授权 API 检查通过。
- 受保护配置与备份逐字节一致，业务数据库未覆盖；发布后活动生成任务为 0，启动日志未发现所列致命错误。

## 回滚

- 重新将 `norivideo:release-20261107-canvas-first-generation` 标记为 `norivideo:latest`，仅重建 app/admin。
- 无数据库变更，无需数据回退。
