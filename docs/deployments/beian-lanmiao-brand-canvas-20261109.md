# 2026-11-09 LanmiaoTV 品牌统一与画布细节调整

## 变更范围

- 画布返回按钮并入顶部面包屑，固定返回“我的项目”；作品面包屑继续使用拆分的 `pathname + query` 链接。
- 侧栏折叠时显示边缘展开条，画布工具栏和添加面板按展开/折叠状态自动避让。
- 生成器引用素材改为 64px 缩略图在上、11px 名称在下的 LibTV 式标签；视频缩略图不再覆盖名称。
- `WorkCover` 默认封面重设计：LanmiaoTV 品牌标识、场景卡片、时间轴、故事文案和版本/规格标签分层显示。
- 登录、注册、工作台、项目管理、平台管理、Agent、导出文件名与创建作品档位等用户可见文案统一为 `LanmiaoTV`；内部 `Nori1.0` 数据标识和 CSS 类名保持不变。

## 验证

- 聚焦单元测试 42 条全部通过：品牌、项目封面、创建作品档位、作品创建、创作配置。
- 项目层级浏览器测试通过：桌面/移动创建作品、封面替换失败重试、项目参与权限、作品标题栏、画布与空白画布父级导航。
- 完整画布浏览器回归通过：六种视口、引用标签布局、框选、滚轮缩放、中键平移、音频提取、关键帧、参数、播放与弹窗边界。
- 修改文件 ESLint 通过，`git diff --check` 通过。
- `tsc --noEmit` 仅报告未纳入发布的 Finder 重复文件，正式源码无新增类型错误。

## 发布

- 基础镜像：`norivideo:release-20261108-nav-card-redesign`。
- 候选镜像：`norivideo:release-20261109-lanmiao-brand-canvas`。
- 源指纹：`fc943268577250b5adba28cc424687a34979ada829e1ea8a01513c93b3e11384`。
- 源包 SHA256：`7080508a12e1ef86cd25584a8f46e3bc2ceb325f6b819bf5a51922c4d5bb9f91`。
- 制品 SHA256：`ee20ef7e8d4889a9b240e5130a2d270b8df7ca7e046c99196a9df45b92d345d0`。
- 镜像 ID：`sha256:c1bcdbd4bb489120920bc4e4cb899185aed86ec4dfafa0fdae13b91b23aaf633`。
- 发布包排除服务密钥配置、软著材料、`.runtime/`、测试输出及全部 Finder 副本。
- 服务器使用 `--network none` 构建；schema diff 为空，未执行 `prisma db push`。
- 切换后 app/admin 均 healthy、镜像与源码指纹一致、billing=ENFORCE、test-mode=OFF、TOS 上传/读/签名读/删除探针通过、受保护配置文件与备份逐字节一致。
- 登录页 200、管理台 200、未认证 `/api/tasks` 401，登录页已输出 `LanmiaoTV`。

## 回滚

- 重新将 `norivideo:release-20261108-nav-card-redesign` 标记为 `norivideo:latest`，仅重建 app/admin。
- 数据库无变更；切换前备份位于 `/opt/norivideo/backups/20261109-lanmiao-brand-canvas/`。
