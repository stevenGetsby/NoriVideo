# 2026-11-07 参考音频时长与视频关键帧修复

## 变更范围

- 参考音频时长探测先读取容器和流的 duration；两者均缺失但媒体可解码时，用真实 ffmpeg 解码读取 `out_time_us` 恢复时长。
- 损坏或无法解码的音频仍返回未知时长，并在创建付费任务前拒绝，未放宽 `requireKnownAudioDuration` 校验。
- 视频关键帧连线持久化为服务端允许的 `REF`，关键帧语义保留在目标节点的 `videoFrameParameters.videoFrameCapture`。
- 恢复故事版和多图生成前清除旧 `generation.assetId/taskId` 的行为。
- 相比 `20261107-canvas-generation-fixes` 线上源清单，仅 `src/lib/media/duration-probe.ts` 与 `src/features/canvas/CanvasGraph.tsx` 两个源文件变化；Prisma schema 无变化。

## 验证

- 画布与媒体单测：84 个文件、499 项全部通过。
- 真实 ffmpeg 生成的无 Xing MP3 在 pipe 输入下先确认 `format.duration=N/A`，修复后可恢复约 7.49 秒；正常 WAV 与损坏媒体边界通过。
- 共享生成路由真实执行时长探测、metadata 回填与 referenceSummary；损坏音频在 `submitTask` 和素材创建前返回 400。
- 真实 CanvasGraph headless Chromium 回归通过：首次生成复用原节点、对照保留输入连线、失败清理后可重试、抽帧节点与 `REF` 连线通过真实 document 与 operations 校验器。
- 线上两个失败项目的 10 条历史音频已用同一算法做只读验证，全部恢复时长（2.011–8.882 秒），未修改 metadata、未提交付费任务。
- ESLint 与 TypeScript 检查通过。
- 全套 toolbox 路由仍有两个既有蒙版用例失败，与本次音频/画布修改无关。
- 构建与运行验证均使用本地生成媒体或只读生产对象，未创建真实付费生成任务。

## 发布

- 基础镜像：`norivideo:release-20261107-canvas-generation-fixes`。
- 候选镜像：`norivideo:release-20261107-canvas-audio-duration`。
- 源指纹：`05f1ddfdcb98c5c02b9c839ecbc10778ede1d8b9eb4abb41a2f25b95acbb7b34`。
- 源包 SHA256：`0dacef1b36562ded99b168c5fa95ce338bd3dd825b764a921d9e49f8554fd9cc`。
- 制品 SHA256：`9287afa66c6ed60613690954bdd85246d2cc23202f6629b3cfdcf6edb41a4ab3`。
- 镜像 ID：`sha256:3127c7b245940b27222a46b0e6b537202a1643fb1f1343764a6684084728aa31`。
- 发布包排除服务密钥配置、软著材料及三个禁止修改的副本文件。
- 构建依赖沿用已验证的 Tailwind `4.1.13` 本地缓存，SHA256：`f2a08264aea8f9029f8cfc85665bf84c542023cecad8fa95190197f759c6704c`。
- 服务器使用 `--network none` 构建；候选镜像校验源指纹、amd64、Prisma client、对照/超分/重试标记以及真实音频解码回退标记。
- 切换前业务数据库活动生成任务为 0；备份业务数据库与受保护配置，schema diff 为空，未执行 `prisma db push`，未恢复或覆盖服务器现有业务数据。
- 仅重建 app/admin，自动健康检查与失败回滚沿用部署脚本。
- 线上 app/admin 均为候选镜像且 healthy；billing=ENFORCE、test-mode=OFF。
- 受保护配置文件与备份逐字节一致；数据库备份 19,879,062 字节。
- 切换后完成的健康检查、TOS 守卫及上传/读取/签名读取/删除探针通过。

## 回滚

- 重新将 `norivideo:release-20261107-canvas-generation-fixes` 标记为 `norivideo:latest`，仅重建 app/admin。
- 无数据库变更，无需数据回退；切换前备份保留在 `/opt/norivideo/backups/20261107-canvas-audio-duration/`。
