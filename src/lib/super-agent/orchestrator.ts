/**
 * Super Agent Orchestrator - MVP 版本
 * 核心编排器：阶段 0-3（规划 → 项目初始化 → 故事分析 → 分镜生成）
 */

import { prisma } from '@/lib/prisma'
import { llmClient } from './llm-client'
import { skillLibrary } from './skill-parser'
import { resolveEpisodeStageArtifacts } from '@/lib/novel-promotion/stage-readiness'
import { createRun } from '@/lib/run-runtime/service'
import { TASK_TYPE } from '@/lib/task/types'
import { getUserModelConfig } from '@/lib/config-service'
import {
  createDeterministicAnalysis,
  normalizeCreativeParameters,
  normalizeExecutionMode,
} from './plan-utils'
import {
  createMockScriptArtifacts,
  createMockStoryboardArtifacts,
} from './mock-execution'
import type {
  AgentContext,
  AgentExecutionPlan,
  AgentExecutionResult,
  LLMAnalysisResult,
} from './types'

export class SuperAgentOrchestrator {
  /**
   * 阶段 0：生成执行计划
   */
  async createExecutionPlan(context: AgentContext): Promise<AgentExecutionPlan> {
    // 1. 使用 LLM 分析用户输入
    const executionMode = normalizeExecutionMode(context.executionMode)
    const creativeParameters = normalizeCreativeParameters(context.parameters)
    const analysis = executionMode === 'mock'
      ? createDeterministicAnalysis(context.userInput)
      : await this.analyzeUserInput(context)

    // 2. 获取 Skill 定义
    const skill = skillLibrary.getSkill(analysis.videoType)
    if (!skill) {
      throw new Error(`Skill not found: ${analysis.videoType}`)
    }

    // 3. 构建执行计划
    const plan: AgentExecutionPlan = {
      projectConfig: {
        name: analysis.projectName,
        videoRatio: analysis.videoRatio,
        artStyle: skill.defaultConfig.artStyle,
        artStylePrompt: analysis.visualStyle || skill.defaultConfig.visualStyle,
      },
      episodeConfig: {
        name: analysis.episodeName,
        novelText: analysis.storyText,
      },
      selectedSkill: analysis.videoType,
      skillDescription: skill.description,
      executionMode,
      creativeParameters,
      stages: [
        {
          stageId: 'stage_1',
          stageNumber: 1,
          title: '项目初始化',
          description: '创建项目和剧集',
          estimatedDuration: 5,
          status: 'pending',
        },
        {
          stageId: 'stage_2',
          stageNumber: 2,
          title: '故事分析与剧本生成',
          description: '分析角色、场景、道具，切分片段，生成剧本',
          estimatedDuration: 120,
          status: 'pending',
        },
        {
          stageId: 'stage_3',
          stageNumber: 3,
          title: '分镜生成',
          description: '根据剧本生成详细分镜，包括摄影计划和演技指导',
          estimatedDuration: 180,
          status: 'pending',
        },
      ],
      estimatedDuration: 305, // 总计约 5 分钟
    }

    return plan
  }

