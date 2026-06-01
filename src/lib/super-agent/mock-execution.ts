import { prisma } from '@/lib/prisma'
import type { AgentExecutionPlan } from './types'

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value as number)))
}

function summarizeStory(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return '智能创作流程验证内容'
  return Array.from(compact).slice(0, 80).join('')
}

function buildShotSummary(plan: AgentExecutionPlan, index: number): string {
  const sellingPoints = plan.creativeParameters.sellingPoints?.trim()
  const tone = plan.creativeParameters.tone?.trim()
  const base = summarizeStory(plan.episodeConfig.novelText)
  return [
    `镜头 ${index + 1}`,
    tone ? `语气：${tone}` : null,
    sellingPoints ? `卖点：${sellingPoints}` : null,
    base,
  ].filter(Boolean).join('，')
}

export async function createMockScriptArtifacts(input: {
  projectId: string
  episodeId: string
  plan: AgentExecutionPlan
}) {
  const { projectId, episodeId, plan } = input
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!project) throw new Error(`NovelPromotionProject not found: ${projectId}`)

  const shotCount = clampInteger(plan.creativeParameters.shotCount, 1, 12, 3)
  const duration = clampInteger(plan.creativeParameters.durationSeconds, 5, 300, 30)
  const clipDuration = Math.max(1, Math.round(duration / shotCount))

  const [character, location] = await Promise.all([
    prisma.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: project.id,
        name: plan.creativeParameters.targetAudience ? '目标用户代表' : '主角',
        aliases: JSON.stringify(['主角']),
        introduction: plan.creativeParameters.targetAudience
          ? `面向 ${plan.creativeParameters.targetAudience} 的核心表达者`
          : '承载故事推进与口播表达的核心人物',
        profileData: JSON.stringify({
          source: 'super-agent-mock',
          tone: plan.creativeParameters.tone || '自然',
        }),
        profileConfirmed: true,
      },
    }),
    prisma.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: project.id,
        name: '核心创作场景',
        summary: plan.projectConfig.artStylePrompt || plan.creativeParameters.mockPrompt || '用于验证智能创作流程的基础场景',
      },
    }),
  ])

  const clips = []
  for (let index = 0; index < shotCount; index += 1) {
    const start = index * clipDuration
    const end = index === shotCount - 1 ? duration : start + clipDuration
    const summary = buildShotSummary(plan, index)
    const clip = await prisma.novelPromotionClip.create({
      data: {
        episodeId,
        start,
        end,
        duration: end - start,
        summary,
        location: location.name,
        content: `${summary}。${plan.creativeParameters.callToAction || '保持画面信息清晰可编辑。'}`,
        characters: character.name,
        props: plan.creativeParameters.sellingPoints || null,
        startText: `第 ${index + 1} 段开始`,
        endText: `第 ${index + 1} 段结束`,
        shotCount: 1,
        screenplay: `【${location.name}】${character.name} 以${plan.creativeParameters.tone || '自然'}语气呈现：${summary}`,
      },
    })
    clips.push(clip)
  }

  return {
    characterCount: 1,
    locationCount: 1,
    clipCount: clips.length,
    hasScript: clips.length > 0,
  }
}

export async function createMockStoryboardArtifacts(input: {
  episodeId: string
  plan: AgentExecutionPlan
}) {
  const { episodeId, plan } = input
  const panelsPerShot = clampInteger(plan.creativeParameters.panelsPerShot, 1, 8, 3)
  const shouldCreateVoiceLines = plan.creativeParameters.narration !== 'off'
  const clips = await prisma.novelPromotionClip.findMany({
    where: { episodeId },
    orderBy: { start: 'asc' },
  })

  let panelCount = 0
  let voiceLineCount = 0
  for (const clip of clips) {
    const storyboard = await prisma.novelPromotionStoryboard.create({
      data: {
        episodeId,
        clipId: clip.id,
        panelCount: panelsPerShot,
        storyboardTextJson: JSON.stringify({
          source: 'super-agent-mock',
          summary: clip.summary,
        }),
        photographyPlan: plan.projectConfig.artStylePrompt || plan.creativeParameters.mockPrompt,
      },
    })

    for (let panelIndex = 0; panelIndex < panelsPerShot; panelIndex += 1) {
      const panelNumber = panelCount + 1
      await prisma.novelPromotionPanel.create({
        data: {
          storyboardId: storyboard.id,
          panelIndex,
          panelNumber,
          shotType: panelIndex === 0 ? '建立镜头' : panelIndex === panelsPerShot - 1 ? '特写镜头' : '中景',
          cameraMove: panelIndex % 2 === 0 ? '缓慢推进' : '稳定跟拍',
          description: `${clip.summary} - 画面 ${panelIndex + 1}`,
          location: clip.location,
          characters: clip.characters,
          props: clip.props,
          duration: Math.max(1, Math.round((clip.duration || 3) / panelsPerShot)),
          imagePrompt: [
            plan.creativeParameters.mockPrompt,
            plan.projectConfig.artStylePrompt,
            `画面：${clip.summary}`,
            `比例：${plan.projectConfig.videoRatio}`,
          ].filter(Boolean).join('\n'),
          videoPrompt: `根据分镜 ${panelNumber} 生成 ${plan.projectConfig.videoRatio} 视频片段：${clip.summary}`,
          photographyRules: plan.projectConfig.artStylePrompt,
          actingNotes: JSON.stringify({
            source: 'super-agent-mock',
            tone: plan.creativeParameters.tone || '自然',
          }),
        },
      })
      panelCount += 1
    }

    if (shouldCreateVoiceLines) {
      await prisma.novelPromotionVoiceLine.create({
        data: {
          episodeId,
          lineIndex: voiceLineCount,
          speaker: clip.characters || '旁白',
          content: `${clip.summary}。${plan.creativeParameters.callToAction || ''}`.trim(),
          emotionPrompt: plan.creativeParameters.tone || '自然、有节奏',
          emotionStrength: 0.4,
        },
      })
      voiceLineCount += 1
    }
  }

  return {
    storyboardCount: clips.length,
    panelCount,
    voiceLineCount,
    hasStoryboard: panelCount > 0,
  }
}
