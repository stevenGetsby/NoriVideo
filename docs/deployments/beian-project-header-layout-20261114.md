# 2026-11-14 批次 1b：工作台标题与画布提示布局

## 变更范围

- 功能提交：`aa4e372 fix: keep project headers compact and story tips visible`。
- 工作台头部标题保持单行、过长省略并保留悬停全名；窄宽度下次要操作进入「更多操作」。
- 影游章节首次提示卡避开右上角画布工具；收起侧边菜单后移除项目标题旧留白。

## 本地验证

- 项目层级真实组件浏览器回归通过 7 个场景，含 1024/390 宽度与空画布导航。
- 本批无 schema 变更；未执行付费生成。

## 测试机

- 部署：2026-11-14，验收复核至 22:34（UTC+8），`45.76.215.9`。
- 部署源码严格来自 `dc528b4` 的 `git archive`，包含已独立提交的 1b/1c；共 2739 个 tracked paths，无额外 worktree 或测试产物。
- 源码包 SHA-256：`dc6cf5d2d53997cdd32fd19059e3d6e3de847b228bb9900298a878838bc0eb35`。
- `build-done` 存在；`web`、`worker`、`watchdog`、`board` 均为 active。
- 验收脚本：`test-results/ux-audit/batch-1b-1c/acceptance.mjs`；结果：`results.json`。
- 通过：Chromium 1024/1100/1280/1440 下短标题与长标题共 8 组；单行省略、悬停全名、按钮不相交，头部高度均为 55 CSS px。
- 通过：Chromium 1024/1280/1440/1920 下影游首次提示卡与画布工具不相交。
- 通过：1280 宽度收起侧边菜单后旧标题留白消失。
- 通过：WebKit 1024 下工作台加载完成，标题与头部可见，头部高度不超过 68 CSS px；截图不是登录加载页。
- 通用重叠扫描的 `.work-cover-orbit` 命中均来自封面 `aria-hidden` 装饰圆环的矩形包围盒，并非文字或交互遮挡。排除该装饰后扫描无命中；未因此改变封面设计。
- 截图：`test-results/ux-audit/batch-1b-1c/header-*.png`、`story-tips-*.png`、`webkit-header-1024.png`；重叠扫描截图位于 `test-results/ux-audit/overlap/`。

## 生产

尚未部署；等待用户明确放行。
