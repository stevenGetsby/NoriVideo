# 画布文本编辑、日间模式、对照提示词与线上 Bug 修复方案（给 kimi3.1 的实现文档）

日期：2026-11-14　角色：设计 → 实现（kimi3.1）。本文自成一体，照做即可，不需要再问用户。
本文和代码对不上时，按「执行规则 R2」处理。

## 全部功能改动一览

| 编号 | 用户反馈 | 改完后用户看到什么 | 章节 | 批次 |
|---|---|---|---|---|
| B1 | 自带浏览器里按住拖选框，选框位置有偏差（Windows 截图里选框比鼠标位置偏右下约 1.2 倍） | 任何浏览器里选框都贴着鼠标；旧内核出现提示条建议换 Chrome/Edge | §1 | A |
| B2 | 右键「添加节点」后，选择框总在最左侧出现，不消失，必须真的添加节点才会消失 | 选择框就出现在鼠标右键的位置；点空白、按 Esc、滚轮、拖动画布都会关闭 | §2 | A |
| B3 | 素材选项框滚轮滑不下去 | 素材选择框的列表在所有浏览器里都能滚到底 | §3 | A |
| B4 | 创建账号时，密码框右侧的小眼睛会消失 | 所有密码框右侧始终有一个「显示/隐藏密码」按钮，失焦也不消失 | §4 | A |
| B5 | 卡顿 | 见性能方案；本文只补 3 处小改动 | §5 | A |
| E1 | 回车删除文本框，反复弹出 | 删掉的文本框不会再冒出来；回车不会误触发删除；回车可进入编辑 | §6 | B |
| E4 | 复制文本框内容后，要双击才能在已选中的文本框里操作，一直跳来跳去 | 选中的文本框单击即可编辑；⌘V 直接粘贴进正在选中的文本框；不再弹出生成面板打断 | §7 | B |
| E2 | 文本编辑要有重点标注（加粗或背景色） | 选中文字后出现小工具条：加粗、4 种高亮、清除；快捷键 ⌘B、⌘⇧H | §8 | C |
| E5 | 观看生成视频时，希望有对照提示词，方便看镜头、机位效果并修改提示词 | 视频审阅弹窗右侧新增「提示词」页：看到该版本的提示词，可编辑、复制、保存、按新提示词重新生成 | §9 | D |
| E3 | 日间模式，现在太黑 | 账号设置 → 外观，和画布 ☰ 菜单里都能切「深色 / 日间 / 跟随系统」；深色外观一像素不变 | §10 | E |

## 执行规则（照此自主完成）

**沿用** `2026-11-14-lanmiaotv-ux-plan.md` 的 R2–R5、R7（冲突怎么判断、别人的未提交改动、测试机和测试账号、部署测试机、提交与部署记录）和 `2026-11-14-performance-traffic-login-plan.md` 的 R6（上生产）、R8（只在这几种时候联系用户）。下面只写新增的。

**R1 顺序**：批次 A → B → C → D → E。每批：改代码 → 跑本批测试（§11）→ 部署测试机 → 按 §11 验收 → 提交并写部署记录 → 通知用户可以上生产。批次 E 最大、风险最高，放最后；A、B 是线上 bug，最快上线。

**R2 本文没写到的细节，按这个优先级选**
1. 不丢数据、不改扣费；
2. 旧画布、旧节点数据照常能读能打开（新增字段一律可选）；
3. 除本文写明的变化外，用户看到的行为不变；
4. 改动最小，沿用相邻代码的写法。

**R3 和另外两个文档的关系**
- 性能方案（`2026-11-14-performance-traffic-login-plan.md`）正在由同一个人实现。它改 `CanvasGraph.tsx` 的 C3/C4/C5/C6 和素材库/素材选择器的分页（§3.7）。本文也改这两个文件。**先拉最新代码再改，改完立刻提交，减少冲突**；`MaterialPickerDialog.tsx` 里本文只动 `maxHeight` 一行（B3），分页那边的改动不要覆盖。
- UX 方案（`2026-11-14-lanmiaotv-ux-plan.md`）改团队管理、账号表单。B4 会碰 `FosAccountManagementParts.tsx` 的密码输入，只替换那一个 `<input>`。
- 登录页重设计（性能方案 §5）里登录页的密码框已经有小眼睛，B4 只抽成共用组件时顺手复用，不改它的视觉。

**R4 兼容边界**：浏览器支持范围 = Chrome/Edge ≥ 111 正常使用；Chrome 108–110 可用但显示提示条；更旧的内核（包括 360/QQ 老「极速模式」）显示提示条，不保证所有功能。不要为了 IE 或 Chrome < 100 加任何 polyfill。

**R5 测试**
- 单元测试：沿用仓库现有的 vitest 目录结构，新文件放在被测文件旁的 `__tests__` 或 `tests/unit/...`（先 `ls tests` 看现有习惯再放）。
- 浏览器测试：只用无头模式（headless），不开可见窗口、不启动重型 dev server。沿用 `tests/browser/` 里现有 `.browser.mjs` 的写法（`playwright-core` 或 `puppeteer-core`，看同目录已有脚本）。
- Mac 磁盘满会导致 `node_modules` 被「evict」，`tsc` 静默退出 0：用 `npx tsc --noEmit; echo $?` 之后再 `grep -c` 一下输出，或者读一个依赖文件让它重新下载。详见记忆文档 `reference-dataless-files` 的做法：从镜像目录跑测试。
- 测试机密码只能从环境变量 `SSHPASS` 读取，不写进文件、日志、提交。

**R6 视觉改动的验收截图**：每个视觉改动按 §11.3 用无头 Chrome 截图，前后对比放在 `test-results/canvas-editing-theme/` 下（不提交），在部署记录里写路径和结论。

**R9 提交粒度**：每个编号（B1、B2…E5）至少一个提交，提交信息 `fix(canvas): …` / `feat(canvas): …`，正文写「为什么」。日间模式（E3）按 §10.9 拆成 6 个提交。

**R10 遇到本文没覆盖的情况**：先按 R2 选；实在要停，写一份「卡点说明」（现象、已试过的、两个候选方案和你选哪个）放进部署记录，继续做不依赖它的部分，不要停下来等。

---

## 0. 约定

- 全部新增 UI 文案都是简体中文，下面写明的文案原样使用。
- 全局界面缩放：`.fos-app { zoom: var(--nori-interface-scale, 1.2) }`（`src/styles/frameos-replica.css:78-94`）。画布里所有坐标换算都要考虑这个缩放，见 §1。
- 画布核心文件：
  - `src/features/canvas/CanvasGraph.tsx`（约 4,500 行，下面的行号会随别人的提交漂移，**始终用 grep 锚点定位**）；
  - `src/features/canvas/nodes/CreativeNode.tsx`（`TextContent` 在 `:95`）；
  - `src/features/canvas/components/CanvasMenus.tsx`、`CanvasToolRail.tsx`、`CanvasMediaPreviewDialog.tsx`、`VideoPreviewWorkspace.tsx`；
  - 样式 `src/features/canvas/canvas.css`（7,791 行）。
- 不要碰名字带 ` 2`、` 3`、` 4` 的 Finder 重复文件。
- 不新增数据库表和列。新增的节点字段只放在节点 `data` 的 JSON 里，且都是可选字段。
- 本文所有批次**不改表结构**。

## 1. B1 旧内核浏览器里选框偏差（批次 A）

### 1.1 根因
整个应用壳是 `.fos-app { zoom: 1.2 }`。Chrome ≥ 128 实现了标准化的 CSS zoom：`getBoundingClientRect()`、`clientX/clientY` 都在同一个坐标系里，`wrapperLayoutPoint`（`CanvasGraph.tsx`，grep `function wrapperLayoutPoint`）用「BCR 宽度 ÷ clientWidth」算缩放，在新内核里是对的。
旧内核（Chrome < 128，包括 360/QQ「极速模式」、旧版 Edge、国产浏览器的 Chromium 10x 内核）用的是旧的非标准 zoom：`getBoundingClientRect()` 返回的是「除掉 zoom 之后」的值，`clientX/clientY` 却是物理像素。两边不一致，`wrapperLayoutPoint` 里 BCR÷clientWidth 算出来是 1，于是得到 `clientX - bounds.left`（物理像素减去缩小后的值），选框相对鼠标放大约 1.2 倍。用户截图里选框比鼠标偏右下，正好是这个现象。
React Flow 自己的拖拽、平移也用 `getBoundingClientRect + clientX`，在旧内核里同样会偏，所以**不要去逐个修坐标换算**，而是在旧内核里关掉 zoom。

### 1.2 方案：旧内核自动按 100% 显示 + 提示条
1. **检测**（越早越好，必须在首次绘制前）：在 `src/app/[locale]/layout.tsx` 里加一段 `next/script` 的内联脚本，`strategy="beforeInteractive"`，`id="nori-env-flags"`：
   ```js
   (function () {
     try {
       var m = /Chrome\/(\d+)/.exec(navigator.userAgent);
       var v = m ? +m[1] : 0;
       var d = document.documentElement;
       if (v && v < 128 && !('currentCSSZoom' in Element.prototype)) d.setAttribute('data-zoom-mode', 'legacy');
       if (v && v < 128) d.setAttribute('data-engine-version', String(v));
       if (/Trident\/|MSIE /.test(navigator.userAgent)) d.setAttribute('data-engine-version', '0');
     } catch (e) {}
   })();
   ```
   - Firefox 和 Safari（UA 里没有 `Chrome/`）不受影响，行为不变。
   - `<html lang={locale}>` 加 `suppressHydrationWarning`（脚本在 hydrate 前改了 html 的属性，批次 E 还要用同一个属性位置）。
   - 先 `grep -rn "Content-Security-Policy" next.config.* src/middleware.* deploy 2>/dev/null` 看有没有 CSP；有的话照它的 nonce 写法处理，没有就按上面做。
2. **样式**（`src/app/globals.css`，紧跟在第一个 `:root { … }` 之后，`--nori-interface-*` 三行在 `:13-15`）：
   ```css
   html[data-zoom-mode="legacy"] {
     --nori-interface-scale: 1;
     --nori-interface-viewport-width: 100vw;
     --nori-interface-viewport-height: 100vh;
   }
   ```
3. **其它写死 1.2 的地方**：
   - `grep -rn "zoom:" src --include="*.css" --include="*.tsx"`：每一处 `zoom:` 要么已经用 `var(--nori-interface-scale…)`，要么是后台页面自己的缩放（`frameos-replica.css:733` 附近的 admin）。后台 admin 的 zoom 同样在 `html[data-zoom-mode="legacy"]` 下写 `zoom: 1` 覆盖；
   - `grep -rn "interfaceScale\|nori-interface-scale\|1\.2" src/features/canvas src/components --include="*.tsx" --include="*.ts" | grep -i "scale\|zoom"`：凡是在 TS 里写死 1.2 的（例如 `CanvasGenerator.tsx:1263` 的 `interfaceScale`），改成读 `getComputedStyle(document.documentElement).getPropertyValue('--nori-interface-scale')` 解析出的数，读不到时用 1.2。
4. **提示条**：新建 `src/components/OldBrowserNotice.tsx`（client 组件），挂在 `src/app/[locale]/providers.tsx` 里。
   - 读 `document.documentElement.dataset.engineVersion`，没有就不渲染；
   - 版本 `0`（IE/Trident）：文案「当前浏览器无法使用画布。请改用最新版 Chrome 或 Edge。」，不可关闭；
   - 版本 1–127：文案「当前浏览器内核较旧（Chrome {v}），已自动按 100% 比例显示，以保证画布框选和拖拽准确。升级到最新版 Chrome 或 Edge 可获得完整体验；如果使用 360、QQ 等浏览器，请切换到「极速模式」并更新内核。」，右侧按钮「我知道了」，点了把 `nori-engine-notice-dismissed-{v}` 写进 `localStorage`，同一版本不再提示；
   - 样式：固定在页面底部居中，`bottom: 16px`，`max-width: min(640px, calc(100vw - 32px))`，圆角 12px，背景 `var(--fos-bg-4)`，文字 `var(--fos-text-2)`，13px，`z-index: 100300`（高于 `.fos-overlay` 的 100100）。写 CSS 用 `html[data-zoom-mode="legacy"]` 之外的普通写法，不要用 `dvh`。

