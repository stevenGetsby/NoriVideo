# NoriVideo Terminology Glossary

本文档整理项目中的中英文术语对照，优先覆盖 `prisma/schema.prisma` 中的数据对象命名。

## 命名原则

| English | 中文建议 | 说明 |
| --- | --- | --- |
| Project | 项目 | 顶层视频创作项目。 |
| Episode | 剧集 | 一个项目下的单集内容。 |
| Clip | 片段 | 从剧本/小说文本切出的剧情片段。 |
| Storyboard | 分镜组 | 对应一个片段的完整分镜集合；口语中也可简称“分镜”。 |
| Panel | 分镜 | 分镜组中的单个画面/格。避免翻译成“面板”。 |
| Shot | 镜头 | 更偏电影语言的镜头稿/镜头记录。 |
| Character | 角色 | 人物或拟人化对象。 |
| Location | 场景 | 拍摄/叙事发生的地点或环境；当 `assetKind=prop` 时表示道具。 |
| Prop | 道具 | 当前落在 location-like 资产结构中，通过 `assetKind=prop` 区分。 |
| Voice | 音色 | 可复用的声音身份或 TTS voice。 |
| Voice Line | 配音台词 | 一条可生成音频的台词。 |
| Asset | 资产 | 可复用的角色、场景、道具、音色、媒体等。 |
| Material | 素材 | FrameOS 中偏生产素材库的图片/视频/音频资源。 |
| Media Object | 媒体对象 | 归一化后的图片/视频/音频存储对象。 |
| Task | 任务 | BullMQ/数据库中的异步执行任务。 |
| Run / GraphRun | 运行 / 图运行 | 多步骤 workflow 的一次执行实例。 |
| Step | 步骤 | GraphRun 中的单个执行步骤。 |
| Artifact | 产物 | 运行步骤产生的可追溯输出。 |
| Checkpoint | 检查点 | 运行恢复用的状态快照。 |
| Canvas | 画布 | 工作区中的节点式创作画布。 |
| Node | 节点 | 画布上的一个能力/内容单元。 |
| Edge | 连线 | 画布节点之间的数据连接。 |
| Workflow | 工作流 | 阶段化视频制作流程。 |
| Stage | 阶段 | 工作流中的制作阶段。 |
| Export | 导出 | 打包交付视频、素材包、剪映草稿等。 |
| Billing | 计费 | 成本、余额、冻结、交易流水相关能力。 |

## Prisma 数据对象对照

| Prisma model | 中文术语 | 业务域 |
| --- | --- | --- |
| `Account` | 第三方账号 | 认证 |
| `Session` | 登录会话 | 认证 |
| `VerificationToken` | 验证令牌 | 认证 |
| `User` | 用户 | 用户 |
| `UserPreference` | 用户偏好 / 用户配置 | 用户配置 |
| `WorkspaceTeamProfile` | 工作区团队配置 | 工作区 |
| `WorkspaceTeamSeat` | 工作区团队席位 | 工作区 |
| `Project` | 项目 | 项目 |
| `NovelPromotionProject` | 小说推文项目配置 | 小说推文 / 短剧生产 |
| `NovelPromotionEpisode` | 小说推文剧集 | 小说推文 / 短剧生产 |
| `NovelPromotionClip` | 小说推文片段 | 小说推文 / 短剧生产 |
| `NovelPromotionStoryboard` | 小说推文分镜组 | 小说推文 / 短剧生产 |
| `NovelPromotionPanel` | 小说推文分镜 | 小说推文 / 短剧生产 |
| `NovelPromotionShot` | 小说推文镜头 | 小说推文 / 短剧生产 |
| `SupplementaryPanel` | 补充分镜 | 小说推文 / 短剧生产 |
| `NovelPromotionCharacter` | 小说推文角色 | 小说推文 / 资产 |
| `CharacterAppearance` | 角色形象 | 小说推文 / 资产 |
| `NovelPromotionLocation` | 小说推文场景 / 道具 | 小说推文 / 资产 |
| `LocationImage` | 场景图片 / 道具图片 | 小说推文 / 资产 |
| `NovelPromotionVoiceLine` | 小说推文配音台词 | 小说推文 / 配音 |
| `VoicePreset` | 音色预设 | 配音 |
| `VideoEditorProject` | 视频编辑器项目 | 视频编辑 |
| `VideoEnhanceTask` | 视频增强任务 | 视频增强 |
| `Canvas` | 画布 | 画布工作区 |
| `CanvasNode` | 画布节点 | 画布工作区 |
| `CanvasEdge` | 画布连线 | 画布工作区 |
| `WorkflowStageState` | 工作流阶段状态 | 工作流 |
| `ExportHistoryRecord` | 导出历史记录 | 导出 |
| `ExportQueueRecord` | 导出队列记录 | 导出 |
| `WorkspaceFeedbackRecord` | 工作区反馈记录 | 工作区 |
| `SystemUpdateCheckRecord` | 系统更新检查记录 | 系统 |
| `Task` | 任务 | 异步任务 |
| `TaskEvent` | 任务事件 | 异步任务 |
| `GraphRun` | 图运行 / 工作流运行 | 运行时 |
| `GraphStep` | 图步骤 / 运行步骤 | 运行时 |
| `GraphStepAttempt` | 步骤尝试 | 运行时 |
| `GraphEvent` | 图事件 / 运行事件 | 运行时 |
| `GraphCheckpoint` | 图检查点 | 运行时 |
| `GraphArtifact` | 图产物 / 运行产物 | 运行时 |
| `GlobalAssetFolder` | 全局资产文件夹 | 资产中心 |
| `GlobalCharacter` | 全局角色 | 资产中心 |
| `GlobalCharacterAppearance` | 全局角色形象 | 资产中心 |
| `GlobalLocation` | 全局场景 / 全局道具 | 资产中心 |
| `GlobalLocationImage` | 全局场景图片 / 全局道具图片 | 资产中心 |
| `GlobalVoice` | 全局音色 | 资产中心 |
| `MediaObject` | 媒体对象 | 媒体 / 存储 |
| `LegacyMediaRefBackup` | 旧媒体引用备份 | 媒体迁移 |
| `UsageCost` | 使用成本 | 计费 |
| `UserBalance` | 用户余额 | 计费 |
| `BalanceFreeze` | 余额冻结 | 计费 |
| `BalanceTransaction` | 余额交易流水 | 计费 |
| `FrameosMaterial` | FrameOS 素材 | FrameOS |
| `FrameosScript` | FrameOS 剧本 | FrameOS |
| `FrameosWorld` | FrameOS 世界观 | FrameOS |
| `FrameosArtDirection` | FrameOS 美术指导 | FrameOS |
| `FrameosScreenwriterEpisode` | FrameOS 编剧剧集 | FrameOS |
| `FrameosDirectorEpisode` | FrameOS 导演剧集 | FrameOS |
| `FrameosProductionScene` | FrameOS 制作场景 | FrameOS |
| `FrameosProductionShot` | FrameOS 制作镜头 | FrameOS |
| `FrameosProductionBgmTask` | FrameOS 背景音乐任务 | FrameOS |
| `FrameosToolboxAsset` | FrameOS 工具箱资产 | FrameOS |
| `FrameosToolboxPromptHistory` | FrameOS 工具箱提示词历史 | FrameOS |

