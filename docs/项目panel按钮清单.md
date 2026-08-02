# 项目 Panel 流程按钮清单

范围：`/workflow/[projectId]/workbench-premium2` 项目工作台流程。

说明：
- “按钮”包含真实 `<button>`，以及视觉上作为按钮使用的 `<Link className="fos-btn...">`。
- 动态列表按钮用模板表示，例如 `E{n}`、`{资产名称}`、`{镜头}`。
- “当前行为”按当前前端代码整理；标记为“占位/演示禁用”的按钮目前没有真实后端动作或被 `disabled`。

## 入口与全局区域

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-001 | 项目顶栏 | 返回图标 | Link | 返回项目列表或项目工作台总览。 | `src/components/frameos/FosProjectHeader.tsx` |
| PP-002 | 全局顶栏 | NoriVideo Logo | Link | 跳转到 `/projects`。 | `src/components/frameos/FosShell.tsx` |
| PP-003 | 全局顶栏 | 下载桌面端 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/FosShell.tsx` |
| PP-004 | 全局顶栏 | 余额胶囊 | button | 展开/收起余额浮层。 | `src/components/frameos/FosShell.tsx` |
| PP-005 | 余额浮层 | 立即充值 | button | 占位按钮，标题提示“演示已禁用”。 | `src/components/frameos/FosShell.tsx` |
| PP-006 | 余额浮层 | 查看明细 | Link | 跳转到 `/service-records`。 | `src/components/frameos/FosShell.tsx` |

## 项目工作台总览

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-101 | Step 1 剧本解析 | 查看解析详情 | Link | 进入 `script-review` 页面。 | `src/components/frameos/views/FosWorkbenchOverview.tsx` |
| PP-102 | Step 2 资产设定 | 设定 | Link | 进入角色资产页 `assets/characters`。 | `src/components/frameos/views/FosWorkbenchOverview.tsx` |
| PP-103 | Step 2 资产行 | 设定 | Link | 按行进入角色/物品/环境资产页。 | `src/components/frameos/views/FosWorkbenchOverview.tsx` |
| PP-104 | Step 2 音色行 | 设置 | Link | 进入音色页 `assets/timbre`。 | `src/components/frameos/views/FosWorkbenchOverview.tsx` |
| PP-105 | Step 3 分镜设计 | 进入分镜设计 | Link | 进入 `storyboard` 页面。 | `src/components/frameos/views/FosWorkbenchOverview.tsx` |
| PP-106 | Step 4 制作剪辑 | 时间线 · 组装预览 | Link | 进入 `production/timeline` 页面。 | `src/components/frameos/views/FosWorkbenchOverview.tsx` |
| PP-107 | Step 4 制作剪辑 | 导出交付 | button | 打开导出交付弹窗。 | `src/components/frameos/views/FosWorkbenchOverview.tsx` |

## 剧本解析结果

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-201 | 左侧分集列表 | `E{n} {剧集名}` | button | 切换当前查看/编辑的剧集。 | `src/components/frameos/views/FosScriptReview.tsx` |
| PP-202 | 空分集/待处理 | 开始解析 | button | 调用 `/api/novel-promotion/{projectId}/import-pipeline` 后刷新项目数据。 | `src/components/frameos/views/FosScriptReview.tsx` |
| PP-203 | 空分集/失败 | 重新解析 | button | 调用 `/api/novel-promotion/{projectId}/import-pipeline` 后刷新项目数据。 | `src/components/frameos/views/FosScriptReview.tsx` |
| PP-204 | 底部操作栏 | 审阅通过 | button | 演示数据时禁用。 | `src/components/frameos/views/FosScriptReview.tsx` |
| PP-205 | 底部操作栏 | 保存并审阅通过 | button | 保存当前集正文，再调用工作流 config 阶段 approve 接口。 | `src/components/frameos/views/FosScriptReview.tsx` |
| PP-206 | 底部操作栏 | 保存修改 | button | 已审阅通过时，仅保存当前集正文并刷新。 | `src/components/frameos/views/FosScriptReview.tsx` |

## 资产设定通用导航

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-301 | 资产 Tab | 角色 | Link | 进入 `assets/characters`。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-302 | 资产 Tab | 物品 | Link | 进入 `assets/items`。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-303 | 资产 Tab | 环境 | Link | 进入 `assets/environments`。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-304 | 资产 Tab | 音色 | Link | 进入 `assets/timbre`。 | `src/components/frameos/views/FosAssetShared.tsx` |

## 角色/物品/环境资产设定

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-401 | 左侧列表标题 | +新增 | button | 打开新增资产弹窗。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-402 | 左侧资产列表 | `{资产名称}` | button | 切换当前选中资产。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-403 | 顶部操作 | 补充提取 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-404 | 顶部操作 | 重新提取 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-405 | 顶部操作 | 一键生成主图和变体图 / 一键生成 | button | 为当前资产提交生图任务；角色会提交主图和变体图，物品/环境提交单图。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-406 | 提示词区域 | 保存描述 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-407 | 出场集区域 | 出场集 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-408 | 出场集区域 | 全部选中 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-409 | 出场集区域 | 全部清除 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-410 | 设定图区域 | 生图历史 | button | 展开/收起生图历史面板。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-411 | 生图历史面板 | 展示失败记录 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-412 | 设定图区域 | 放大查看图标 | button | 打开图片放大弹窗。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-413 | 设定图操作 | 生成 | button | 为当前资产提交生图任务。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-414 | 设定图操作 | 重新生成 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-415 | 设定图操作 | AI 修改图片 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-416 | 设定图操作 | 导入素材 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-417 | 底部操作栏 | 一键生成全部主图和变体图 / 一键生成全部 | button | 遍历当前 tab 全部资产并提交生图任务。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-418 | 底部操作栏 | 补充提取 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-419 | 底部操作栏 | 取消 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |
| PP-420 | 底部操作栏 | 取消确认 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosAssetSetting.tsx` |