### 1.3 验证（先复现，再修复）
1. **复现**（修复前先做，作为基线）：
   ```bash
   npx @puppeteer/browsers install chrome@127 --path test-results/browsers
   ```
   装不上 `chrome@127` 就用 `chrome@127.0.6533.119`。用这个 Chrome for Testing 127（`executablePath` 指向它，仍然 headless）打开一个本机画布页（沿用 `tests/browser/canvas-pan-performance.browser.mjs` 的种子账号和启动写法），在空白处 `page.mouse.move(300,300); down(); move(700,500); up()`，读选框 `.nori-canvas-marquee`（grep `marqueeRect` 对应的 className 确认）的 BCR。**修复前**应该看到选框右下角比 (700,500) 明显偏大（约 1.2 倍）。
   - **如果修复前没有复现偏差**：说明根因判断有误。保留 §1.2 的检测、提示条、legacy 样式（无害），记录实测数据，然后在最终回复里请用户提供浏览器「关于」页面的版本号和 Windows 显示缩放比例（这是 R8 允许联系用户的情况），不要继续猜。
2. **修复后**：同一个脚本再跑一次，断言选框左上角、右下角与鼠标起止点各相差 ≤ 2px；再用最新版 Chrome 跑一次，同样断言（回归保护）。再断言 127 下 `document.documentElement.dataset.zoomMode === 'legacy'`、最新版里没有这个属性。
3. 把这个测试存为 `tests/browser/canvas-marquee-legacy-zoom.browser.mjs`，Chrome 127 的路径通过环境变量 `CHROME_127_PATH` 传入，没设置时跳过 127 那部分。
4. 单元测试：给内联脚本的检测逻辑抽一个纯函数 `detectEngineFlags(userAgent, hasCurrentCSSZoom)` 放进 `src/lib/browser-engine.ts`，脚本内容由这个函数 `toString()` 之外的方式写死也可以，但测试要覆盖：Chrome 127 / 128 / 109 UA、Edge 120 UA、Firefox UA、Safari UA、IE11 UA 的结果。

## 2. B2 右键「添加节点」位置不对且不消失（批次 A）

### 2.1 现状
- 画布空白处右键 → `handlePaneContextMenu`（grep `const handlePaneContextMenu`）弹出 `CanvasContextMenu`（`CanvasMenus.tsx`，pane 菜单项在 `:88-99`）。
- 点「添加节点」→ `CanvasGraph.tsx` 的右键菜单动作处理（grep `action === 'add-node'`）里：`pendingInsertPositionRef.current = menu.flowPosition`，然后 `setAddOpen(true)`。这会打开**左侧工具栏旁**的 `CanvasAddPanel`（`CanvasToolRail.tsx:46`），所以无论在哪里右键，选择框都在最左边。
- 这个面板只在 `handlePaneClick` 里 `setAddOpen(false)`；点节点、点画布 Chrome、按其它键都关不掉，所以用户觉得「不会消失，必须真的添加一个节点」。

插入位置本身（`pendingInsertPositionRef`）是对的，要改的只是**选择框出现的位置和关闭方式**。

### 2.2 方案
1. **新组件** `CanvasNodeTypeMenu`，放在 `src/features/canvas/components/CanvasMenus.tsx`，参照同文件的 `CanvasWireMenu`（用 `CanvasMenuPortal` 定位，`role="menu"`，`aria-label="添加节点"`，`onPointerDown={e=>e.stopPropagation()}`）。
   ```ts
   type CanvasNodeTypeMenuProps = {
     state: { x: number; y: number; flowPosition: { x: number; y: number } }
     storyItems?: CanvasAddNodeItem[]        // 与 CanvasAddPanel 同一组
     interactionItems?: CanvasAddNodeItem[]
     onPick: (type: CanvasNodeType, interaction?: …) => void
     onUpload: () => void
   }
   ```
   - 条目和顺序与 `CanvasAddPanel` 完全一致：普通画布用 `CANVAS_ADD_NODE_ITEMS`（文本 / 图片 / 视频 / 视频超分 / 视频编辑 / 播放列表 / 3D模型 / 3D导演台 / 音频），影游画布（`storyCanvas`）用 `STORY_ADD_NODE_ITEMS` 加 `STORY_INTERACTION_ADD_ITEMS`，末尾分隔线后是一项「上传文件」。要把这两个 `Items` 的类型从 `CanvasToolRail.tsx` 里 export 出来共用，不要复制一份。
   - 禁用项（例如「音频」当前是灰的）沿用同样的 `disabled` 样式和提示。
   - 菜单标题「添加节点」，沿用 `.nori-canvas-wire-menu` 的样式类（复用即可，不新增视觉）。
2. **`CanvasGraph.tsx`**：
   - 新状态 `const [nodeTypeMenu, setNodeTypeMenu] = useState<…|null>(null)`；
   - 右键菜单 `action === 'add-node'` 分支改为：
     ```ts
     setContextMenu(null)
     setNodeTypeMenu({ ...visibleMenuPoint(menu.x, menu.y, 420), flowPosition: menu.flowPosition })
     return
     ```
     （`menu.flowPosition` 在 `handlePaneContextMenu` 里已经算好；这个分支不再打开左侧面板，也不再写 `pendingInsertPositionRef`。）
   - 渲染：和 `CanvasWireMenu` 同一个位置（grep `<CanvasWireMenu`）加 `{nodeTypeMenu ? <CanvasNodeTypeMenu … /> : null}`；`onPick` 里 `addNode(type, nodeTypeMenu.flowPosition, interaction)` 然后 `setNodeTypeMenu(null)`；`onUpload` 里 `openUploadPicker(nodeTypeMenu.flowPosition)` 然后关菜单。
   - **关闭**，下面每一条都要做：
     1. `dismissTransientUi`（grep `dismissTransientUi`，Esc 处理里已经会调）里加 `setNodeTypeMenu(null)`；
     2. `handlePaneClick`、`handleNodeClick`、`handlePaneContextMenu`、`handleNodeContextMenu`、`handleEdgeContextMenu` 里都加 `setNodeTypeMenu(null)`；
     3. `handleMoveStart`（平移、缩放开始）加 `setNodeTypeMenu(null)`；
     4. 工作区 `onPointerDownCapture`（grep `onPointerDownCapture`）里：如果目标不在 `.nori-canvas-wire-menu` 里，就 `setNodeTypeMenu(null)`；
     5. 菜单自己监听 `window` 的 `wheel` 事件（`{ passive: true }`），收到就关闭（滚轮缩放画布时菜单不能留在原地）。
3. **左侧工具栏的 `CanvasAddPanel` 也修关闭问题**（这是用户说的「不会消失」的另一半）：
   - 在 `onPointerDownCapture` 里，`addOpen`（用 ref 读，避免闭包旧值）为真且目标不在 `.nori-canvas-add-panel` 和 `.nori-canvas-tool-rail` 内时，`setAddOpen(false)`；`assetsOpen`、`helpOpen` 面板同理；
   - `handleNodeClick` 里也 `setAddOpen(false)`；
   - 面板关闭时顺手 `pendingInsertPositionRef.current = null`（用 `useEffect` 监听 `addOpen`）。
4. 只读画布（`readOnly`）：右键菜单本来就没有「添加节点」，保持。

### 2.3 验证（浏览器测试 `tests/browser/canvas-add-node-menu.browser.mjs`）
1. 在 (600,400)、(300,200)、(900,500) 三处右键 → 点「添加节点」→ 断言 `[role=menu][aria-label="添加节点"]` 的 BCR 左上角在点击点的 ±8px 内（靠近屏幕边缘时允许被 `visibleMenuPoint` 往里收），并且左侧 `.nori-canvas-add-panel` 不存在。
2. 点「文本」→ 新节点出现，节点左上角（`flowToScreenPosition` 反算）距右键点 ≤ 40px；菜单消失。
3. 再开菜单，分别用 Esc、点空白处、鼠标滚轮、拖动画布、点节点 5 种方式关闭，菜单都消失，且没有新增节点。
4. 点工具栏的「+」打开左侧面板 → 点画布空白 / 点一个节点 / 按 Esc，面板都关闭。
5. 影游画布（`storyCanvas`）里再测一遍第 1、2 步，确认菜单里有剧情节点和互动节点。

## 3. B3 素材选择框滚轮滑不下去（批次 A）

### 3.1 根因
弹窗高度全靠 `dvh`（动态视口单位，Chrome 108 才支持）。不支持的内核把整条声明丢掉：
- `MaterialPickerDialog.tsx`（grep `maxHeight: 'min(88vh`）的内联样式 `maxHeight: 'min(88vh, calc(100dvh - 32px))'` 被丢弃；
- `frameos-replica.css:1311` `.material-picker-dialog { height: min(780px, 88dvh, …); max-height: min(88vh, calc(100dvh - 32px)) }` 同样整条被丢弃；
- 弹窗没有高度上限，被内容（几百个素材）撑开；结果区 `.material-picker-results { min-h-0 flex-1 overflow-y-auto }` 没有受限的父级，永远不产生滚动条，下半部分被 `overflow-hidden` 裁掉，于是「滚轮滑不下去」。
另外 `align-items: safe center`（Chrome 115 才支持）在旧内核里同样被丢，弹窗比视口高时顶部会被裁掉。

### 3.2 方案：所有 `dvh/svh/lvh` 前面都先写一条 `vh` 版本
全仓共 26 处（17 处在 `canvas.css`、5 处 `frameos-replica.css`、2 处 `nori-auth.css`、2 处 `globals.css`，另有 `FosMaterialLibrary.tsx` 和 `MaterialPickerDialog.tsx` 各 1 处内联）。先 `grep -rnE "[0-9.)]+(dvh|svh|lvh)" src --include="*.css" --include="*.tsx" --include="*.ts"` 列全。
1. **CSS 里**：每个含 `dvh/svh/lvh` 的声明，在它**前面一行**写同属性的 `vh` 版本（旧内核丢掉后一条，新内核用后一条）：
   ```css
   .material-picker-dialog {
     width: min(1120px, calc(100vw - 32px));
     height: min(780px, 88vh, calc(100vh - 32px));
     height: min(780px, 88dvh, calc(100dvh - 32px));
     max-height: min(88vh, calc(100vh - 32px));
     max-height: min(88vh, calc(100dvh - 32px));
   }
   .material-picker-overlay {
     max-height: 100vh;
     max-height: 100dvh;
     align-items: center;
     align-items: safe center;
     justify-content: center;
     justify-content: safe center;
   }
   .material-picker-sidebar { max-height: min(190px, 28vh); max-height: min(190px, 28dvh); }
   ```
   `globals.css:73` 附近已有一条 dvh 覆盖（原来的意图应该是同样的 fallback），核对一下顺序是否正确，不对就按上面的写法改。`.material-picker-overlay` 现在的 `max-height: 100dvh; max-height: 100lvh;` 两行互相覆盖，改成 `100vh` 再 `100dvh`。
2. **内联样式里**：React 的 style 对象一个属性只能放一个值，没法写 fallback。把 `MaterialPickerDialog.tsx` 里的 `style={{ width, maxWidth, maxHeight }}` 整个删掉（宽度和高度上限都已经在 `.material-picker-dialog` 里了），`FosMaterialLibrary.tsx` 的内联 dvh 同样挪进它自己的 CSS 类里。
3. 结果区加 `overscroll-behavior: contain`（`.material-picker-results`、`.material-picker-sidebar`），避免滚到底把滚轮事件传给后面的画布。
4. 防回归的单元测试 `tests/unit/css-viewport-units.test.ts`：读取 `src/**/*.css`，逐个声明块检查，凡是含 `dvh|svh|lvh` 的声明，同一个块里**前一条声明**必须是同一个属性（带 `vh` 或普通值）；再扫 `src/**/*.tsx` 里 style 对象中的 `dvh|svh|lvh`，出现就失败。