## 常见字段与概念

| English / field | 中文建议 | 说明 |
| --- | --- | --- |
| `storyboardImageUrl` | 分镜图 URL | 分镜组整体图。 |
| `storyboardTextJson` | 分镜文本 JSON | 结构化分镜文本。 |
| `panelIndex` | 分镜序号 | 从 0 或业务约定序号开始的索引。 |
| `panelNumber` | 分镜编号 | 展示用编号。 |
| `shotType` | 景别 | 如远景、中景、近景、特写。 |
| `cameraMove` | 运镜 | 镜头运动方式。 |
| `sceneType` | 场景类型 | 分镜场景分类。 |
| `imagePrompt` | 图片提示词 | 生成图片用 prompt。 |
| `videoPrompt` | 视频提示词 | 生成视频用 prompt。 |
| `firstLastFramePrompt` | 首尾帧提示词 | 首尾帧模式生成视频用 prompt。 |
| `lipSync` | 唇形同步 | 口型/嘴型与音频同步。 |
| `srtContent` | SRT 字幕内容 | 剧集级字幕文本。 |
| `srtSegment` | SRT 字幕片段 | 分镜级字幕片段。 |
| `speaker` | 发言人 | 配音台词所属角色/旁白。 |
| `voicePreset` | 音色预设 | 系统预置或可选择的声音。 |
| `voiceMapping` | 音色匹配 | 将角色/发言人与音色绑定。 |
| `customVoiceUrl` | 自定义音色 URL | 用户上传或指定的参考音频。 |
| `profileData` | 角色档案数据 | 角色结构化设定 JSON。 |
| `profileConfirmed` | 角色档案已确认 | 用户或流程确认角色设定。 |
| `appearanceIndex` | 形象序号 | 同一角色的多个形象版本。 |
| `changeReason` | 形象变化原因 | 角色形象版本的来源/变化说明。 |
| `selectedImage` | 已选图片 | 当前采用的场景/道具图片。 |
| `assetKind` | 资产类型 | 常见值：`location` 场景、`prop` 道具。 |
| `renderStatus` | 渲染状态 | 视频编辑器/导出渲染进度状态。 |
| `storageKey` | 存储键 | 对象存储中的 key。 |
| `publicId` | 公开 ID | 媒体对象的稳定公开标识。 |
| `targetType` | 目标类型 | 任务或运行绑定的目标类型，如 panel。 |
| `targetId` | 目标 ID | 任务或运行绑定的目标记录 ID。 |
| `dedupeKey` | 去重键 | 防止重复提交任务。 |
| `leaseOwner` | 租约持有者 | GraphRun 当前执行进程标识。 |
| `leaseExpiresAt` | 租约过期时间 | 判断运行是否可恢复/接管。 |
| `heartbeatAt` | 心跳时间 | 任务或运行存活信号。 |
| `billedAt` | 已计费时间 | 任务完成计费时间点。 |
| `billingInfo` | 计费信息 | 任务计费详情。 |
| `capabilityOverrides` | 能力覆盖配置 | 项目级模型能力覆盖。 |
| `workflowMode` | 工作流模式 | 项目制作流程模式。 |
| `artStyle` | 美术风格 | 项目或资产生成风格。 |
| `projectStyle` | 项目风格 | 如真人短剧、动画等生产风格。 |
| `targetAudience` | 目标受众 | 面向平台/地区/人群的配置。 |

