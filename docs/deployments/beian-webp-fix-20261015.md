# 备案机修复：登录页 WebP 主视觉资源

完成时间：2026-10-15 21:39（Asia/Shanghai）。

## 问题

登录页的 `VISUAL INSPIRATION` 图片请求为 `/auth/cinematic-landscape.webp`，但根 middleware 和 `src/middleware.ts` 的静态资源 matcher 没有排除 `.webp`，导致请求被 next-intl 重定向到 `/zh/auth/cinematic-landscape.webp`，图片返回错误页面而不是 WebP。

## 修复与发布

- 两个 middleware matcher 都加入 `.*\\.webp` 静态资源排除。
- 无数据库 schema、依赖、账号、项目或素材变更。
- 使用上一版 `norivideo:release-20261015-brand-login` 作为基底重新构建 amd64 镜像，发布标签 `norivideo:release-20261015-webp-fix`。
- 新源码指纹：`4711b8a0805590ddc609df9a9527b8aa800180802c45dde8b129a5a05e26ede0`。
- 切换前后固定 TOS 守卫及 upload/read/signed-read/delete 探测通过。
- 配置文件、业务数据库备份、旧回滚镜像保留；仅重建 app/admin，MySQL/Redis 未重建。
- BILLING_MODE=ENFORCE，测试模式关闭。

## 线上验证

- `https://lanmiaoai.com/auth/cinematic-landscape.webp?v=4` 现在 HTTP 200，`Content-Type: image/webp`，实际文件 1600×900、388668 bytes。
- 工作台和管理台均 healthy，重启 0、OOM false。
- 线上多视口项目/素材/管理台验收通过。
- 5 个已有视频正常加载、HTTP 206、无媒体错误且实际播放通过。
- 登录页浏览器和管理台未提交真实登录请求；未触发付费生成。

## 入口

- `https://lanmiaoai.com/zh/auth/signin`
- `https://14.103.65.61:8080/zh/admin/signin`

