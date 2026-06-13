# Super Agent

Super Agent 是 NoriVideo 的自然语言视频制作助手。它把用户输入的视频需求转换为可执行计划，并复用项目、剧集、GraphRun、Task、Prisma、Worker 和 `skills/` 能力说明生成标准 NoriVideo 项目。

## 工作流

```text
用户输入
  -> 规划：分析意图、选择 Skill、生成项目和执行阶段
  -> 初始化：创建 Project 和 Episode
  -> 故事分析：生成角色、场景、片段和剧本结构
  -> 分镜生成：生成 storyboard、panel、voice line
  -> 工作区：用户继续编辑、生成图片、生成视频和配音
```

## 入口

- 页面：`/zh/super-agent`
- 规划接口：`POST /api/super-agent/plan`
- 执行接口：`POST /api/super-agent/execute`
- 核心代码：`src/lib/super-agent/`
- 技能目录：`skills/`

## 主要文件

```text
src/lib/super-agent/types.ts
src/lib/super-agent/skill-parser.ts
src/lib/super-agent/llm-client.ts
src/lib/super-agent/orchestrator.ts
src/app/api/super-agent/plan/route.ts
src/app/api/super-agent/execute/route.ts
src/components/super-agent/SuperInputBox.tsx
src/app/[locale]/super-agent/page.tsx
```

## 请求示例

```json
{
  "userInput": "制作一个15秒的数字人口播视频，介绍新款智能手表，突出超长续航、健康监测和防水设计。",
  "locale": "zh"
}
```

## 输出结果

执行成功后会返回：

- `executionId`
- `projectId`
- `episodeId`
- 各阶段执行结果
- 工作区地址 `workspaceUrl`
- 错误列表 `errors`

用户随后进入工作区继续编辑角色、场景、分镜、提示词，并按需生成图片、视频、配音或唇形同步。

## Skill 维护

`skills/` 下的 Markdown 是 Super Agent 的视频制作知识来源。新增或调整视频类型时，应同时检查：

- `src/lib/super-agent/skill-parser.ts`
- `src/lib/super-agent/types.ts`
- 对应 `skills/*.md`

Skill 文档应描述适用场景、视觉风格、结构偏好、镜头语言和输出约束，避免写成普通营销文案。

## 当前边界

- Super Agent 主要负责规划、项目初始化、故事分析和分镜生成。
- 图片、视频、配音等后续生产能力通常在工作区中继续触发。
- 执行过程依赖模型配置、队列、数据库和对象存储均可用。

项目整体启动、环境变量、测试和部署说明见 `README.md`。