  /**
   * 执行计划
   */
  async executePlan(
    plan: AgentExecutionPlan,
    context: AgentContext,
    onProgress?: (stage: string, percent: number) => void
  ): Promise<AgentExecutionResult> {
    const executionId = `agent_exec_${Date.now()}`
    const errors: string[] = []

    try {
      // 阶段 1：项目初始化
      onProgress?.('项目初始化', 10)
      const stage1Result = await this.executeStage1(plan, context)
      plan.stages[0].status = 'completed'

      const { projectId, episodeId } = stage1Result

      // 阶段 2：故事分析与剧本生成
      onProgress?.('故事分析与剧本生成', 30)
      const stage2Result = plan.executionMode === 'mock'
        ? await createMockScriptArtifacts({ projectId, episodeId, plan })
        : await this.executeStage2(projectId, episodeId, context)
      plan.stages[1].status = 'completed'

      // 阶段 3：分镜生成
      onProgress?.('分镜生成', 60)
      const stage3Result = plan.executionMode === 'mock'
        ? await createMockStoryboardArtifacts({ episodeId, plan })
        : await this.executeStage3(projectId, episodeId, context)
      plan.stages[2].status = 'completed'

      onProgress?.('完成', 100)

      return {
        executionId,
        projectId,
        episodeId,
        status: 'completed',
        stageResults: {
          stage1: stage1Result,
          stage2: stage2Result,
          stage3: stage3Result,
        },
        workspaceUrl: `/${context.locale || 'zh'}/workspace/${projectId}?episode=${episodeId}`,
        summary: this.generateSummary(stage2Result, stage3Result),
        errors,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      errors.push(errorMessage)
      throw error
    }
  }

  /**
   * 阶段 1：项目初始化
   */
  private async executeStage1(
    plan: AgentExecutionPlan,
    context: AgentContext
  ): Promise<{
    projectId: string
    episodeId: string
    hasStory: boolean
  }> {
    // 1. 创建 Project
    const userConfig = await getUserModelConfig(context.userId)
    const project = await prisma.project.create({
      data: {
        name: plan.projectConfig.name,
        description: `Created by Super Agent (${plan.executionMode})`,
        userId: context.userId,
      },
    })

    // 2. 创建 NovelPromotionProject
    const novelPromotionProject = await prisma.novelPromotionProject.create({
      data: {
        projectId: project.id,
        videoRatio: plan.projectConfig.videoRatio,
        artStyle: plan.projectConfig.artStyle,
        artStylePrompt: plan.projectConfig.artStylePrompt,
        analysisModel: userConfig.analysisModel,
        characterModel: userConfig.characterModel,
        locationModel: userConfig.locationModel,
        storyboardModel: userConfig.storyboardModel,
        editModel: userConfig.editModel,
        videoModel: userConfig.videoModel,
        audioModel: userConfig.audioModel,
        videoResolution: '1080p',
        imageResolution: '2K',
      },
    })

    // 3. 创建 Episode（使用 NovelPromotionProject.id）
    const episode = await prisma.novelPromotionEpisode.create({
      data: {
        novelPromotionProjectId: novelPromotionProject.id,
        episodeNumber: 1,
        name: plan.episodeConfig.name,
        novelText: plan.episodeConfig.novelText,
      },
    })

    await prisma.novelPromotionProject.update({
      where: { id: novelPromotionProject.id },
      data: { lastEpisodeId: episode.id },
    })

    return {
      projectId: project.id,
      episodeId: episode.id,
      hasStory: true,
    }
  }

  /**
   * 阶段 2：故事分析与剧本生成
   */
  private async executeStage2(
    projectId: string,
    episodeId: string,
    context: AgentContext
  ): Promise<{
    characterCount: number
    locationCount: number
    clipCount: number
    hasScript: boolean
  }> {
    // 创建 story-to-script GraphRun
    const run = await createRun({
      userId: context.userId,
      projectId,
      episodeId,
      workflowType: TASK_TYPE.STORY_TO_SCRIPT_RUN,
      taskType: TASK_TYPE.STORY_TO_SCRIPT_RUN,
      targetType: 'episode',
      targetId: episodeId,
      input: {},
    })

    // 等待 Run 完成
    await this.waitForRunCompletion(run.id, 300000) // 5 分钟超时

    // 验证结果
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        clips: true,
      },
    })

    const project = await prisma.novelPromotionProject.findUnique({
      where: { projectId },
      include: {
        characters: true,
        locations: true,
      },
    })

    const readiness = resolveEpisodeStageArtifacts(episode)

    return {
      characterCount: project?.characters.length || 0,
      locationCount: project?.locations.length || 0,
      clipCount: episode?.clips.length || 0,
      hasScript: readiness.hasScript,
    }
  }

  /**
   * 阶段 3：分镜生成
   */
  private async executeStage3(
    projectId: string,
    episodeId: string,
    context: AgentContext
  ): Promise<{
    storyboardCount: number
    panelCount: number
    voiceLineCount: number
    hasStoryboard: boolean
  }> {
    // 创建 script-to-storyboard GraphRun
    const run = await createRun({
      userId: context.userId,
      projectId,
      episodeId,
      workflowType: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
      taskType: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
      targetType: 'episode',
      targetId: episodeId,
      input: {},
    })

    // 等待 Run 完成
    await this.waitForRunCompletion(run.id, 600000) // 10 分钟超时

    // 验证结果
    const episode = await prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      include: {
        storyboards: {
          include: {
            panels: true,
          },
        },
        voiceLines: true,
      },
    })

    const readiness = resolveEpisodeStageArtifacts(episode)

    const panelCount = episode?.storyboards.reduce(
      (sum, sb) => sum + (sb.panels?.length || 0),
      0
    ) || 0

    return {
      storyboardCount: episode?.storyboards.length || 0,
      panelCount,
      voiceLineCount: episode?.voiceLines.length || 0,
      hasStoryboard: readiness.hasStoryboard,
    }
  }

  /**
   * 等待 Run 完成
   */
  private async waitForRunCompletion(runId: string, timeoutMs: number): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 2000 // 2 秒轮询一次

    while (Date.now() - startTime < timeoutMs) {
      const run = await prisma.graphRun.findUnique({
        where: { id: runId },
      })

      if (!run) {
        throw new Error(`Run not found: ${runId}`)
      }

      if (run.status === 'completed') {
        return
      }

      if (run.status === 'failed') {
        throw new Error(`Run failed: ${run.errorMessage || 'Unknown error'}`)
      }

      // 等待后继续轮询
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    throw new Error(`Run timeout after ${timeoutMs}ms`)
  }

  /**
   * 使用 LLM 分析用户输入
   */
  private async analyzeUserInput(context: AgentContext): Promise<LLMAnalysisResult> {
    const systemPrompt = `你是 NoriVideo 的 AI 助手。分析用户需求，提取关键信息。

可用的视频类型：
- digital-avatar-ad: 数字人口播（产品介绍、品牌宣传）
- travel-master: 旅拍大师（旅游vlog、风景展示）
- product-promo: 商品宣传短片（电商、产品展示）
- food-documentary: 舌尖美食（美食展示、餐厅宣传）
- music-mv: 音乐MV（歌曲MV、音乐宣传）
- generic: 通用视频制作

请分析用户输入，返回 JSON 格式（只返回 JSON，不要其他内容）：
{
  "videoType": "digital-avatar-ad",
  "storyText": "用户提供的故事文本或从输入中提取的内容",
  "videoRatio": "9:16",
  "visualStyle": "写实摄影风格",
  "projectName": "自动生成的项目名",
  "episodeName": "第1集",
  "language": "zh",
  "confidence": 0.95
}

规则：
1. 如果用户明确提供了故事文本，使用原文
2. 如果用户只描述需求，生成一个简短的故事大纲
3. videoRatio 默认 9:16（竖屏），除非用户明确要求横屏
4. projectName 要简洁有意义
5. confidence 表示识别的置信度（0-1）`

    const userPrompt = context.userInput

    const response = await llmClient.callLLM(context.userId, systemPrompt, userPrompt)

    // 解析 JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Failed to parse LLM response as JSON')
    }

    const analysis = JSON.parse(jsonMatch[0]) as LLMAnalysisResult

    // 验证必填字段
    if (!analysis.videoType || !analysis.storyText) {
      throw new Error('Invalid analysis result: missing required fields')
    }

    return analysis
  }

  /**
   * 生成摘要
   */
  private generateSummary(
    stage2Result: { characterCount: number; locationCount: number; clipCount: number },
    stage3Result: { storyboardCount: number; panelCount: number; voiceLineCount: number }
  ): string {
    return `已完成项目初始化和内容生成：
- 发现 ${stage2Result.characterCount} 个角色
- 发现 ${stage2Result.locationCount} 个场景
- 生成 ${stage2Result.clipCount} 个片段
- 生成 ${stage3Result.storyboardCount} 个分镜板
- 生成 ${stage3Result.panelCount} 个分镜格
- 生成 ${stage3Result.voiceLineCount} 条配音行

你现在可以在工作区中查看和编辑所有内容。`
  }
}