## 新增资产弹窗与图片放大弹窗

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-451 | 新增资产弹窗 | 关闭图标 | button | 关闭新增资产弹窗。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-452 | 新增资产弹窗 | 选择出场集 | button | 展开/收起出场集选择区。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-453 | 新增资产弹窗 | `E{n}` | button | 占位剧集选择按钮，目前未持久化选择状态。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-454 | 新增资产弹窗 | 取消 | button | 关闭弹窗。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-455 | 新增资产弹窗 | 确定 | button | 提交表单后关闭弹窗；目前未写入后端。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-456 | 图片放大弹窗 | 关闭图标 | button | 关闭图片放大弹窗。 | `src/components/frameos/views/FosAssetShared.tsx` |

## 音色设置

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-501 | 左侧角色列表 | `{角色名}` | button | 切换当前设置音色的角色。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-502 | 左侧底部 | 一键试镜 | button | 禁用；标题提示演示已禁用。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-503 | 音色方式 Tab | Seedance 试镜 | button | 切换到 Seedance 试镜方式。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-504 | 音色方式 Tab | 音色库选择 | button | 切换到音色库说明区域。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-505 | 音色方式 Tab | 本地上传 | button | 切换到本地上传区域。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-506 | 音色方式说明 | seedance 试镜说明 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-507 | Seedance 试镜 | 放大查看 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-508 | Seedance 试镜 | 从 SD2 视频中提取音色 | button | 禁用；标题提示余额不足/演示已禁用。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-509 | 候选音色 | 查看更多 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-510 | 候选音色 | 试听 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-511 | 候选音色 | 选用 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-512 | 本地上传 | 试听音色 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosTimbre.tsx` |
| PP-513 | 本地上传 | 使用该音色 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosTimbre.tsx` |

## 分镜设计

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-601 | 分集 Tab | `E{n} {剧集名}` | button | 切换当前分镜剧集。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-602 | 分集 Tab | 展开全部 `{n}` 集 | button | 展开全部剧集 tab。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-603 | 片段卡片 | 删除图标 `✕` | button | 占位删除按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-604 | 片段卡片 | 展开详情图标 `›` | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-605 | 片段卡片 | 剧本原文 | button | 展开/收起当前片段剧本原文。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-606 | 当前集头部 | 重新设计本集分镜 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-607 | 参考资产缩略图 | 替换 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-608 | 参考资产分组 | 添加 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-609 | 右侧参考资产 | 参考前一镜视频 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-610 | 右侧参考资产 | 添加额外参考素材 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-611 | 底部操作栏 | 插入片段 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-612 | 底部操作栏 | 确认本集分镜 | button | 禁用；标题提示后端操作演示已禁用。 | `src/components/frameos/views/FosStoryboard.tsx` |
| PP-613 | 失败场景行 | 重试 · 按量计费 | button | 禁用；标题提示按量计费演示已禁用。 | `src/components/frameos/views/FosStoryboard.tsx` |

## 制作剪辑：选择分集

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-701 | 分集列表 | 进入时间线 | Link | 进入 `production/timeline` 页面。 | `src/components/frameos/views/FosProduction.tsx` |
| PP-702 | 分集列表 | 查看分镜 | Link | 进入 `storyboard` 页面。 | `src/components/frameos/views/FosProduction.tsx` |

