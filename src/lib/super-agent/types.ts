/**
 * Super Agent Types
 * MVP 版本：支持阶段 0-3（规划 → 项目初始化 → 故事分析 → 分镜生成）
 */

export type BuiltinSkillId =
  | 'digital-avatar-ad'      // 数字人口播
  | 'travel-master'          // 旅拍大师
  | 'product-promo'          // 商品宣传短片
  | 'food-documentary'       // 舌尖美食
  | 'music-mv'               // 音乐MV
  | 'generic'                // 通用视频制作

export type SkillId = BuiltinSkillId | (string & {})

export type AgentExecutionMode = 'mock' | 'live'

export interface AgentCreativeParameters {
  durationSeconds?: number
  targetAudience?: string
  tone?: string
  sellingPoints?: string
  callToAction?: string
  narration?: 'auto' | 'on' | 'off'
  shotCount?: number
  panelsPerShot?: number
  mockPrompt?: string
  storyboardOnly?: boolean
}

export interface AgentContext {
  userId: string
  locale: string
  userInput: string
  executionMode?: AgentExecutionMode
  parameters?: Partial<AgentCreativeParameters>
  targetProjectId?: string
  workflowRunId?: string
}

export interface AgentExecutionPlan {
  // 项目配置
  projectConfig: {
    name: string
    videoRatio: '9:16' | '16:9' | '1:1'
    artStyle: string
    artStylePrompt?: string
  }

  // Episode 配置
  episodeConfig: {
    name: string
    novelText: string
  }

  // 选择的 Skill
  selectedSkill: SkillId
  skillDescription: string

  // 执行模式与可调创作参数
  executionMode: AgentExecutionMode
  creativeParameters: AgentCreativeParameters

  // 工作流阶段
  stages: AgentStage[]

  // 估算
  estimatedDuration: number // 秒
}

export interface AgentStage {
  stageId: string
  stageNumber: number
  title: string
  description: string
  estimatedDuration: number
  status: 'pending' | 'running' | 'completed' | 'failed'
}

export interface AgentExecutionResult {
  executionId: string
  projectId: string
  episodeId: string
  status: 'completed' | 'partial' | 'failed'

  // 各阶段结果
  stageResults: {
    stage1: {
      projectId: string
      episodeId: string
      hasStory: boolean
    }
    stage2?: {
      characterCount: number
      locationCount: number
      clipCount: number
      hasScript: boolean
    }
    assetConsistency?: {
      characterCount: number
      locationCount: number
      propCount: number
      clipCount: number
      hasConsistencyBrief: boolean
      characterAppearanceCount?: number
      locationImageSlotCount?: number
      propImageSlotCount?: number
    }
    assetImageGeneration?: {
      characterAppearanceCount: number
      locationImageCount: number
      propImageCount: number
      skippedExistingImageCount: number
      submittedTaskCount: number
      completedTaskCount: number
      failedTaskCount: number
      hasAssetImages: boolean
      taskIds: string[]
    }
    stage3?: {
      storyboardCount: number
      panelCount: number
      voiceLineCount: number
      hasStoryboard: boolean
    }
    imageGeneration?: {
      panelCount: number
      skippedExistingImageCount: number
      submittedTaskCount: number
      completedTaskCount: number
      failedTaskCount: number
      hasImages: boolean
      taskIds: string[]
    }
    videoGeneration?: {
      panelCount: number
      skippedMissingImageCount: number
      skippedMissingVideoModel?: boolean
      skippedExistingVideoCount: number
      submittedTaskCount: number
      completedTaskCount: number
      failedTaskCount: number
      hasVideos: boolean
      taskIds: string[]
    }
  }

  // 工作区链接
  workspaceUrl: string

  summary: string
  errors: string[]
}

export interface LLMAnalysisResult {
  videoType: SkillId
  storyText: string
  videoRatio: '9:16' | '16:9' | '1:1'
  visualStyle: string
  projectName: string
  episodeName: string
  language: 'zh' | 'en'
  confidence: number
  creativeParameters?: Partial<AgentCreativeParameters>
}
