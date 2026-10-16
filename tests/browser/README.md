# 浏览器回归

## 登录首页设计

```sh
node scripts/auth-home-preview.mjs --serve
node tests/browser/auth-home.browser.mjs
```

预览默认只绑定 `127.0.0.1:4318`，可通过 `NORI_AUTH_PREVIEW_PORT` 指定端口。
它渲染真实登录页和样式，但认证是独立的本地模拟，不连接业务数据库或
真实登录接口，请勿在预览中使用真实账号密码。生产页面仍使用 NextAuth。

回归覆盖 11 种视口、英文布局、密码显示与大写锁定、指南模态焦点/关闭、
必填/纯空格校验、网络/限流/服务故障、重复提交及原有角色跳转。
截图与结果保存在忽略的 `test-results/auth-redesign/`。图片来源见
`public/auth/ASSET-CREDITS.md`，没有复用生产项目的私有素材。

## 项目与作品层级

当前业务层级为“项目 → 作品 → 剧集 / 资产 / 画布”。
`project-hierarchy.browser.mjs` 使用真实首页、作品编辑、画布导航组件以及
实际应用 CSS，所有接口均为本地模拟，覆盖项目/作品创建关联、移动、回收站、
参与人员编辑权限以及小屏边界。旧数据库/API 命名为兼容历史数据保留。

可通过 `NORI_BROWSER_PREBUILT_DIR` 指定预构建的组件包，
`NORI_BROWSER_GLOBAL_CSS_PATH` 指定实际应用的已编译全局 CSS；
不需要连接生产服务。截图存于忽略的 `test-results/project-hierarchy/`。

```sh
NORI_BROWSER_TOOLS_DIR=/path/to/browser-tools node tests/browser/project-hierarchy.browser.mjs
```

### 搜索、分页和底部菜单边界

`project-corner-cases.browser.mjs` 使用相同真实组件和预构建包，验证搜索不能
影响移动目标与新建链接、底部菜单自动翻转、键盘焦点、101 个作品分页、
后页失败/延迟及重试。所有接口为本地模拟，不提交真实生成或生产写入。

```sh
NORI_BROWSER_TOOLS_DIR=/path/to/browser-tools node tests/browser/project-corner-cases.browser.mjs
```

截图保存在忽略的 `test-results/project-corner-cases/`。

## 3D 导演台节点

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

## 画布交互、小屏与每日不限量回归

`canvas-ui-regression.browser.mjs` 使用真实画布、生成面板和账号管理组件，
模拟本地 API（不写生产数据、不调用付费生成），覆盖 1024×600、1280×720、
1366×768、1920×1080，包括 @ 选择/键盘关闭、参数弹层、默认声音、
视频结果回写及播放、连续右键与拖动后右键、展开编辑器和上限设为 0。

先生成一段纯色测试视频，再运行：

```sh
mkdir -p test-results/canvas-ui-regression
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i color=c=steelblue:s=320x180:d=2 \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart \
  test-results/canvas-ui-regression/sample.mp4
NORI_BROWSER_TOOLS_DIR=/path/to/browser-tools node tests/browser/canvas-ui-regression.browser.mjs
```

截图保存至 `test-results/canvas-ui-regression/`；浏览器通过视口边界、按钮点击、
视频 readyState/播放状态和限额提示断言，而不是仅检查源码字符串。

同时覆盖子账号个人余额为 0、共享钱包有余额的生成入口：`unlimited` 可生成、
上限 0 禁止生成、共享钱包耗尽仍禁止生成；验证旧余额响应不能覆盖新额度、
切换账号时不能沿用前一个钱包，以及弱网下重叠读取不会一直停在“核对额度中”。
这些场景使用真实余额 hook 和画布按钮，API 仍为本地模拟，不发起付费生成。

## 项目操作、批量上传与资产子目录

`project-assets-management.browser.mjs` 使用真实项目列表、项目头部、项目编辑
弹窗、资产库及批量上传组件，模拟本地 API：

```sh
NORI_BROWSER_TOOLS_DIR=/path/to/browser-tools node tests/browser/project-assets-management.browser.mjs
```

覆盖管理员编辑/重命名/删除与子账号限制、项目名称及时刷新、部分保存失败、
角色后上传场景、单张失败继续上传及仅重试失败项、100 文件列表的小屏边界、
旧目录请求隔离、错误角色记录不阻断场景目录、HTTP/IP 下无 `randomUUID` 的兼容。
视口包含 1024×600、768×480 和 390×700。需先通过 TOS 守卫并启动本地工作台
读取实际全局样式；测试自身不发起生产写入或上游生成。
