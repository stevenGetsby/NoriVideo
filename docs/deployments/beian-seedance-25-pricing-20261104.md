# 2026-11-04 Seedance 2.5 官方计价发布

## 版本

- 候选镜像：`norivideo:release-20261104-seedance-25-pricing`（`2c1a2424d8cf…`）
- 源指纹：`02a5e33db4de2e0a6cdcf3c30e82998667a0d0e32cb1047ad4964b6cd32e7d8b`
- 提交：`12f0658 fix: bill Seedance 2.5 by official token pricing`
- 上一版本：`release-20261103-video-timeline`（`dfbbba2b37a0…`）
- 纯代码发布，Prisma schema 未变（`schemaChanged: false`）

## 变更范围

- `doubao-seedance-2-5-260628` 与业务别名 `norivideo2.5` 改为与 Seedance 2.0 相同的 token 计价：
  70 元/百万 token（480p/720p，无视频输入）、42（含视频输入）、77/46（1080p）。
- `calcVideo` / `calcVideoByTokens` 按分辨率取价，并在结算前把小数时长吸附到模型整数时长区间。
- 能力表放开 2.5 的 1080p（筷子兼容接口 v1.2），时长 4–30s / -1 不变。
- 新增与调整单测：`seedance-25-pricing`、`nori-kuaizi-pricing`、`billing/service`、`seedance-business-tiers`。

## 发布修正

首次切换（`8f59477316b6`）只更新了 `.next/dist/public/messages`，而价格与能力表在运行时从
`/app/standards` 读取，容器内仍是旧表。本次把 `standards/` 纳入产物归档和 `Artifact.Dockerfile`，
并在 load 阶段增加镜像内断言（70 档 + 1080p）后重新构建切换。

## 验证

- 部署守卫全过：备份、上一镜像指纹核对、产物校验、架构 amd64、schema diff 为空、无在跑任务、
  app/admin 健康、billing=ENFORCE test-mode=OFF、线上签名 200/200、受保护文件一致。
- 容器内实读：两个 modelId 的档位均为 `1080p 77/46` + `默认 70/42`，能力表分辨率均为
  `480p/720p/1080p`。
- 5s 16:9 无视频输入估算：480p ≈3.52 元、720p ≈7.56 元、1080p ≈18.85 元，贴合官方示例
  3.36 / 7.56 / 18.71。