## 制作剪辑：时间线组装

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-751 | 顶部操作 | 导出交付 | button | 打开导出交付弹窗。 | `src/components/frameos/views/FosProduction.tsx` |
| PP-752 | 预览播放器 | 上一段图标 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosProduction.tsx` |
| PP-753 | 预览播放器 | 播放/暂停图标 | button | 切换本地播放图标状态。 | `src/components/frameos/views/FosProduction.tsx` |
| PP-754 | 预览播放器 | 下一段图标 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosProduction.tsx` |
| PP-755 | 剧集下拉 | `E{n} {剧集名}` 当前项 | button | 展开/收起剧集下拉菜单。 | `src/components/frameos/views/FosProduction.tsx` |
| PP-756 | 剧集下拉菜单 | `E{n} {剧集名}` | button | 切换时间线当前剧集。 | `src/components/frameos/views/FosProduction.tsx` |
| PP-757 | 右侧操作 | 一键生成 | button | 禁用；标题提示后端生成操作演示已禁用。 | `src/components/frameos/views/FosProduction.tsx` |

## 镜头制作工作台

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-801 | 左侧镜头列表 | `{场景} · {镜头ID}` | button | 切换当前镜头。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-802 | 镜头顶部操作 | 复用参数 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-803 | 镜头顶部操作 | 申诉 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-804 | 中部 Tab | 生成历史 | button | 切换中部信息 Tab。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-805 | 中部 Tab | 导入 | button | 切换中部信息 Tab。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-806 | 中部 Tab | 视频增强 | button | 切换中部信息 Tab。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-807 | 中部 Tab | 字幕擦除 | button | 切换中部信息 Tab。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-808 | 参考资产 | 添加（角色） | button | 打开角色参考资产选择弹窗。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-809 | 参考资产 | 添加（物品） | button | 打开物品参考资产选择弹窗。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-810 | 参考资产 | 添加（环境） | button | 打开环境参考资产选择弹窗。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-811 | 参考资产 | 参考前一镜视频 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-812 | 参考资产 | 添加额外参考素材 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-813 | 输出参数 | 视频模型下拉 | button | 展开/收起模型菜单。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-814 | 输出参数 | 分辨率下拉 | button | 展开/收起分辨率菜单。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-815 | 输出参数 | 视频秒数下拉 | button | 展开/收起时长菜单。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-816 | 输出参数菜单 | `{模型/分辨率/时长选项}` | button | 选择本地下拉值。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-817 | 视频提示词 | 展开编辑 | button | 打开提示词大编辑弹窗。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-818 | 画风描述 | 优化提示词 | button | 占位按钮，无实际 onClick。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-819 | 右侧底部 | 生成视频 | button | 禁用；标题提示后端生成操作演示已禁用。 | `src/components/frameos/views/FosProductionShot.tsx` |

## 镜头制作弹窗

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-851 | 选择参考资产弹窗 | 关闭图标 | button | 关闭选择参考资产弹窗。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-852 | 选择参考资产弹窗 | `{资产名称}` 卡片 | button | 打开图片放大弹窗；当前未绑定选择/确认逻辑。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-853 | 图片放大弹窗 | 关闭图标 | button | 关闭图片放大弹窗。 | `src/components/frameos/views/FosAssetShared.tsx` |
| PP-854 | 编辑正文提示词弹窗 | 关闭图标 | button | 关闭提示词编辑弹窗。 | `src/components/frameos/views/FosProductionShot.tsx` |
| PP-855 | 编辑正文提示词弹窗 | 完成 | button | 关闭提示词编辑弹窗；当前未回写主提示词。 | `src/components/frameos/views/FosProductionShot.tsx` |

## 导出交付弹窗

| ID | 页面/区域 | 按钮文案 | 类型 | 当前行为 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| PP-901 | 导出交付弹窗 | 关闭图标 | button | 关闭导出弹窗。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-902 | 导出类型 Tab | 资产包 | button | 切换到资产包导出配置。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-903 | 导出类型 Tab | 剪映草稿 | button | 切换到剪映草稿说明。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-904 | 导出类型 Tab | 成片 | button | 切换到成片导出配置。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-905 | 选择剧集 | 全选 | button | 选中全部剧集。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-906 | 选择剧集 | 清空 | button | 清空全部剧集选择。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-907 | 选择剧集 | `E{n}` | button | 切换单集是否选中。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-908 | 资产包配置 | 角色图片 | button | 切换该资产类型是否导出。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-909 | 资产包配置 | 物品图片 | button | 切换该资产类型是否导出。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-910 | 资产包配置 | 环境图片 | button | 切换该资产类型是否导出。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-911 | 资产包配置 | 分镜视频 | button | 切换该资产类型是否导出。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-912 | 资产包配置 | BGM | button | 切换该资产类型是否导出。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-913 | 底部操作 | 取消 | button | 关闭导出弹窗。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-914 | 底部操作 | 导出资产包 | button | 当前只显示按钮，未绑定后端导出动作。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-915 | 底部操作 | 导出剪映草稿 | button | 当前只显示按钮，未绑定后端导出动作。 | `src/components/frameos/ExportDeliveryDialog.tsx` |
| PP-916 | 底部操作 | 导出成片 | button | 当前只显示按钮，未绑定后端导出动作。 | `src/components/frameos/ExportDeliveryDialog.tsx` |

