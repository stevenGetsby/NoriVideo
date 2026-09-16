# 3D 导演台节点浏览器回归

独立测试页使用真实 `Studio3DNode`、React Flow、项目画布 CSS，以及本地工作台已经编译的全局样式（包含 120% 界面缩放）。
只提供测试用编辑器上下文，不登录账号，不写项目数据库，不调用生成服务。

运行前确保本地工作台 `127.0.0.1:3000` 已启动；其启动必须先通过固定 TOS 守卫。
将 `playwright-core` 安装到独立临时工具目录，并设置 `NORI_BROWSER_TOOLS_DIR`：

```sh
NORI_BROWSER_TOOLS_DIR=/path/to/browser-tools node tests/browser/studio-node.browser.mjs
```

默认使用 macOS 已安装的 Chrome，可通过 `NORI_CHROME_EXECUTABLE` 指定独立测试浏览器的可执行文件。
测试包含卡片/标题拖动、文字边界、不同缩放和尺寸、旧小尺寸归一化、双击、键盘进入、工具栏隔离、缩放控制点及只读权限。
截图和结构化检测结果保存至被忽略的 `test-results/studio-node/`。

`--baseline` 仅记录当前位置和布局，便于修复前采样，不作为通过验证的依据。

## 生成节点引用素材加号

`generator-refs.browser.mjs` 渲染真实的 `CanvasGenerator`（`next-auth/react` 用本地 stub 替换，生成配置与余额接口用路由拦截返回固定数据），
验证「引用素材」行最右侧始终存在素材库加号、它是该行最后一项且靠右对齐，并按模式请求正确的素材类型与数量上限：

```sh
NORI_BROWSER_TOOLS_DIR=/path/to/browser-tools node tests/browser/generator-refs.browser.mjs
```

覆盖场景：视频大全能参考（全部类型）、图生视频（仅图片）、音频（仅音频）、图片节点带引用缩略图。
截图保存至被忽略的 `test-results/generator-refs/`。
