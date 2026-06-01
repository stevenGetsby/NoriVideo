# Super Agent MVP - 智能视频制作助手

## 📋 概述

Super Agent 是一个无头化的 AI 视频制作系统，用户只需用自然语言描述需求，系统会自动：
1. 分析意图并生成执行计划
2. 创建项目和剧集
3. 分析故事，生成角色、场景、剧本
4. 生成详细分镜和配音行

**关键特性**：
- ✅ 完全复用现有基础设施（GraphRun、Task、Prisma）
- ✅ 产出标准 NoriVideo 项目，可在工作区中编辑
- ✅ 分阶段执行，每阶段可验证
- ✅ 基于 `skills/` 目录的专业知识

---

## 🏗️ 架构

```
用户输入
    ↓
阶段 0: 规划（LLM 分析意图 → 选择 Skill → 生成计划）
    ↓
阶段 1: 项目初始化（创建 Project + Episode）
    ↓
阶段 2: 故事分析（GraphRun: story-to-script）
    ↓
阶段 3: 分镜生成（GraphRun: script-to-storyboard）
    ↓
跳转到工作区（用户可编辑所有内容）
```

---

## 📁 文件结构

```
src/lib/super-agent/
├── types.ts                 # 类型定义
├── skill-parser.ts          # Skill 解析器
├── llm-client.ts           # LLM 调用封装
├── orchestrator.ts         # 核心编排器
└── index.ts                # 导出

src/app/api/super-agent/
├── plan/route.ts           # POST /api/super-agent/plan
└── execute/route.ts        # POST /api/super-agent/execute

src/components/super-agent/
└── SuperInputBox.tsx       # UI 组件

src/app/[locale]/super-agent/
└── page.tsx                # 测试页面
```

---

## 🚀 使用方法

### 1. 访问测试页面

```
http://localhost:3000/zh/super-agent
```

### 2. 输入需求

在输入框中描述你的视频需求，例如：

```
制作一个15秒的数字人口播视频，介绍我们的新款智能手表。
手表的特点是：超长续航、健康监测、防水设计。
```

### 3. 确认计划

系统会分析你的需求并生成执行计划，显示：
- 项目名称
- 视频类型
- 视频比例
- 视觉风格
- 执行阶段
- 预计耗时

点击"开始执行"确认。

### 4. 等待执行

系统会依次执行：
- 阶段 1：项目初始化（5秒）
- 阶段 2：故事分析与剧本生成（约2分钟）
- 阶段 3：分镜生成（约3分钟）

### 5. 查看结果

执行完成后，系统会显示：
- 发现的角色数量
- 发现的场景数量
- 生成的片段数量
- 生成的分镜格数量
- 生成的配音行数量

然后自动跳转到工作区，你可以：
- 查看和编辑角色、场景
- 查看和编辑分镜板
- 修改分镜提示词
- 继续生成图片、视频

---

## 🔧 API 接口

### POST /api/super-agent/plan

生成执行计划

**请求体**：
```json
{
  "userInput": "制作一个15秒的数字人口播视频...",
  "locale": "zh"
}
```

**响应**：
```json
{
  "plan": {
    "projectConfig": {
      "name": "智能手表宣传视频",
      "videoRatio": "9:16",
      "artStyle": "realistic-photography",
      "artStylePrompt": "写实摄影，干净的灯光..."
    },
    "episodeConfig": {
      "name": "第1集",
      "novelText": "..."
    },
    "selectedSkill": "digital-avatar-ad",
    "skillDescription": "数字人广告与产品视频",
    "stages": [...],
    "estimatedDuration": 305
  }
}
```

### POST /api/super-agent/execute

执行计划

**请求体**：
```json
{
  "plan": { ... },
  "userInput": "...",
  "locale": "zh"
}
```

**响应**：
```json
{
  "result": {
    "executionId": "agent_exec_1234567890",
    "projectId": "proj_xxx",
    "episodeId": "ep_xxx",
    "status": "completed",
    "stageResults": {
      "stage1": {
        "projectId": "proj_xxx",
        "episodeId": "ep_xxx",
        "hasStory": true
      },
      "stage2": {
        "characterCount": 2,
        "locationCount": 3,
        "clipCount": 5,
        "hasScript": true
      },
      "stage3": {
        "storyboardCount": 5,
        "panelCount": 20,
        "voiceLineCount": 15,
        "hasStoryboard": true
      }
    },
    "workspaceUrl": "/workspace/proj_xxx?episode=ep_xxx",
    "summary": "已完成项目初始化和内容生成...",
    "errors": []
  }
}
```

---

## 🎯 支持的 Skill

