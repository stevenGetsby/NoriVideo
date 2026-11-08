# 2026-11-08 面包屑导航修复与项目块重设计

## 变更范围

- `src/lib/projects/navigation.ts` 新增 `projectLinkProps(projectId)` 返回 `{ pathname: '/projects', query: { work_id } }`。
- `src/features/canvas/components/CanvasChrome.tsx` 与 `src/components/frameos/FosProjectHeader.tsx` 中所有以 `href={{ pathname: parentHref }}` 把整串 `/projects?work_id=...` 塞入 pathname 的链接改用 `projectLinkProps`，next-intl 不再把整个查询串 URL-encode 进 pathname 造成 `/zh/projects%3Fwork_id=...` 的 404。
- `tests/unit/projects/navigation.test.ts` 锁住 `projectHref`（保留旧 query-string 形态）与 `projectLinkProps`（拆 pathname + query）的契约。
- `src/features/canvas/canvas.css`：`.nori-canvas-parent-back` 从 `top:50%; left:44px; transform:translateY(-50%); border-radius:50%` 改为 `top:20px; left:20px; border-radius:12px`，720px 断点同步收敛为 `top/left:14px; border-radius:10px`；返回我的项目的功能不变。
- `src/styles/frameos-replica.css` 项目块重设计：
  - 卡片去掉固定 342px 高度与强投影，border 改更浅的 rgba(255,255,255,.06)，radius 16→14px，hover 位移 -4px→-2px。
  - 封面高度 170→156px；edition badge 去掉边框改 6px 圆角小胶囊。
  - 标题 17→16px、行高 1.3→1.4；tags 改 4px 圆角无边框 11px 字号、icon 11px。
  - Footer 分隔线更淡、字号 12→11px。
  - "进入画布"按钮默认 `opacity: 0`，hover/focus-within 才显示，hover 改紫色调。
  - "..." 菜单按钮默认 `opacity: 0`，hover/focus-within 才显示，尺寸 32→28px。

## 验证

- `tsc --noEmit` 源码零错误（仅 `* 2.`/`* 3.` 副本文件报错，与本次修改无关）。
- ESLint 三个修改文件 0 警告。
- 新增 `tests/unit/projects/navigation.test.ts` 2 个用例全部通过。
- Headless Chromium 截图 `test-results/works-card-redesign/{default,hover}.png`：默认态封面/edition/标题/tags/date 紧凑干净；hover 时右上 `•••` 菜单与右下"进入画布"浮现且不重叠。
- 服务器构建 `npm run build` 成功；候选镜像 grep 校验 `projectLinkProps`、`is-node-dragging`、`audio_extract`、`OPENLUX_IMAGE_PRICING_UNAVAILABLE`、HuiMeng/OpenLux 标准、Prisma client、projectLeader 与 personalOwnerId 字段。
- 切换前 schema diff 为空，无需 `prisma db push`。
- 切换前活动生成任务为 0；备份业务数据库与受保护配置。
- 切换后 app/admin 均 healthy、billing=ENFORCE、test-mode=OFF、TOS 守卫与上传/读/签名读/删除探针通过、受保护配置文件与备份逐字节一致。

## 发布

- 基础镜像：`norivideo:release-20261108-draft-polling-fix`。
- 候选镜像：`norivideo:release-20261108-nav-card-redesign`。
- 源指纹：`1f70ca17aeb74cb6d85c49c7cadfd3230b87e1f1a54bcc81ab622603002cf6fc`。
- 源包 SHA256：`45f233c13b29282f76c45a3d91224ad2354719f5e5eaef67a5ad6f1757981dc0`。
- 制品 SHA256：`78e16bec980fce0eca893f6dd66e8302617b792ae024e158dce66185a3283950`。
- 镜像 ID：`sha256:06691b6befa4ed0604cbaaf2dd536e375fd60c568ff40860051610d1c8f4be75`。
- 发布包排除服务密钥配置、软著材料、`.runtime/`、`docs/测试输出/` 及全部 `* 2.*`/`* 3.*`/`* 4.*` Finder 副本。
- 构建依赖沿用已验证的 Tailwind `4.1.13` 本地缓存。
- 服务器使用 `--network none` 构建；schema diff 为空，跳过 `prisma db push`。
- 仅重建 app/admin，自动健康检查与失败回滚沿用部署脚本。

## 回滚

- 重新将 `norivideo:release-20261108-draft-polling-fix` 标记为 `norivideo:latest`，仅重建 app/admin。
- 数据库无变更；切换前备份位于 `/opt/norivideo/backups/20261108-nav-card-redesign/`。