### 3.3 验证
1. **模拟不支持 dvh 的浏览器**（不依赖具体内核版本，首选）：用 Playwright/puppeteer 的请求拦截，把所有 `.css` 响应里的 `(\d)(dvh|svh|lvh)` 替换成 `$1dvhx`（无效单位，等价于旧内核丢弃声明），然后打开素材选择器（画布里参考图选择、素材库里选择各一次，种子数据里要有 ≥ 100 条素材）：
   - 断言 `.material-picker-dialog` 的 BCR 底边 ≤ 视口高度；
   - 断言 `.material-picker-results` 的 `scrollHeight > clientHeight`；
   - `page.mouse.wheel(0, 800)` 之后 `scrollTop > 0`，滚到底时最后一个素材卡片在可见范围内。
2. 同样的断言在不拦截的正常 Chrome 里再跑一遍。
3. 第三个选择器也要测：`FosMaterialLibrary` 本身（素材库页面）和资产库 `FosAssetLibrary` 的弹窗，凡是含 `.fos-dialog` 且有列表的都检查一次。
4. 有条件的话，再装一个 Chromium 100 左右的旧版本（`npx @puppeteer/browsers install chromium@1000000 --path test-results/browsers`，装不上就跳过）手动跑一遍同样的断言，记在部署记录里。

## 4. B4 密码框右侧的「小眼睛」会消失（批次 A）

### 4.1 根因
创建账号的密码框（`FosAccountManagementParts.tsx`，grep `type="password"`）是裸 `<input type="password">`，没有自己的显示/隐藏按钮，用户看到的小眼睛是 Edge / 部分 Chromium 浏览器原生的 `::-ms-reveal`，它只在输入框获得焦点且有内容时才出现，失焦就消失。登录页（`signin/page.tsx`）和改密码页（`change-password/page.tsx`）有自己的按钮，但在 Edge 里会和原生那个叠在一起出现两个眼睛。

### 4.2 方案：一个共用的 `PasswordInput`
1. 新建 `src/components/ui/PasswordInput.tsx`（client）：
   ```tsx
   type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { wrapperClassName?: string }
   ```
   - 渲染 `<span className="nori-password-field …"><input {...props} type={visible ? 'text' : 'password'} className={props.className} ref={ref}/><button type="button" className="nori-password-toggle" …/></span>`，用 `forwardRef`；
   - 按钮：lucide-react 的 `Eye` / `EyeOff`，16px；`aria-label` 为「显示密码」/「隐藏密码」，`aria-pressed={visible}`，`title` 同 aria-label，`disabled` 跟随 input 的 `disabled`；
   - 按钮 `onMouseDown={(e) => e.preventDefault()}`（点击时输入框不失焦，不会触发表单的 blur 校验）；`tabIndex={-1}`，键盘用户不被多一个 Tab 停靠点打断（也可以按 Tab 以外的方式用鼠标点）；
   - 密码框所在表单提交或对话框关闭后，`visible` 重置为 `false`（组件卸载自然重置；表单复用同一组件时在 `value` 变成空串时 `setVisible(false)`）。
2. 样式（`src/app/globals.css` 末尾，或 `frameos-replica.css` 的表单区）：
   ```css
   .nori-password-field { position: relative; display: block; width: 100%; }
   .nori-password-field > input { width: 100%; padding-right: 40px; }
   .nori-password-toggle { position: absolute; top: 50%; right: 6px; transform: translateY(-50%); display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 6px; background: transparent; color: var(--fos-text-4); cursor: pointer; }
   .nori-password-toggle:hover { color: var(--fos-text-1); background: var(--fos-fill-mid); }
   .nori-password-toggle:focus-visible { outline: 2px solid var(--fos-primary); outline-offset: 1px; }
   input[type="password"]::-ms-reveal, input[type="password"]::-ms-clear { display: none; }
   input[type="text"]::-ms-clear { display: none; }
   ```
   （最后三条是全局规则：把 Edge 原生眼睛隐藏，统一用我们自己的。`::-ms-reveal` 在不支持的浏览器里被忽略，无副作用。）
3. **替换所有密码框**：`grep -rn 'type="password"\|type={.*password' src --include="*.tsx"`，除下面两个已经有自己按钮的以外，其余的 `<input type="password" …>` 全部换成 `<PasswordInput …>`（原来的 `className`、`value`、`onChange`、`autoComplete`、`placeholder` 原样传入）：
   - 要换：`FosAccountManagementParts.tsx`（创建/重置密码）、`PlatformAdminAccountsClient.tsx`（grep `password`，如果有 `<input` 的密码框就换）、`PlatformAdminSignInClient.tsx`、`PlatformAdminServicesPanels.tsx`（3 处 API Key / AccessKey）、`SeedanceAssetLibraryConfigCard.tsx`、`StorageConfigCard.tsx`；
   - 不换（已有自己的按钮，只受全局 `::-ms-reveal` 隐藏规则影响）：`auth/signin/page.tsx`、`auth/change-password/page.tsx`。登录页重设计（性能方案 §5）还会改登录页，不要在这里动它的结构。
4. 防回归的 grep 测试 `tests/unit/password-input-usage.test.ts`：扫描 `src/**/*.tsx`，除白名单（`PasswordInput.tsx` 本身、`signin/page.tsx`、`change-password/page.tsx`、以及后续登录页重设计里的同类文件）之外不允许出现 `type="password"`。

### 4.3 验证
浏览器测试：打开团队管理 → 新建账号对话框 → 点密码框 → 输入「abc12345」→ 点别处让它失焦 → 断言 `.nori-password-toggle` 仍然可见（BCR 非零、`getComputedStyle().visibility !== 'hidden'`）→ 点它 → 断言 `input.type === 'text'` 且值不变、输入框没有触发保存 → 再点 → `type === 'password'`。对话框关闭再打开，眼睛回到「隐藏」状态。

## 5. B5 卡顿（批次 A，只补 3 处小改动）

大头在性能方案（`2026-11-14-performance-traffic-login-plan.md` §2、§3、§4），已经安排给同一个实现方，**这里不重复**。本文只补三处：
1. `src/features/canvas/state/useCanvasSync.ts` 的 `useCanvasGraph` 增加 `refetchOnWindowFocus: false`（全局默认 `src/lib/query/client.ts` 不动）。现在每次切回浏览器标签，如果数据超过 `staleTime: 30_000` 就会重拉整张画布并走 `handleSaved` 合并，大画布上表现为卡一下，还会触发 E1 里说的「删掉的节点重新出现」。
2. 文本节点编辑期间不挂载生成面板（E4 §7.4 里实现），打字时不再因为面板重算位置而掉帧。
3. 部署记录里补充一条「卡顿」结论：说明性能方案的哪些批次已上线、哪些没上线；用户反馈「剩下就是一些卡顿优化」指的就是那份方案，不要在本文里另起一套。

## 6. E1 回车 / 删除文本框后「反复弹出」（批次 B）

### 6.1 现状与可能的原因（先复现，再修）
用户描述是「回车删除文本框，反复弹出」。读代码找到 4 条会导致「删了又冒出来 / 重复触发」的路径，**每一条都要先用浏览器测试复现，再修；复现不了的那条也照做防护**（便宜、无副作用）：
1. **服务端合并把删掉的节点又加回来**（最可能）：`handleSaved`（`CanvasGraph.tsx`，grep `const handleSaved`，`:703-736`）会把「本地没有、服务端有」的节点和连线重新加回本地（`serverById.size > 0` 那段，`:718-721`；边在 `:726-734`）。保存是异步的：删除后、保存落库前，只要有一次后台 refetch（`:738-745` 的 revision 刷新、切换标签页回来的 refetch，见 §5.1）带着旧图回来，被删的节点就「弹出」来了；下一次保存又删，又弹……
2. **按键重复**：长按 Delete/Backspace 或 Enter 时 `keydown` 反复触发（`event.repeat`），`removeCurrentSelection`（grep `const removeCurrentSelection`）没有挡。
3. **键盘事件穿透**：Delete/Backspace 处理器（grep `event.key === 'Backspace' || event.key === 'Delete'`，`:3885`）只用 `hasInputFocus()` 判断，焦点在弹窗里的按钮上时（例如视频审阅弹窗、确认框、菜单）按 Delete 或 Enter，会同时删掉后面选中的节点；确认框（`ConfirmHost`）上按回车如果事件冒泡到画布，会再开一个新的确认框。
4. **回车没有任何作用**：选中文本节点后按回车现在什么都不发生，用户会反复按；改成「进入编辑」（见 §7）。

### 6.2 方案
1. **删除墓碑（tombstone）**，在 `CanvasGraph.tsx` 里：
   - `const deletedNodeIdsRef = useRef(new Map<string, number>())`、`deletedEdgeIdsRef` 同理（值是删除时间戳）。
   - 所有会删节点和边的函数把 id 记进去：`removeNodes`（`:1197-1208`）、`removeGroupsWithMembers`（`:1210`）、`removeCurrentSelection`（`:1225-1238`）、删除连线、`onNodesChange` 里的 `remove` 类型变更（grep `type === 'remove'`）。凡是 `setNodes(` / `setEdges(` 里做 `filter` 去掉元素的路径都要核对一遍（`grep -n "setNodes(.*filter\|setEdges(.*filter" src/features/canvas/CanvasGraph.tsx`）。
   - `handleSaved` 开头先清理墓碑：本地已经存在的 id（用户撤销、粘贴把它放回来了）从墓碑里删掉；时间戳超过 10 分钟的也删掉。
   - 处理「服务端有、本地没有」时：id 在墓碑里就**跳过**（不加回来）；服务端图里已经没有这个 id（说明删除已落库）就把它从墓碑里删掉。
   - 把这段合并逻辑抽成纯函数 `selectServerOnlyEntities({ serverIds, localIds, tombstones, now })`，放 `src/features/canvas/graph-merge.ts`，`handleSaved` 调用它，单元测试覆盖：被删节点不被加回、服务端确认后墓碑清除、过期墓碑失效、本地存在则清墓碑、新节点（别的标签页创建的）照常加入。
   - **撤销/重做**（grep `const undo`）恢复节点后，墓碑自然会在下一次 `handleSaved` 里按「本地存在则清除」处理，不需要额外代码；但要在测试里验证「删除 → 撤销 → 保存 → 节点还在」。
2. **按键防护**，在 keydown 处理器里（`:3838-3894`）：
   - 在 `Backspace/Delete` 和新增的 `Enter` 分支前加 `if (event.repeat) return`；
   - 新增辅助函数 `isKeyboardEventInsideOverlay(event)`：`event.target` 在 `[role="dialog"], [role="menu"], [role="alertdialog"], .fos-overlay, .nori-canvas-generator, .nori-canvas-add-panel` 里就返回 true；或者 `mediaPreviewNodeId / modelPreviewNodeId / panoramaPreviewNodeId` 任何一个有值、历史弹窗打开、确认框打开。Delete/Backspace/Enter 在它为 true 时直接 return（不 `preventDefault`，让弹窗自己处理）；
   - 焦点在 `button`/`a`/`summary`/`[role=button]` 上时，Enter 和空格归按钮自己处理，画布不接管（只对 Delete/Backspace 仍然生效，除非上一条为 true）。
3. **确认框只开一个**：`CanvasGraph.tsx` 里群组删除确认（`:3966-3976`）以及其它调用 `ConfirmHost` 的地方，用一个 `confirmOpenRef` 防重入：已经有一个在显示就不再开第二个；确认框关闭后再清 ref。
4. **回车 = 进入编辑**：见 §7.2，和本节配合。
5. 文本节点没有删除确认框，保持现状（Delete 直接删，Cmd+Z 可撤销）。