| Skill ID | 名称 | 描述 | 关键词 |
|----------|------|------|--------|
| `digital-avatar-ad` | 数字人口播 | 产品介绍、品牌宣传 | 数字人、口播、产品、广告 |
| `travel-master` | 旅拍大师 | 旅游vlog、风景展示 | 旅拍、travel、vlog |
| `product-promo` | 商品宣传短片 | 电商、产品展示 | 商品、宣传、电商 |
| `food-documentary` | 舌尖美食 | 美食展示、餐厅宣传 | 美食、food、舌尖 |
| `music-mv` | 音乐MV | 歌曲MV、音乐宣传 | 音乐、music、mv |
| `generic` | 通用视频制作 | 各类视频需求 | 视频、video |

---

## ✅ 验证机制

每个阶段完成后都会验证：

### 阶段 1 验证
```typescript
assert(episode.novelText !== null) // hasStory = true
```

### 阶段 2 验证
```typescript
const readiness = resolveEpisodeStageArtifacts(episode)
assert(readiness.hasScript === true)
assert(characterCount > 0)
assert(locationCount > 0)
assert(clipCount > 0)
```

### 阶段 3 验证
```typescript
const readiness = resolveEpisodeStageArtifacts(episode)
assert(readiness.hasStoryboard === true)
assert(readiness.hasVoice === true)
assert(storyboardCount > 0)
assert(panelCount > 0)
```

---

## 🔍 调试

### 查看 GraphRun 状态

```sql
SELECT id, status, errorMessage, createdAt, finishedAt
FROM graph_runs
WHERE projectId = 'proj_xxx'
ORDER BY createdAt DESC;
```

### 查看生成的资产

```sql
-- 角色
SELECT id, name FROM novel_promotion_characters WHERE novelPromotionProjectId = 'proj_xxx';

-- 场景
SELECT id, name FROM novel_promotion_locations WHERE novelPromotionProjectId = 'proj_xxx';

-- 片段
SELECT id, summary FROM novel_promotion_clips WHERE episodeId = 'ep_xxx';

-- 分镜板
SELECT id, panelCount FROM novel_promotion_storyboards WHERE episodeId = 'ep_xxx';

-- 分镜格
SELECT id, imagePrompt FROM novel_promotion_panels WHERE storyboardId = 'sb_xxx';
```

---

## 🚧 已知限制（MVP 版本）

1. **仅支持阶段 0-3**：项目初始化 → 故事分析 → 分镜生成
2. **不自动生成图片/视频**：需要用户在工作区中手动触发
3. **不支持多轮对话**：每次都是独立的执行
4. **错误处理简单**：失败后需要重新开始

---

## 🔮 未来扩展（V2）

- [ ] 阶段 4：资产生成（自动生成角色和场景图片）
- [ ] 阶段 5：分镜图片生成
- [ ] 阶段 6：配音生成
- [ ] 阶段 7：视频生成
- [ ] 阶段 8：唇形同步
- [ ] 多轮对话优化
- [ ] 更多 Skill 支持（基于 `skills/` 目录）
- [ ] 进度实时推送（SSE）
- [ ] 断点续传

---

## 📝 示例输入

### 数字人口播
```
制作一个15秒的数字人口播视频，介绍我们的新款智能手表。
手表的特点是：超长续航、健康监测、防水设计。
目标受众是年轻的运动爱好者。
```

### 旅拍视频
```
创建一个旅行vlog，记录我在京都的三天旅程。
第一天：清水寺、二年坂、三年坂
第二天：伏见稻荷大社、岚山竹林
第三天：金阁寺、哲学之道
风格要轻松愉快，配上轻音乐。
```

### 美食短片
```
生成一个美食短片，展示传统川菜麻婆豆腐的制作过程。
包括：食材准备、炒制过程、成品展示。
风格参考《舌尖上的中国》，要有纪录片的质感。
```

---

## 🛠️ 开发指南

### 添加新的 Skill

1. 在 `src/lib/super-agent/skill-parser.ts` 中添加定义：

```typescript
'new-skill': {
  id: 'new-skill',
  name: '新技能',
  description: '技能描述',
  keywords: ['关键词1', '关键词2'],
  defaultConfig: {
    videoRatio: '9:16',
    artStyle: 'style-name',
    visualStyle: '视觉风格描述',
  },
}
```

2. 在 `src/lib/super-agent/types.ts` 中添加类型：

```typescript
export type SkillId =
  | 'digital-avatar-ad'
  | 'new-skill'  // 添加这里
  | ...
```

### 自定义工作流

修改 `src/lib/super-agent/orchestrator.ts` 中的 `createExecutionPlan` 方法，根据不同的 Skill 返回不同的阶段配置。

---

## 📞 支持

如有问题，请查看：
- 日志文件：`logs/app.log`
- 数据库状态：检查 `graph_runs` 表
- API 响应：使用浏览器开发者工具查看网络请求

---

## 📄 许可证

与 NoriVideo 主项目相同