### 6.3 验证（浏览器测试 `tests/browser/canvas-text-delete.browser.mjs`）
1. 新建文本节点 → 选中 → 按 Delete → 节点消失；**拦截 `GET …/canvas/<id>`（或 revision 轮询）返回删除前的旧图**，触发一次 refetch（`window` 触发 `visibilitychange`/`focus`，或直接 `queryClient.invalidateQueries`）→ 断言节点仍然不在；等自动保存完成后再刷新页面，节点仍然不在。
2. 选中文本节点，`page.keyboard.down('Backspace')` 连续触发 10 次 `repeat: true` 的 keydown（`page.evaluate` 派发）→ 只删一次，没有 toast 报错、没有第二个选中项被删。
3. 打开视频审阅弹窗（背后选中着一个文本节点）→ 焦点在弹窗按钮上按 Delete → 背后的节点还在。
4. 删除 → Cmd+Z → 节点回来 → 等保存 → 节点还在；再删除，节点消失。
5. 选中一个群组按 Delete → 确认框只出现一个；按住 Enter 不会再弹第二个。

## 7. E4 复制后在已选中的文本框里要双击、焦点来回跳（批次 B）

### 7.1 现状
- 文本节点编辑状态是 `TextContent`（`nodes/CreativeNode.tsx:95-133`）里的**局部 state**，只有 `onDoubleClick` 才进入编辑；失焦立即保存并退出。
- 选中单个文本节点后，生成面板（`CanvasGenerator`）会在节点下方弹出（`selectedCreativeNode`，`CanvasGraph.tsx:3405-3416`）；`handleNodeClick`（`:4138-4144`）每点一下选中的节点就切换面板的显示/隐藏（`generatorSuppressedNodeId`），所以「点一下，面板跳出来；再点一下，面板又消失」——这就是「一直跳来跳去」。
- `⌘V` 在没有输入焦点时走 `pasteFromSystem`（`:3344`，`:3864`），总是新建节点，不会粘进选中的文本节点；用户要先双击进入编辑才能粘。
- `textarea.focus()` 没有 `preventScroll`，聚焦到溢出隐藏的画布容器里会触发容器滚动，画面会「跳」一下。

### 7.2 方案
1. **单击已选中的文本节点就进入编辑**
   - `handleNodeClick` 里对 `node.type === 'text' || 'note'` 单独处理，**不再切换生成面板的显示状态**：
     ```ts
     if (node.type === 'text' || node.type === 'note') {
       const alreadySole = soleSelectedNodeIdRef.current === node.id
       const onBody = event.target instanceof Element && event.target.closest('.nori-canvas-text-preview')
       if (alreadySole && onBody && event.detail === 1 && !readOnly) requestTextEdit(node.id)
       return
     }
     ```
     （`event.detail > 1`，即双击，仍由 `TextContent` 自己的 `onDoubleClick` 处理，两条路径都进入编辑，结果一样。）
   - `requestTextEdit(nodeId)`：用 DOM 事件触发，不改上下文类型：
     ```ts
     wrapperRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"] .nori-canvas-text-preview`)
       ?.dispatchEvent(new CustomEvent('nori:edit-text'))
     ```
     `TextContent` 给预览按钮挂 `ref`，在 `useEffect` 里 `addEventListener('nori:edit-text', () => !readOnly && setEditing(true))`。
2. **回车进入编辑**：keydown 里（`Backspace/Delete` 分支旁）加：
   ```ts
   if (event.key === 'Enter' && !mod && !event.shiftKey && !event.repeat && !readOnly) {
     const sole = nodesRef.current.filter((n) => n.selected)
     if (sole.length === 1 && (sole[0].type === 'text' || sole[0].type === 'note') && !isKeyboardEventInsideOverlay(event)) {
       event.preventDefault()          // 必须：否则这个 Enter 会被刚聚焦的 textarea 当成换行
       requestTextEdit(sole[0].id)
       return
     }
   }
   ```
3. **聚焦不滚动、光标放末尾**：`TextContent` 进入编辑的 effect 改成
   ```ts
   const el = ref.current; if (!el) return
   el.focus({ preventScroll: true })
   el.setSelectionRange(el.value.length, el.value.length)
   ```
4. **编辑期间不弹生成面板**：`TextContent` 通过 `useCanvasEditor()` 新增的方法 `setTextEditing(nodeId | null)` 告诉 `CanvasGraph`（在 `CanvasEditorContext.tsx:38` 的 `CanvasEditorContextValue` 里加这个字段，`CanvasGraph` 里 `const [textEditingNodeId, setTextEditingNodeId] = useState<string|null>(null)` 并放进 `editorContext`）。`selectedCreativeNode`（`:3414`）的条件里加 `&& directlySelectedCreativeNode.id !== textEditingNodeId`。进入编辑时 `setTextEditing(id)`，退出（保存、Esc、卸载）时 `setTextEditing(null)`。
5. **⌘V 粘进选中的文本节点**：新建 `src/features/canvas/paste-target.ts`，纯函数：
   ```ts
   export type PasteDecision = 'insert-text' | 'paste-nodes' | 'default'
   export function resolvePasteDecision(input: {
     soleSelectedTextNodeId: string | null   // 只选中了一个 text/note 节点
     readOnly: boolean
     systemText: string                       // 系统剪贴板里的纯文本（读不到时传空串）
     systemHasFiles: boolean                  // 剪贴板里有图片或文件
     internalClipboardIsLatest: boolean       // 画布内部复制的节点剪贴板，是不是最近一次复制
   }): PasteDecision
   ```
   规则：不是「只选中一个文本节点」或只读 → `default`；剪贴板有图片/文件 → `default`；`internalClipboardIsLatest` → `paste-nodes`（保持现在的「复制节点再粘贴」行为，用户在画布里 ⌘C 选中的节点再 ⌘V 要得到副本）；系统文本非空 → `insert-text`；否则 `default`。
   - `internalClipboardIsLatest` 的判定：先读 `clipboard.ts:32-38,65` 和 `copySelection`（`:1443`）看画布复制节点时有没有同时写系统剪贴板、写了什么；在 `copySelection` 里记 `internalClipboardTextRef.current = 写进系统剪贴板的文本`，当前系统文本和它相等（或系统文本为空）就认为内部剪贴板是最新的。
   - `⌘V` 分支（`:3864`）改为先读系统剪贴板文本（沿用 `clipboard.ts` 里已有的读取函数，不另写 `navigator.clipboard` 调用；读不到就当空串），再调 `resolvePasteDecision`：`insert-text` 时把文本接到该节点现有文本末尾（原文本非空且不以换行结尾，先补一个 `\n`），`updateNodeData(id, { text: next }, '粘贴文本')`，不进入编辑状态；其余走原来的 `pasteFromSystem`。
   - 剪贴板文本超过 20,000 个字符时截断到 20,000，并 `setToast('文本过长，已截取前 20000 个字符')`。
6. **编辑时的原生快捷键不被画布截获**：编辑中焦点在 textarea，`hasInputFocus()` 已经让画布快捷键直接返回（`:3845`），要有测试保证 ⌘C、⌘X、⌘A、⌘Z、⌘V 在编辑框里都是原生行为（不新建节点、不全选节点、不撤销画布）。

### 7.3 验证（浏览器测试 `tests/browser/canvas-text-edit-flow.browser.mjs`）
1. 新建两个文本节点 A、B，A 里写「hello」。选中 A，单击 A（已选中）→ 进入编辑（textarea 出现并聚焦），生成面板不显示；点空白退出 → 保存成功。
2. 选中 B（单击），生成面板出现；再单击 B → 进入编辑，面板消失；退出编辑后面板回来。反复点 5 次，`page.evaluate(() => wrapper.scrollLeft/scrollTop)` 一直是 0（没有因聚焦而滚动）。
3. 在 A 的编辑框里全选、⌘C，退出；选中 B（不进入编辑）→ ⌘V → B 的文本变成 A 的文本，画布里节点数不变，撤销一次可恢复。
4. 选中 A（不编辑）→ ⌘C → 选中 B → ⌘V → 画布多出一个 A 的副本（保持原行为），B 的文本不变。
5. 选中 B 按 Enter → 进入编辑，textarea 里没有多出的换行；连按 5 次 Enter（`repeat`）不产生任何额外效果。
6. 在编辑框里 ⌘A 只选中框内文字，不会选中全部节点；⌘Z 只撤销框内输入。
7. `resolvePasteDecision` 的单元测试覆盖上面 6 条规则每一条。

## 8. E2 文本重点标注：加粗 / 高亮（批次 C）

### 8.1 设计
- 文本节点的 `data.text` 保持**纯文本**，所有模型、剪贴板、导出、提示词拼接都不受影响；标注用一个旁路字段保存：
  ```ts
  // src/features/canvas/types.ts，加在 text?: string 附近（grep "text?: string"）
  export type CanvasTextHighlight = 'yellow' | 'green' | 'pink' | 'blue'
  export type CanvasTextMark = { start: number; end: number; bold?: true; highlight?: CanvasTextHighlight }
  // CanvasNodeData 里：
  textMarks?: CanvasTextMark[]
  ```
  `start/end` 是 `data.text` 的 UTF-16 偏移（和 `textarea.selectionStart/End` 一致），半开区间 `[start, end)`。
- 规范形式：按 `start` 排序、互不重叠、相邻且样式相同的合并、不含空区间（`start >= end`）、不含既无 `bold` 也无 `highlight` 的项、最多 200 段、偏移不超出文本长度。**一切读写都过 `normalizeMarks`**。
- 为什么用旁路字段不用富文本：节点文本会被拼进生成提示词（`global-style-prompt.ts`、`upstreamText` 等），Markdown/HTML 会污染提示词；旁路字段对这些路径完全透明，旧数据不需要迁移。
- 渲染：预览和编辑框都用「假粗体」（`-webkit-text-stroke`），保证加粗前后字宽不变，编辑框里的文字对齐不会错位。

### 8.2 纯函数库 `src/features/canvas/text-marks.ts`（必须配单元测试）
```ts
normalizeMarks(marks: CanvasTextMark[] | undefined, textLength: number): CanvasTextMark[]
toggleBold(marks, start, end): CanvasTextMark[]          // 范围内全部已加粗 → 全部取消；否则全部加粗
setHighlight(marks, start, end, color: CanvasTextHighlight | null): CanvasTextMark[]
//   color 与范围内已有的高亮完全相同 → 取消；null → 清除高亮
clearMarks(marks, start, end): CanvasTextMark[]          // 去掉范围内的所有标注
rebaseMarks(marks, oldText: string, newText: string): CanvasTextMark[]
marksEqual(a, b): boolean
splitByMarks(text: string, marks): Array<{ text: string; bold: boolean; highlight?: CanvasTextHighlight }>
```
`rebaseMarks` 的算法（文字被编辑后，让标注跟着文字走）：求 `oldText`/`newText` 的最长公共前缀 `p` 和最长公共后缀 `s`（后缀不得与前缀重叠），被替换的旧区间是 `[p, oldLen - s)`，新区间是 `[p, newLen - s)`，`delta = newLen - oldLen`。
- 标注整段在 `p` 之前：不动；整段在旧区间之后：整体平移 `delta`；
- 与旧区间相交：保留区间外的部分（左半不动，右半平移），区间内的部分删除；
- **纯插入**（旧区间长度为 0）且插入点严格落在某段标注内部（`mark.start < p < mark.end`）：把这段标注扩大 `delta`（在加粗的字中间打字，新字也是加粗）；插入点在标注边界上：不继承；
- 最后 `normalizeMarks(…, newText.length)`。
单元测试至少包含：开头/中间/结尾插入、在标注内部插入（继承）、在标注边界插入（不继承）、删除跨越标注边界、整段替换、全部删除、中文和 emoji（UTF-16 代理对）、`toggleBold` 部分加粗再点一次变全加粗、`setHighlight` 同色取消、不同色覆盖、`clearMarks` 部分清除把一段拆成两段、`normalizeMarks` 丢弃越界项和合并相邻项、超过 200 段截断。

### 8.3 编辑状态（`TextContent`）
把 `TextContent` 从 `CreativeNode.tsx` 抽到 `src/features/canvas/nodes/CanvasTextContent.tsx`（改动大，抽出来更好改；`CreativeNode.tsx` 里 import 回去，对外行为不变）。`text` 和 `note` 两种节点共用（grep `<TextContent`）。
1. 新增 state：`draftMarks`（初值 `normalizeMarks(node.data.textMarks, value.length)`）、`selection: { start, end }`。进入编辑时用节点当前的值重置。
2. `onChange`：`setDraftMarks(rebaseMarks(draftMarks, draft, nextValue))` 然后 `setDraft(nextValue)`（用同一个事件里的新值，别读 state，避免错一拍）。
3. 保存：`if (draft !== value || !marksEqual(draftMarks, normalizeMarks(node.data.textMarks, value.length))) editor.updateNodeData(id, { text: draft, textMarks: draftMarks.length ? draftMarks : undefined }, draft === value ? '标注文本' : '编辑文本')`；Esc 同时还原 `draft` 和 `draftMarks`。
4. 选区：`onSelect`、`onKeyUp`、`onMouseUp` 读 `selectionStart/End` 存进 `selection`；选区为空时不显示工具条。
5. 快捷键（textarea 的 `onKeyDown`）：`⌘/Ctrl+B` → `toggleBold`（选区为空时忽略）；`⌘/Ctrl+Shift+H` → `setHighlight(…, 'yellow')`。都要 `preventDefault()` 和 `stopPropagation()`，并只在有选区时拦截。
6. **镜像层**（让高亮和加粗在编辑框里可见）：只有 `draftMarks.length > 0` 时才渲染，没有标注时和现在完全一样（零回归风险）。
   ```tsx
   <div className="nori-canvas-text-editor-wrap">
     <div className="nori-canvas-text-mirror" aria-hidden ref={mirrorRef}>{segments…}{'​'}</div>
     <textarea className="nodrag nowheel nori-canvas-text-editor has-marks" onScroll={syncScroll} … />
   </div>
   ```
   - 镜像层的字体、字号、行高、字间距、内边距、边框、`white-space: pre-wrap`、`overflow-wrap`、`word-break` 必须和 `.nori-canvas-text-editor` 完全相同（在 `canvas.css:277` 附近，两者共用同一组选择器写一份，不要复制一份再手动同步）；
   - `.has-marks` 的 textarea：`color: transparent; background: transparent; caret-color: var(--canvas-text);` 文字由镜像层绘制（镜像层文字用 `var(--canvas-text)`）；选区高亮仍然由 textarea 自己的 `::selection` 显示；
   - `onScroll` 里把 `mirror.scrollTop = textarea.scrollTop`（镜像层 `overflow: hidden`，高度同 textarea）。
7. **工具条** `src/features/canvas/components/TextMarkBar.tsx`：
   - 渲染到 `document.body`（`createPortal`），`position: fixed`，类名 `nori-text-mark-bar fos-viewport-theme nodrag`，`z-index: 100200`；
   - 位置：textarea 的 `getBoundingClientRect()` 顶边上方 44px、水平居中，超出视口时往里收；用 `requestAnimationFrame` 节流，在 `selectionchange`、`resize`、画布移动、textarea 滚动时更新；
   - 内容（从左到右，间距 4px，每个 28×28，圆角 6px）：「B」加粗按钮 → 分隔线 → 4 个色块按钮（黄、绿、粉、蓝，圆形 14px 色点）→ 分隔线 → 「清除标注」按钮（`Eraser` 图标）；
   - 无障碍名称：「加粗（⌘B）」（Windows 显示「加粗（Ctrl+B）」，用 `navigator.platform` 判断）、「黄色高亮」「绿色高亮」「粉色高亮」「蓝色高亮」「清除标注」；`aria-pressed` 表示当前选区是否已加粗/已是该色；
   - 每个按钮 `onMouseDown={(e) => e.preventDefault()}`，**保证 textarea 不失焦、选区不丢**（否则 `onBlur` 会保存并退出编辑，工具条消失）；点击后调用对应纯函数更新 `draftMarks`，不改 `draft`。
8. 只读画布（`readOnly`）不显示工具条、不能编辑，但预览仍然渲染标注。

### 8.4 预览状态
预览按钮里的 `value.trim() || <span>（双击编辑文本）</span>` 改为：有标注时用 `splitByMarks(value, marks)` 渲染成 `<span className="nori-text-mark is-bold hl-yellow">…</span>` 序列，没有标注时保持原样。`white-space: pre-wrap` 保持。

### 8.5 样式（`canvas.css:277-296` 附近）
```css
.nori-text-mark.is-bold { -webkit-text-stroke: .55px currentColor; }
.nori-text-mark.hl-yellow { background: rgba(250, 204, 21, .38); }
.nori-text-mark.hl-green  { background: rgba(52, 211, 153, .34); }
.nori-text-mark.hl-pink   { background: rgba(244, 114, 182, .34); }
.nori-text-mark.hl-blue   { background: rgba(56, 189, 248, .34); }
.nori-text-mark { border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
```
工具条用 `var(--fos-bg-4)`、`var(--fos-border-mid)`、`var(--fos-shadow-pop)`，色块用同样的 4 个颜色（不透明版本：`#facc15 #34d399 #f472b6 #38bdf8`）。不要为这些颜色写任何 `white` / `#fff` 之类的字面量（批次 E 的日间模式会批量替换）。

### 8.6 数据与兼容
- 服务端保存路径是否会剔除未知的节点 `data` 字段：`grep -rn "videoPrefixPrompt\|sanitizeNodeData\|NodeDataSchema" src/server src/app/api src/features/canvas | head`，如果有白名单或 zod 校验，把 `textMarks` 加进去；没有就不用改。**必须做一次真实往返测试**：本地种子环境里创建画布、写入带 `textMarks` 的文本节点、保存、重新打开，字段完整。
- 复制/粘贴节点、复制画布、撤销重做：节点 `data` 是整体拷贝，`textMarks` 会跟着走；系统剪贴板里只放纯文本。
- 文本被别的路径整体替换时（例如文本节点的 AI 生成结果写回 `data.text`，grep 生成完成合并节点数据的位置），把 `textMarks` 置为 `undefined`；渲染时统一经过 `normalizeMarks(marks, text.length)`，越界的自动丢弃，不会崩。
- §7.2 第 5 点的「粘贴追加到末尾」不会移动已有标注，无需调整。

### 8.7 验证（浏览器测试 `tests/browser/canvas-text-marks.browser.mjs`）
1. 新建文本节点，进入编辑，输入「hello world」，`setSelectionRange(6, 11)` 并派发 `select` → 工具条出现；点「加粗」→ 编辑框里镜像层有 `.is-bold` 包住「world」；点空白退出 → 预览里 `.nori-text-mark.is-bold` 的文字是「world」；刷新页面（等自动保存完）后仍在。
2. 选中「hello」→ 点黄色 → 再点一次黄色 → 高亮取消；点蓝色 → 高亮变蓝；点「清除标注」→ 标注消失。
3. 在加粗的「world」中间输入 x → 新的 x 也是加粗；在「hello」前面输入 → 标注整体右移，仍然包住 world。
4. ⌘B、⌘⇧H 快捷键同上。选区为空时按 ⌘B 没有效果。
5. 有标注时，镜像层与 textarea 的 `scrollHeight` 相等，且每一行的文字位置对齐（对比两者的 `Range.getClientRects()` 首行 `top`，误差 ≤ 1px）；长文本滚动时两者同步。
6. 加了标注的节点，⌘Z 一次撤销到加标注之前；复制节点再粘贴，副本带着标注；只读画布（分享链接/只读模式）能看到标注，没有工具条。
7. 没有任何标注的旧文本节点，编辑框 DOM 里没有镜像层。

## 9. E5 视频审阅弹窗里「对照提示词」（批次 D）

### 9.1 现状
- 双击或点放大打开的视频审阅弹窗是 `CanvasMediaPreviewDialog.tsx`（挂载处 `CanvasGraph.tsx`，grep `<CanvasMediaPreviewDialog`，`:4457`），里面是 `VideoPreviewWorkspace.tsx`：左边播放器和时间线，右边 292px 宽的「关键帧」面板（`<aside className="nori-video-inspector">`，`:425-465`），底部工具栏有「关键帧 / 识别镜头 / 截取当前帧」（`:470-474`）。
- 弹窗里完全看不到生成这个视频用的提示词；要看提示词得关掉弹窗、选中节点、看生成面板，再回来看画面。用户想要一边看镜头、机位效果，一边对照并修改提示词。
- 节点数据里有这些可用字段（`types.ts`，grep `prompt?:`、`history`、`sourceMetadata`、`CanvasGenerationHistoryItem`）：`data.prompt`（节点当前提示词，「重新生成」用它，见 `CanvasGraph.tsx:2007-2010`）、`data.history[]`（每个版本有 `url`、`prompt`、`modelKey`、`parameters`，`types.ts:253-269`）、`data.sourceMetadata.prompt`、`data.generation`（模型、参考图、时长等）。

### 9.2 方案总览
右侧面板拆成两个标签页：「关键帧」（现有内容原样不动）和新增的「提示词」。底部工具栏在「截取当前帧」后面加按钮「对照提示词」，快捷键 `P`。

### 9.3 版本提示词解析（纯函数，必须单元测试）
新建 `src/features/canvas/video-prompt.ts`：
```ts
export type VideoVersionPrompt = {
  prompt: string
  source: 'history' | 'metadata' | 'node' | 'none'
  modelKey?: string | null
  parameters?: Record<string, string | number | boolean | null>
}
export function resolveVideoVersionPrompt(data: CanvasNodeData): VideoVersionPrompt
```
按顺序取第一个非空的：
1. `data.history` 里 `url` 与当前视频地址（`data.videoUrl || data.contentUrl`）相同的那一项的 `prompt`。URL 比较要忽略签名查询参数：先 `grep -rn "stripSignature\|mediaKey\|normalizeMediaUrl" src/lib src/features/canvas` 找现成的归一化函数，没有就只比较 `origin + pathname`；同一个 URL 有多项时取 `createdAt` 最新的；
2. `data.sourceMetadata?.prompt`（字符串才算）；
3. `data.prompt`；
4. 都没有 → `source: 'none'`，`prompt: ''`。
测试覆盖：命中历史、历史无匹配回退到 metadata、URL 签名参数不同仍命中、多条同 URL 取最新、全空。

### 9.4 弹窗和工作区改动
1. **`CanvasMediaPreviewDialog.tsx`**：新增 props
   ```ts
   onPromptSave?: (prompt: string, sourceNode: CanvasFlowNode) => void
   onPromptRegenerate?: (prompt: string, sourceNode: CanvasFlowNode) => Promise<void>
   ```
   视频分支把 `version={resolveVideoVersionPrompt(node.data)}`、`currentPrompt={node.data.prompt || ''}`、`onPromptSave`、`onPromptRegenerate` 传给 `VideoPreviewWorkspace`。`VIDEO_SHORTCUTS` 字符串末尾加 ` · P 对照提示词`。
   - Esc 保护：捕获阶段的 keydown 里，如果事件目标是 `.nori-video-prompt-panel textarea` 且它的 `data-dirty="true"`，Esc 只让它失焦（`target.blur()`），不关闭弹窗。
2. **`VideoPreviewWorkspace.tsx`**：
   - 新 state `inspectorTab: 'keyframes' | 'prompt'`（默认 `'keyframes'`）；`aside` 头部加一行标签页（`role="tablist"`，两个按钮「关键帧」「提示词」，选中态沿用 `.is-active` 的写法），关键帧内容在 `inspectorTab === 'keyframes'` 时渲染（把现在的内容包进去，不改里面的任何逻辑）；
   - 工具栏「截取当前帧」后面加：`<button type="button" className={…is-active} aria-label="对照提示词" title="对照提示词 (P)" aria-pressed={inspectorOpen && inspectorTab === 'prompt'}>` + `FileText` 图标 + 文字「对照提示词」（图标沿用 `@/components/ui/icons` 里已有的，没有 `FileText` 就找最接近的文字类图标）；点击：已打开且在提示词页 → 收起面板；否则 `setInspectorOpen(true); setInspectorTab('prompt')`；
   - 快捷键 `P`：在已有的键盘处理里（用 `editableTarget` 判断，输入框里不触发）同上切换；
   - 右上角原有的「关键帧面板」按钮（`:485`）保持，打开时回到上次的标签页；
   - 提示词页宽度：面板在 `inspectorTab === 'prompt'` 时给根节点加 `data-inspector-tab="prompt"`，`canvas.css:4785/4800/4854` 的网格列把 292px 改为 `360px`（只在这个属性下），窗口宽度 < 1000px 时面板本来默认收起，保持。
3. **新组件** `src/features/canvas/components/VideoPromptPanel.tsx`（`className="nori-video-prompt-panel"`），内容从上到下：
   1. 标题行「提示词」，右侧显示当前播放位置（等宽字体，`mm:ss.f`，随播放更新，节流 10 次/秒）；
   2. 小标题「生成这个视频的提示词」，下面是只读文本块（`white-space: pre-wrap`，最大高度 160px，超出滚动，`user-select: text`），右上角「复制」按钮（`navigator.clipboard.writeText`，成功后按钮文字变「已复制」1.5 秒）；元信息一行小字：`{模型名} · {时长}秒 · {比例}`（从 `version.modelKey`、`version.parameters` 取，取不到的省略）；`source === 'none'` 时显示灰字「这个视频没有保存提示词」；`source === 'node'` 或 `'metadata'` 时在元信息旁加灰字「来自节点当前提示词」；
   3. 小标题「修改提示词」，下面是可编辑 `<textarea>`（`rows=8`，最大高度 280px，自适应高度；初值：该视频的提示词，如果为空就用 `currentPrompt`；`data-dirty` 表示与 `currentPrompt` 不同）。**不做 `@` 引用的富文本编辑**，只是纯文本：引用的素材仍然由节点的生成配置（`data.generation.referenceNodeIds`）决定，不受影响；
   4. 状态标签（textarea 上方右侧，小字）：和「该视频的提示词」不同 → 橙色「已修改，与当前视频不一致」；和节点当前提示词相同但和视频不同 → 灰色「已保存到节点，尚未重新生成」；相同 → 不显示；
   5. 按钮行：
      - 「插入时间点」：在光标处插入当前播放位置，格式 `00:03 `（`mm:ss` 后跟一个空格），用于在提示词里写「00:03 镜头推进」；
      - 「恢复原提示词」（有修改时才可点）：textarea 恢复为该视频的提示词；
      - 「保存到节点」：调用 `onPromptSave(text)`，按钮短暂变成「已保存」；
      - 「保存并重新生成」（主按钮）：调用 `onPromptRegenerate(text)`；提交中显示「提交中…」并禁用；旁边灰字「会生成新版本并消耗积分，旧版本保留在历史里」；
   6. 全局前缀提示：节点的 `data.videoPrefixPrompt` 为真时（先读 `global-style-prompt.ts:67-76,108-119` 弄清含义，按它的实际行为写文案），在面板底部加灰字「生成时会自动拼上项目的视频前缀提示词，这里只显示你写的部分。」；不是这个含义就不加，不要写错误的说明；
   7. 只读画布（`readOnly`）：文本块可复制，textarea 和三个写入按钮不渲染（或禁用并提示「只读预览不可修改」）。
   - **草稿不丢**：模块级 `const promptDrafts = new Map<string, string>()`（key = 节点 id），textarea 内容变化时写入；组件挂载时如果有草稿且「该视频的提示词」没变，就恢复草稿；「保存」或「重新生成」成功后清除草稿。
4. **`CanvasGraph.tsx`**：
   - 把 `'regenerate'` 动作里那一大段 `handleGenerate({...})`（`:2007-2010`）抽成函数 `regenerateNode(nodeId: string, promptOverride?: string)`，原动作调用 `regenerateNode(nodeId)`，行为不变；函数里 `const prompt = promptOverride ?? node.data.prompt`；缺少 `config?.modelKey` 时 `setToast('缺少模型配置，请在生成面板里重新选择模型后生成')` 并返回（原来是静默什么都不做）。
   - 先读 `handleGenerate`（`:1551`）和 `createHistoryItem`（`:478`），确认：重新生成会给节点增加一个新历史版本并保留旧视频（用户能在历史里切回去）；确认 `handleGenerate` 完成后会把 `data.prompt` 更新为请求里的 prompt，没有的话在 `regenerateNode` 里先 `updateNodeData(nodeId, { prompt }, '修改提示词')`。如果发现重新生成会不可恢复地覆盖旧视频，停下来按 R10 处理。
   - 挂载处：
     ```tsx
     onPromptSave={(prompt, source) => updateNodeData(source.id, { prompt }, '修改提示词')}
     onPromptRegenerate={async (prompt, source) => {
       updateNodeData(source.id, { prompt }, '修改提示词')
       await regenerateNode(source.id, prompt)
       setMediaPreviewNodeId(null)
       setToast('已提交重新生成，完成后可在节点的历史版本里对比')
     }}
     ```
     只读画布不传这两个 props。
5. **样式**（`canvas.css`，视频工作区样式 `:4785` 附近，类名统一 `nori-video-prompt-*`）：沿用关键帧面板的间距、字号（12px/13px）、`var(--fos-*)` 颜色；textarea 用 `var(--fos-bg-1)` 底、`var(--fos-border-mid)` 边、聚焦时 `var(--fos-primary-border)`；橙色标签用 `var(--fos-warning)`。**不要写 `white`/`#fff`/`rgba(255,255,255,…)`**（批次 E 会批量处理）。
6. 提交时的积分：由 `handleGenerate` 现有的扣费逻辑负责（谁点谁付，见 UX 方案任务 E），本功能不碰计费。

### 9.5 验证
1. 单元测试：`resolveVideoVersionPrompt`（§9.3 列的 5 种）。
2. 浏览器测试 `tests/browser/canvas-video-prompt.browser.mjs`（**必须拦截生成接口**，不能真的调用模型）：种子画布里放一个视频节点，`data.history` 有两个版本、提示词不同，当前视频对应第二个版本。
   - 打开审阅弹窗，按 `P` → 右侧出现「提示词」页，只读块是第二个版本的提示词；再按 `P` → 收起；点工具栏「对照提示词」同样打开；
   - 编辑 textarea → 出现橙色「已修改，与当前视频不一致」；点「恢复原提示词」→ 标签消失；
   - 编辑后点「保存到节点」→ 等自动保存 → 重新加载页面，节点 `data.prompt` 是新文本；
   - 编辑后点「保存并重新生成」→ 被拦截的生成请求体里 `prompt` 等于编辑后的文本，弹窗关闭，出现 toast；
   - 在 textarea 里有改动时按 Esc → 弹窗不关闭、textarea 失焦；再按 Esc → 弹窗关闭；重新打开 → 草稿恢复；
   - 点「插入时间点」→ 光标处多出 `00:0x `；
   - 只读画布：没有 textarea 和写入按钮，「复制」可用；
   - 「关键帧」页的所有原有行为不变（跑一遍现有的视频审阅测试，grep `VideoPreviewWorkspace` 在 `tests/` 里找）。
3. 截图：1366×768 和 1920×1080 各一张，面板打开后播放器不被挤得过小（视频区宽度 ≥ 480px）；窄窗口（900px）面板默认收起，点按钮后覆盖在播放器右侧而不是挤压它（沿用关键帧面板的窄屏处理）。

## 10. E3 日间模式（批次 E，最大的一项，放最后）

### 10.1 目标与硬约束
- 提供三种外观：「深色」（现在的样子）、「日间」、「跟随系统」。默认「深色」，**深色外观必须和现在一像素不差**（验收见 §10.9，用截图逐像素对比）。
- 日间模式下正文对比度达到 WCAG AA：正文（≥ 12px）与其背景 ≥ 4.5:1；辅助文字、占位符 ≥ 3:1。
- 范围：工作台、画布、素材库、资产库、团队管理、个人中心、后台管理（`.nori-admin`）、弹窗和菜单。**不做日间版的**（始终深色，加 `nori-force-dark`）：登录页和后台登录页（`.nori-auth`、`.nori-admin-login`，刚按性能方案 §5 重设计）、媒体播放与预览区（视频审阅弹窗、全景预览、3D 预览、图片灯箱、视频节点上盖在画面上的播放条）、画布节点里的媒体画面本身。理由：这些是「看片」场景，深色底更准确；登录页是品牌页。
- 不改任何文案、布局、尺寸，只换颜色。

### 10.2 现状数据（2026-11-14 实测，行号以 grep 为准）
- 颜色散落在 6 个全局/共享 CSS 和 2 个功能 CSS 里：`src/styles/{frameos-replica,frameos-tokens,ui-tokens-glass,ui-semantic-glass,nori-auth,animations}.css`、`src/app/globals.css`、`src/features/canvas/canvas.css`（7,791 行）、`src/features/canvas/story/story-canvas.css`、`src/features/interactive/*.css`。
- 颜色令牌：`frameos-replica.css:8-76`（`--fos-*`，深色色值，见 §10.3）、`canvas.css:1-15`（`--canvas-*`）、`canvas.css:6645-6670`（`:root { --dm-* }`）、`interactive.css` 的 `--ix-*`、`globals.css:38-68`（shadcn 的 `--background` 等，浅色，目前没被强制深色的页面使用，`html, body { background-color: #0d0d0d }` 在 `globals.css:505-508`）。
- 字面量：约 **1,159 处** `rgba(255,255,255,.xx)`（白色半透明做边框、填充、悬停、文字），另有大量写死的十六进制颜色（`#d1d2da`、`#202028`、`#f2f3f7`、`#9fa0ae` 等，例如 `frameos-replica.css:693-697`），以及 TSX 里 **704 处** `text-white`、大量 `bg-white/5`、`border-white/10`、`text-white/60`。
- `color-scheme: dark` 写死在 `frameos-replica.css:98`、`canvas.css:1825,4107,6442`、`interactive.css:3,494`。
- TS 里的颜色：`CanvasGraph.tsx` 的 `<Background color="rgba(163,172,255,.12)">`（`:4391`）、`minimapNodeColor`（`:436`）、MiniMap 配色（`:4396-4404`），以及 React Flow 连线/句柄的内联颜色（grep `stroke:|color:|fill:` 在 `src/features/canvas/**/*.tsx`）。
- 已经存在一个 `[data-theme="frameos-dark"]` 属性（`frameos-tokens.css`，挂在某些页面根容器上）。**新的主题属性不要叫 `data-theme`**，用 `data-nori-theme`，避免撞名。

### 10.3 令牌设计：通道令牌（`R G B`）+ 两套取值
新建 `src/styles/theme.css`，在 `globals.css` 里 `@import` 到 `frameos-tokens.css` 之后、`frameos-replica.css` 之前。
```css
/* 深色：数值与现在完全一致 */
:root, .nori-force-dark, html[data-nori-theme="light"] .nori-force-dark {
  --nori-bg-0: 8 8 12;     --nori-bg-1: 12 12 17;   --nori-bg-2: 19 19 25;
  --nori-bg-3: 27 27 35;   --nori-bg-4: 36 36 46;   --nori-bg-5: 47 47 59;
  --nori-text-1: 245 245 250; --nori-text-2: 188 189 203; --nori-text-3: 156 157 174;
  --nori-text-4: 135 136 154; --nori-text-5: 94 95 112;
  --nori-primary: 110 123 255; --nori-primary-hover: 95 108 245; --nori-primary-text: 163 172 255;
  --nori-ink: 255 255 255;   /* 叠加层的颜色：深色里是白，用来做半透明边框、填充、悬停 */
  --nori-a: 1;               /* 叠加层透明度倍率 */
  --nori-page-bg: 13 13 13;
  --nori-color-scheme: dark;
  --color-white: #ffffff;    /* Tailwind v4 的 text-white / bg-white/5 都读这个变量 */
}
/* 日间 */
html[data-nori-theme="light"] {
  --nori-bg-0: 236 238 245;  --nori-bg-1: 245 246 250;  --nori-bg-2: 255 255 255;
  --nori-bg-3: 255 255 255;  --nori-bg-4: 240 241 246;  --nori-bg-5: 228 231 240;
  --nori-text-1: 22 24 39;   --nori-text-2: 61 64 84;   --nori-text-3: 93 96 117;
  --nori-text-4: 117 120 140; --nori-text-5: 154 157 176;
  --nori-primary: 91 103 245; --nori-primary-hover: 75 86 216; --nori-primary-text: 75 86 216;
  --nori-ink: 22 24 39;
  --nori-a: 1.7;
  --nori-page-bg: 245 246 250;
  --nori-color-scheme: light;
  --color-white: #161827;
}
```
然后把现有令牌改成引用通道（**取值在深色下与原来一模一样**，所以所有 `var(--fos-*)` 的使用处不用改）：
- `frameos-replica.css:8-76` 的 `--fos-bg-0..5` → `rgb(var(--nori-bg-N))`；`--fos-text-1..5` → `rgb(var(--nori-text-N))`；`--fos-primary`、`-hover`、`-text` 同理；`--fos-primary-soft/border`、`--fos-success-soft` 之类带透明度的保持原值（品牌色在两种主题下一样，原值是 `rgba(110,123,255,.14)`，日间下 primary 稍深，改成 `rgb(var(--nori-primary) / .14)`、`/ .4`，深色下数值相同）；
- `--fos-border-soft/mid/strong`、`--fos-fill-soft/mid`：`rgb(var(--nori-ink) / calc(.05 * var(--nori-a)))`、`.085`、`.14`、`.035`、`.07`（深色下 `--nori-a: 1`，值不变；日间 `1.7`，边框更清晰）；
- `--fos-shadow-card/pop`：日间用更轻的阴影，在 `html[data-nori-theme="light"]` 里覆盖：`--fos-shadow-card: 0 1px 2px rgb(22 24 39 / .06), 0 8px 24px -12px rgb(22 24 39 / .14)`，`--fos-shadow-pop: 0 24px 64px -16px rgb(22 24 39 / .28), 0 0 0 1px rgb(22 24 39 / .08)`；
- `--fos-grain` 的噪点是白色，日间下 `--fos-grain: none`；`--fos-on-cta` 保持 `#ffffff`；`--fos-hue-*`（功能色）两种主题用同一组色；`--fos-warning/-danger-text/-success` 这类「文字用的状态色」日间下压暗一档（在日间块里覆盖：`--fos-danger-text: #c42b31; --fos-warning: #b45309; --fos-success: #15803d`，对应的 `-soft` 背景不变）；
- `--canvas-*`（`canvas.css:1-15`）、`--dm-*`（`canvas.css:6645-6670`）、`--ix-*`（`interactive.css`）：同样改为引用上面的通道（`--canvas-bg: rgb(var(--nori-bg-0))`、`--dm-card: rgb(var(--nori-bg-3))`、`--dm-text: rgb(var(--nori-text-1))`、`--dm-muted: rgb(var(--nori-text-1) / .72)`、`--dm-hover: rgb(var(--nori-ink) / calc(.06 * var(--nori-a)))`……）。`--dm-line`（`#34343f`）、`--dm-line-strong`（`#6f7084`）这类不在色阶里的：深色保持原值，日间块里给 `--dm-line: #d6d9e4; --dm-line-strong: #9a9db0`；
- `color-scheme: dark`（上面列的 7 处）全部改成 `color-scheme: var(--nori-color-scheme)`（`.nori-force-dark` 里本来就是 dark）；
- `globals.css:505-508` 的 `html, body { background-color: #0d0d0d }` 改成 `rgb(var(--nori-page-bg))`。

### 10.4 批量迁移脚本 `scripts/theme/tokenize-colors.mjs`
手改 1,159 处不现实，也容易漏，写一个确定性的脚本，`--check`（只报告，不写）和 `--write`（改写）两个模式，处理 `src/**/*.css` 和 `src/**/*.tsx`（TSX 里只处理 Tailwind 任意值 `bg-[#xxxxxx]`、`text-[#xxxxxx]`、`border-[#xxxxxx]` 和 `style` 里的颜色字面量，后者只报告）。规则：
1. **白色半透明**：`rgba(255, 255, 255, A)`（含 `#fff`+alpha 的写法、`rgb(255 255 255 / A)`）：
   - 出现在 `color`、`caret-color`、`-webkit-text-fill-color`、`text-decoration-color`、`fill`（用于文字图标）里 → `rgb(var(--nori-ink) / A)`（文字不乘倍率，否则日间太黑）；
   - 其它属性（`background*`、`border*`、`outline*`、`box-shadow` 里的 inset 高光、`stroke`、`fill`）→ `rgb(var(--nori-ink) / calc(A * var(--nori-a)))`；
   - 渐变里的白色半透明同样处理；
   - **不处理**：`rgba(0,0,0,A)`（遮罩、阴影，两种主题通用）、选择器在 `.nori-force-dark` / `.nori-auth` / `.nori-admin-login` 内的规则（脚本通过「规则的选择器文本里出现这些类名」判断，跳过）。
2. **色阶精确匹配**：`#08080c #0c0c11 #131319 #1b1b23 #24242e #2f2f3b`（大小写不敏感，3 位和 6 位写法都认）→ `rgb(var(--nori-bg-0..5))`；`#f5f5fa #bcbdcb #9c9dae #87889a #5e5f70` → `rgb(var(--nori-text-1..5))`；`#6e7bff #5f6cf5 #a3acff` → `--nori-primary / -hover / -text`；`#0d0d0d`（页面底）→ `rgb(var(--nori-page-bg))`。
3. **其它十六进制颜色**（例如 `#d1d2da`、`#202028`）：为了保证深色一像素不变，不就近归并，而是**自动生成成对令牌**。判断它的角色：出现在 `color` 类属性里是「文字」，否则是「表面」。生成 `--nori-t-<hex>` / `--nori-s-<hex>`，深色值是原色，日间值用 OKLCH 明度映射算出（保留色相和彩度）：
   - 表面：`L' = 1 − 0.35·L`（深灰表面 L≈0.1–0.35 映射到 0.97–0.88）；
   - 文字：`L' = 0.12 + 0.86·(1 − L)`（浅字 L≈1 映射到 0.12，中灰字 L≈0.6 映射到 0.47）；
   - 明度 L > 0.85 的「表面」（本来就是浅色块，例如白色按钮底）和 L < 0.2 的「文字」（本来就是深色字）保持原值，两种主题通用。
   - 脚本里自己实现 sRGB ↔ OKLab ↔ OKLCH 转换（约 30 行，不引入依赖），转回 sRGB 时对超出色域的做彩度裁剪。
   - 令牌写进 `src/styles/theme-generated.css`（提交到仓库，`html[data-nori-theme="light"]` 块里放日间值，`:root` 块里放深色值），替换处写成 `rgb(var(--nori-s-202028))`。
   - 带 alpha 的十六进制（`#rrggbbaa`）：alpha 单独保留 → `rgb(var(--nori-s-rrggbb) / .aa)`。
4. **带名字的颜色**：`white`、`#fff`、`#ffffff`（不带 alpha）：出现在 `color` 里 → 看规则：规则里同时有 `background` 是品牌色/渐变/`--fos-primary`/红绿色（`--fos-danger`、`#ef4444` 等）→ 保持白色（按钮上的字）；否则 → `rgb(var(--nori-text-1))`。不能确定的写进报告，不改。
5. **Tailwind 类**：`text-white`（704 处）、`bg-white/N`、`border-white/N`、`ring-white/N`、`divide-white/N`、`text-white/N`、`placeholder:text-white/N`、`hover:bg-white/N`……靠 `--color-white` 的重映射（§10.3 的日间块里 `--color-white: #161827`）自动翻转，**脚本不改它们**。但 `text-white` 用在彩色底上必须保持白色，脚本处理：同一个 `className` 字符串里出现 `bg-[var(--fos-primary` / `bg-[var(--fos-brand` / `bg-indigo-` / `bg-violet-` / `bg-red-` / `bg-green-` / `bg-emerald-` / `bg-amber-` / `bg-rose-` / `bg-gradient` / `fos-btn-primary` / `fos-btn-danger` 时，把这个 `text-white` 改写成 `text-on-brand`，并在 `globals.css` 的 `@theme` 里加 `--color-on-brand: #ffffff`。其余 `text-white` 报告里列出文件和行号，人工扫一遍。
6. 脚本输出报告 `test-results/theme/tokenize-report.md`（不提交）：每个文件的替换数量、不确定项（规则 4、`text-white` 在彩色底的疑似项、TSX 的 `style` 字面量）。`--write` 之后再跑 `--check` 必须报告 0 处可自动处理的剩余项（幂等）。
7. 脚本自带单元测试 `tests/unit/theme-tokenize.test.ts`：每条规则一个 fixture；`#202028`、`#d1d2da` 的深色往返值必须与原值逐字节一致；日间映射值落在预期明度范围；幂等。

### 10.5 强制深色区域 `nori-force-dark`
给这些容器的根元素加类名 `nori-force-dark`（它在 §10.3 里重新声明了深色令牌，覆盖日间值，里面的一切按深色渲染）：
- `CanvasMediaPreviewDialog.tsx` 的弹窗根、`VideoPreviewWorkspace.tsx` 根、全景预览（grep `PanoramaPreview`）、3D 预览（grep `ModelPreview`、`Studio3D`、`studio_3d`）、图片灯箱；
- 视频节点上盖在画面上的控制（`canvas.css` 里 `.nori-canvas-video-toggle`、`.nori-canvas-video-bar`，约 `:7427`、`:7453`）、图片/视频节点右上角的悬浮工具条、节点缩略图上的角标（它们盖在媒体画面上，不跟主题走）；
- 登录页和后台登录页（`.nori-auth`、`.nori-admin-login` 的根；这两个选择器本来就在 `frameos-replica.css:8` 的令牌块里，要把它们从日间块的作用范围里排除：日间块选择器是 `html[data-nori-theme="light"]`，而 `.nori-force-dark` 规则更具体，所以给它们的根节点加上这个类即可）。
`html[data-nori-theme="light"] .nori-force-dark` 的优先级高于 `html[data-nori-theme="light"]`，嵌套没问题；弹窗是 portal 到 `document.body` 的（`ViewportDialogLayer`、`CanvasMenuPortal`），**portal 出来的根节点自己加 `nori-force-dark` 才有效**，不能指望祖先。
列出所有改动的文件在部署记录里，便于日后增减。

### 10.6 TS 里的颜色
1. 新建 `src/lib/theme/useNoriTheme.ts`：`useNoriTheme(): { preference: 'dark' | 'light' | 'system'; resolved: 'dark' | 'light'; setPreference(p): void }`；`resolved` 从 `document.documentElement.dataset.noriTheme` 读，用 `MutationObserver` 监听属性变化，保证切换时所有订阅者同步更新。
2. 新建 `src/features/canvas/theme-colors.ts`：`canvasThemeColors(resolved)` 返回 React Flow 用的颜色（背景点阵、MiniMap 遮罩与节点色、连线默认色、句柄色）。深色取现在的值（`rgba(163,172,255,.12)` 等，逐个照抄），日间取：点阵 `rgba(91,103,245,.18)`、连线 `#9aa0c4`、MiniMap 背景 `#ffffff`、遮罩 `rgba(245,246,250,.7)`。`CanvasGraph.tsx` 的 `<Background>`、`<MiniMap>`、`minimapNodeColor`、边样式从这里取，并在 `useNoriTheme().resolved` 变化时更新（用 `useMemo` 依赖 `resolved`）。
3. 其它 TSX 里写死的颜色（`grep -rn "style={{[^}]*\(color\|background\)" src --include="*.tsx"` 和脚本报告里的 `style` 字面量）：能换成 `var(--…)` 的换；是画布外的数据可视化色（如各类型的色点）保持。

### 10.7 主题状态：cookie + 服务端渲染，无闪烁
- 偏好保存在 cookie `nori-theme`（值 `dark | light | system`，`Path=/; Max-Age=31536000; SameSite=Lax`；不加 `Secure` 以免本机和测试机（http）写不进去，生产走 https 时浏览器也照常发送）。**不写数据库、不加接口**（外观是设备级偏好）。
- `src/app/[locale]/layout.tsx`：`const pref = (await cookies()).get('nori-theme')?.value`；`<html data-nori-theme={pref === 'light' ? 'light' : 'dark'} data-nori-theme-pref={pref ?? 'dark'} suppressHydrationWarning>`。注意这个 layout 已经是动态渲染（根 layout 是 `force-dynamic`），读 cookie 不会让缓存变差。
- 「跟随系统」：§1.2 的 `nori-env-flags` 内联脚本里再加几行（同一个 `next/script`）：读 `data-nori-theme-pref`，为 `system` 时 `matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'` 写回 `data-nori-theme`，首次绘制前完成，没有闪烁。`useNoriTheme` 里为 `system` 时监听 `matchMedia` 的 `change` 事件并更新。
- `setPreference(p)`：写 cookie、更新 `data-nori-theme-pref` 和 `data-nori-theme`；不刷新页面。
- 所有 `<meta name="theme-color">`（grep）同步：日间 `#f5f6fa`，深色 `#0d0d0d`。

### 10.8 切换入口（两处，文案固定）
1. **账号设置弹窗**（`FosShellModals.tsx:116-141` 的 `AccountModal`）：在现有分组里加一组「外观」，单选按钮组（`role="radiogroup"`，三个选项并排，按钮样式沿用 `fos-btn fos-btn-sm`，选中态用 `.is-active` 或 `aria-checked`）：「深色」「日间」「跟随系统」，下面一行灰字「只影响当前这台设备上的显示。」
2. **画布顶部 ☰ 菜单**（`CanvasChrome.tsx:249-281`）：菜单里加一项「外观：深色 / 日间 / 跟随系统」，点击在三者间循环并立即生效，右侧用小字显示当前值；用菜单现有的条目组件和图标风格，不新增视觉。
两处都调用 `useNoriTheme().setPreference`。

### 10.9 实施顺序与提交（共 6 个提交，每个提交后跑 §10.10 的深色像素对比）
1. **基线**：先在**未改任何代码**的状态下，按 §10.10 截全套深色基线图（`test-results/theme/baseline-dark/`，不提交）。
2. **令牌与脚本**：新增 `theme.css`、`scripts/theme/tokenize-colors.mjs`、单元测试，`--check` 报告提交到部署记录里（不提交文件）。此时不改任何现有 CSS，深色不变。
3. **令牌改引用**：§10.3 里「现有令牌改引用通道」那一整段（`--fos-*`、`--canvas-*`、`--dm-*`、`--ix-*`、`color-scheme`、`html,body` 背景）。深色对比必须 0 差异。
4. **脚本 `--write`**：批量替换字面量，生成 `theme-generated.css`。深色对比必须 0 差异（允许 ≤ 0.02% 像素因抗锯齿不同；超过就是脚本有 bug，修脚本，不要手改）。
5. **主题机制与强制深色**：`useNoriTheme`、cookie、`layout.tsx`、内联脚本、`nori-force-dark` 类、`theme-colors.ts`、两处切换入口。这一步之后日间模式可用。
6. **日间打磨**：只改日间下发现的问题（对比度、遗漏的硬编码颜色、阴影），每处修复都是改令牌或把字面量换成令牌，**不许为了日间去改深色的取值**。

### 10.10 验证
1. **深色像素对比**（硬指标）：用已有的画廊截图脚手架（记忆文档 `reference-gallery-harness`：`test-results/gallery`，无头 Chrome，CSS zoom 1.2，portal 弹窗要放进 `ViewportDialogLayer`；仓库里 grep `gallery` 找脚本）截下面的页面和状态，对比基线，用 `pixelmatch`（`threshold: 0.1`），差异像素 ≤ 0.02%：
   - 页面：工作台首页、项目列表、素材库（含上传弹窗）、资产库、画布（空画布、50 个节点的画布、选中文本节点带生成面板、选中视频节点）、画布右键菜单、添加节点菜单、视频审阅弹窗（关键帧页和提示词页）、素材选择器、团队管理（含新建账号对话框）、账号设置弹窗、个人中心 API 配置页、后台服务配置页、影游画布、**登录页**（始终深色）；
   - 每个页面 1440×900 一张。
2. **日间截图审查**：同样的页面截日间图，放在 `test-results/theme/light/`；人工看一遍（你自己看截图），重点：文字是否都看得清、有没有「白字在白底」「黑块」「发光边」、媒体预览区是否保持深色、品牌按钮上的字是否是白色、阴影是否过重。
3. **自动对比度审计** `tests/browser/theme-contrast.browser.mjs`：日间模式下遍历每个页面所有可见文本节点，取计算后的文字颜色，向上找第一个不透明背景色（混合半透明层），算对比度；输出 `<3:1` 和 `<4.5:1` 的清单。要求：`<3:1` 的为 0（占位符 `::placeholder` 和 `disabled` 控件除外）；`<4.5:1` 的列在部署记录里并逐条说明为什么可以接受。
4. **切换行为**（浏览器测试 `tests/browser/theme-switch.browser.mjs`）：账号设置里点「日间」→ `html[data-nori-theme="light"]`、cookie `nori-theme=light`、画布背景点阵颜色变了；刷新页面后首屏就是日间（用 `page.setJavaScriptEnabled(false)` 加载一次，断言服务端渲染的 `<html>` 已经带 `data-nori-theme="light"`，证明没有闪烁）；选「跟随系统」并用 `page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])` → 日间；再改成 `dark` → 不刷新页面自动变深色；画布 ☰ 菜单里循环切换同样生效；登录页在日间偏好下仍是深色。
5. **构建产物检查**：`next build` 之后在 `.next/static/css/*.css` 里检查：
   - `grep -o "var(--color-white)" … | wc -l` 非 0（证明 Tailwind 的 `text-white` 仍引用变量，重映射有效；如果是内联成了 `#fff`，说明 `--color-white` 被写成了 `@theme inline`，要改成普通 `@theme`）；
   - 不再有成片的 `rgba(255,255,255,` 字面量（只允许出现在 `.nori-force-dark` / `.nori-auth` / `.nori-admin-login` 规则里和报告里说明的例外）。
6. 在测试机上用真实浏览器画面（无头）各截一张日间画布和日间素材库，附在部署记录里。

## 11. 验证总览

### 11.1 命令（先看 `package.json` 的 `scripts` 确认实际名称，以下是惯例写法）
```bash
npx tsc --noEmit; echo "tsc exit=$?"          # 退出码 0 之后，再确认输出里没有错误行（磁盘满导致依赖被驱逐时会静默 0）
npx vitest run <本批新增的测试文件>              # 单元测试
npx eslint <本批改动的文件>
node tests/browser/<本批的 .browser.mjs>        # 浏览器测试，全部无头
```
- 每批提交前：`tsc`、`eslint`、本批全部新测试、**以及整个现有的单元测试和 `tests/browser` 中与画布相关的用例**（`ls tests/browser | grep -i canvas`）都要通过。
- 浏览器测试沿用 `tests/browser/canvas-pan-performance.browser.mjs` 的启动方式（本机种子账号、无头 Chrome）；本机跑不了就在测试机上跑（R4，只用环境变量里的密码）。
- 新增的浏览器测试清单：`canvas-marquee-legacy-zoom`（B1）、`canvas-add-node-menu`（B2）、`css-viewport-units`（单元，B3）+ 拦截 CSS 的滚动测试（放进 `canvas-picker-scroll.browser.mjs`）、`password-input-usage`（单元，B4）+ 密码眼睛浏览器测试（`account-password-eye.browser.mjs`）、`canvas-text-delete`（E1）、`canvas-text-edit-flow`（E4）、`canvas-text-marks`（E2）、`canvas-video-prompt`（E5）、`theme-switch` 和 `theme-contrast`（E3）。

### 11.2 测试机验收
每批部署测试机后，按本文对应章节的「验证」逐条在测试机上过一遍，结果（通过/不通过、截图路径、数据）写进部署记录。生成类功能（E5 重新生成）在测试机上也**拦截生成接口**，不要真的调用模型。

### 11.3 截图
只用无头 Chrome。放在 `test-results/canvas-editing-theme/<编号>/before|after.png`，部署记录里写路径和一句结论。

## 12. 批次、提交顺序与每批完成标准

| 批次 | 内容 | 提交 | 完成标准 |
|---|---|---|---|
| A | B1 旧内核缩放 + 提示条；B2 右键添加节点菜单 + 面板关闭；B3 dvh 兜底；B4 PasswordInput；B5 三处小改动 | 每个编号至少 1 个提交，共 ≥ 5 个 | §1.3、§2.3、§3.3、§4.3 的验证全部通过；现有画布、素材、账号相关测试全部通过 |
| B | E1 删除墓碑 + 按键防护；E4 单击编辑、⌘V 粘贴、聚焦不滚动 | `fix(canvas): …` 2 个以上 | §6.3、§7.3 全部通过；`resolvePasteDecision`、`selectServerOnlyEntities` 单测通过 |
| C | E2 文本标注（纯函数库 + TextContent 抽取 + 工具条 + 样式） | `feat(canvas): …` 3 个以上（库 / 编辑状态 / 工具条与样式） | §8.7 全部通过；`textMarks` 真实往返测试通过；没有标注的旧节点 DOM 不变 |
| D | E5 对照提示词 | `feat(canvas): …` 2 个以上（解析与面板 / 接入与重新生成） | §9.5 全部通过；原有关键帧测试不变；生成接口被拦截验证 |
| E | E3 日间模式 | 按 §10.9 的 6 个提交 | §10.10 的 6 条全部通过；深色逐像素对比 ≤ 0.02%；对比度审计 `<3:1` 为 0 |

- 上生产：A、B 可以合并成一次放行申请（线上 bug 优先），C、D、E 各自等测试机验收通过后再申请；**同一天只做一次生产上线**（和其它两份方案共用这个限制，由 R6 的放行规则控制）。
- 每批部署记录追加到现有的部署记录文档（`docs/` 下按日期命名的那一份，沿用格式），写：改了什么、测试结果、截图路径、已知限制。
- 回滚：方法同性能方案 R6。本文所有批次都不改表结构、不改接口契约，回滚只需要换回上一个发布产物。数据兼容：`textMarks` 是可选字段，旧版本前端读到会忽略；用户偏好 cookie 旧版本忽略。

### 联系用户的时机（R8 补充）
除性能方案 R8 列的 4 种情况外，只有这两种：
1. §1.3 里在 Chrome 127 上无法复现选框偏差，需要用户提供浏览器版本和 Windows 显示缩放；
2. 批次 E 的日间截图审查中，发现某类页面（例如后台）无法在不改布局的前提下做出可读的日间版，需要用户决定是否排除（先把它加进 `nori-force-dark`，保证不坏，再问）。

## 13. 不做（以及原因）

- **不做富文本节点**（Markdown/HTML、字号、颜色、列表等）：节点文字会被拼进生成提示词，富文本会污染提示词；标注只做加粗和 4 种高亮，满足「重点标注」。
- **不做提示词里的 `@` 引用富文本编辑**（对照提示词面板里）：引用素材由节点的生成配置决定，面板只改文字；要改引用，仍然在生成面板里改。
- **不做跨设备同步的主题偏好**：外观是设备级偏好，用 cookie；不加数据库字段和接口。
- **不做登录页和媒体预览区的日间版**：见 §10.1。
- **不为 IE 和 Chrome < 100 做兼容**：只给提示条（R4）。
- **不重构画布**：本文改动的是现有函数里的几处逻辑；抽出的文件（`graph-merge.ts`、`paste-target.ts`、`text-marks.ts`、`video-prompt.ts`、`CanvasTextContent.tsx`）只是为了能写单元测试，不做其它整理。
- **不改计费、不改生成接口**：E5 的「保存并重新生成」复用现有的生成路径和扣费逻辑。
- **不在本文里重做性能优化**：见性能方案；B5 只补三处小改动。

## 14. 用户控制台清单

本文**没有**需要用户去控制台做的操作。用户只需要在每批测试机验收通过后放行生产上线（R6 / R8）。

