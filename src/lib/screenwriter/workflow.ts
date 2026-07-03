import { prisma } from '@/lib/prisma'
import { countWords } from './dto'
import { VIDEO_REPAINT_STAGE, VIDEO_REPAINT_STAGE_STATUS } from './types'
import type { Prisma } from '@prisma/client'

type JsonValue = Prisma.InputJsonValue

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function splitSourceScript(text: string) {
  const normalized = text.trim()
  if (!normalized) return ['']
  const matches = Array.from(normalized.matchAll(/(?:^|\n)(第[一二三四五六七八九十百千万0-9]+集[^\n]*)/g))
  if (matches.length <= 1) return [normalized]

  return matches.map((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? normalized.length
    return normalized.slice(start, end).trim()
  }).filter(Boolean)
}

async function readSourceScriptText(screenwriterTaskId: string) {
  const artifact = await prisma.screenwriterArtifact.findFirst({
    where: {
      screenwriterTaskId,
      stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
      artifactType: 'source_script_raw',
      refId: 'source-script',
    },
    orderBy: { version: 'desc' },
  })
  const payload = toObject(artifact?.payload)
  return readString(payload.sourceScriptText)
}

export async function completeAutoSplitMockStage(params: {
  screenwriterTaskId: string
  workerTaskId: string
}) {
  const task = await prisma.screenwriterTask.findUnique({
    where: { id: params.screenwriterTaskId },
    select: { id: true, currentStage: true, currentStageStatus: true },
  })
  if (!task) throw new Error('SCREENWRITER_TASK_NOT_FOUND')
  const existing = await prisma.screenwriterScriptEpisode.findMany({
    where: {
      screenwriterTaskId: params.screenwriterTaskId,
      scriptKind: 'source',
    },
    select: { id: true },
    take: 1,
  })
  if (existing.length > 0 && task.currentStage !== VIDEO_REPAINT_STAGE.AUTO_SPLIT) {
    return { skipped: true }
  }

  const sourceScriptText = await readSourceScriptText(params.screenwriterTaskId)
  const episodes = splitSourceScript(sourceScriptText)
  await prisma.$transaction(async (tx) => {
    await tx.screenwriterStageState.update({
      where: {
        screenwriterTaskId_stageKey: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
        },
      },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.SUCCEEDED,
        progress: 100,
        workerTaskId: params.workerTaskId,
        finishedAt: new Date(),
      },
    })
    for (let index = 0; index < episodes.length; index += 1) {
      const content = episodes[index] || sourceScriptText
      await tx.screenwriterScriptEpisode.upsert({
        where: {
          screenwriterTaskId_scriptKind_episodeNumber_version: {
            screenwriterTaskId: params.screenwriterTaskId,
            scriptKind: 'source',
            episodeNumber: index + 1,
            version: 1,
          },
        },
        update: {
          title: `源剧本 第 ${index + 1} 集`,
          content,
          wordCount: countWords(content),
          status: 'succeeded',
        },
        create: {
          screenwriterTaskId: params.screenwriterTaskId,
          scriptKind: 'source',
          episodeNumber: index + 1,
          title: `源剧本 第 ${index + 1} 集`,
          content,
          wordCount: countWords(content),
          status: 'succeeded',
          version: 1,
        },
      })
    }
    await tx.screenwriterArtifact.upsert({
      where: {
        screenwriterTaskId_stageKey_artifactType_refId_version: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
          artifactType: 'auto_split_result',
          refId: 'episodes',
          version: 1,
        },
      },
      update: {
        payload: { episodeCount: episodes.length, episodes } as JsonValue,
      },
      create: {
        screenwriterTaskId: params.screenwriterTaskId,
        stageKey: VIDEO_REPAINT_STAGE.AUTO_SPLIT,
        artifactType: 'auto_split_result',
        refId: 'episodes',
        payload: { episodeCount: episodes.length, episodes } as JsonValue,
        version: 1,
      },
    })
    await tx.screenwriterStageState.update({
      where: {
        screenwriterTaskId_stageKey: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.FACT_EXTRACT,
        },
      },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.RUNNING,
        progress: 5,
        startedAt: new Date(),
        finishedAt: null,
      },
    })
    await tx.screenwriterTask.update({
      where: { id: params.screenwriterTaskId },
      data: {
        episodeCount: episodes.length,
        currentStage: VIDEO_REPAINT_STAGE.FACT_EXTRACT,
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.RUNNING,
      },
    })
  })
  return { skipped: false, episodeCount: episodes.length }
}

export async function completeFactExtractMockStage(params: {
  screenwriterTaskId: string
  workerTaskId: string
}) {
  const sourceEpisodes = await prisma.screenwriterScriptEpisode.findMany({
    where: {
      screenwriterTaskId: params.screenwriterTaskId,
      scriptKind: 'source',
    },
    orderBy: { episodeNumber: 'asc' },
  })
  const factCards = sourceEpisodes.map((episode) => ({
    episodeNumber: episode.episodeNumber,
    facts: [
      `源剧本标题：${episode.title}`,
      `字数：${episode.wordCount}`,
      'Mock事实卡：主角面对旧秩序并推进目标。',
    ],
  }))

  await prisma.$transaction(async (tx) => {
    await tx.screenwriterArtifact.upsert({
      where: {
        screenwriterTaskId_stageKey_artifactType_refId_version: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.FACT_EXTRACT,
          artifactType: 'episode_fact_cards',
          refId: 'all',
          version: 1,
        },
      },
      update: { payload: { factCards } as JsonValue },
      create: {
        screenwriterTaskId: params.screenwriterTaskId,
        stageKey: VIDEO_REPAINT_STAGE.FACT_EXTRACT,
        artifactType: 'episode_fact_cards',
        refId: 'all',
        payload: { factCards } as JsonValue,
        version: 1,
      },
    })
    await tx.screenwriterStageState.update({
      where: {
        screenwriterTaskId_stageKey: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.FACT_EXTRACT,
        },
      },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.SUCCEEDED,
        progress: 100,
        workerTaskId: params.workerTaskId,
        finishedAt: new Date(),
      },
    })
    await tx.screenwriterSettingsReview.upsert({
      where: {
        screenwriterTaskId_stageKey_version: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.SOURCE_SETTINGS,
          version: 1,
        },
      },
      update: {
        status: 'waiting_check',
        bodySections: [
          { heading: '人物与关系', body: 'Mock源设定：主角、团队和旧项目构成核心冲突。' },
          { heading: '世界观与风格', body: 'Mock源设定：职场压力、项目危机和逆袭节奏。' },
        ],
        nameIndexGroups: [
          {
            title: '统一名索引',
            rows: [{ sourceName: '女主', targetName: '女主', description: '核心行动者' }],
          },
        ],
      },
      create: {
        screenwriterTaskId: params.screenwriterTaskId,
        stageKey: VIDEO_REPAINT_STAGE.SOURCE_SETTINGS,
        checkpoint: 'A',
        version: 1,
        status: 'waiting_check',
        outlineTitle: '源设定总纲',
        bodySections: [
          { heading: '人物与关系', body: 'Mock源设定：主角、团队和旧项目构成核心冲突。' },
          { heading: '世界观与风格', body: 'Mock源设定：职场压力、项目危机和逆袭节奏。' },
        ],
        collapsedPanelTitle: '统一名索引',
        nameIndexGroups: [
          {
            title: '统一名索引',
            rows: [{ sourceName: '女主', targetName: '女主', description: '核心行动者' }],
          },
        ],
        issues: [],
        feedbackPlaceholder: '补充需要重新提炼的要求',
      },
    })
    await tx.screenwriterStageState.update({
      where: {
        screenwriterTaskId_stageKey: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.SOURCE_SETTINGS,
        },
      },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.WAITING_CHECK,
        progress: 100,
        workerTaskId: params.workerTaskId,
        finishedAt: new Date(),
      },
    })
    await tx.screenwriterTask.update({
      where: { id: params.screenwriterTaskId },
      data: {
        currentStage: VIDEO_REPAINT_STAGE.SOURCE_SETTINGS,
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.WAITING_CHECK,
      },
    })
  })
  return { skipped: false, factCardCount: factCards.length }
}

export async function completeTargetSettingsMockStage(params: {
  screenwriterTaskId: string
  workerTaskId: string
}) {
  const task = await prisma.screenwriterTask.findUnique({
    where: { id: params.screenwriterTaskId },
    select: { requirement: true },
  })
  if (!task) throw new Error('SCREENWRITER_TASK_NOT_FOUND')

  await prisma.$transaction(async (tx) => {
    await tx.screenwriterSettingsReview.upsert({
      where: {
        screenwriterTaskId_stageKey_version: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.TARGET_SETTINGS,
          version: 1,
        },
      },
      update: {
        status: 'waiting_check',
        bodySections: [
          { heading: '目标类型', body: `Mock目标设定：${task.requirement}` },
          { heading: '改写策略', body: '保留核心事实卡，替换人物动机、场景表达和节奏钩子。' },
        ],
      },
      create: {
        screenwriterTaskId: params.screenwriterTaskId,
        stageKey: VIDEO_REPAINT_STAGE.TARGET_SETTINGS,
        checkpoint: 'B',
        version: 1,
        status: 'waiting_check',
        outlineTitle: '目标设定总纲',
        bodySections: [
          { heading: '目标类型', body: `Mock目标设定：${task.requirement}` },
          { heading: '改写策略', body: '保留核心事实卡，替换人物动机、场景表达和节奏钩子。' },
        ],
        collapsedPanelTitle: '映射关系',
        mappingGroups: [
          {
            title: '源目标映射',
            rows: [{ sourceName: '女主', targetName: '海外职场女主', description: task.requirement }],
          },
        ],
        issues: [],
        feedbackPlaceholder: '补充需要重新生成的要求',
      },
    })
    await tx.screenwriterStageState.update({
      where: {
        screenwriterTaskId_stageKey: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.TARGET_SETTINGS,
        },
      },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.WAITING_CHECK,
        progress: 100,
        workerTaskId: params.workerTaskId,
        finishedAt: new Date(),
      },
    })
    await tx.screenwriterTask.update({
      where: { id: params.screenwriterTaskId },
      data: {
        currentStage: VIDEO_REPAINT_STAGE.TARGET_SETTINGS,
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.WAITING_CHECK,
      },
    })
  })
  return { skipped: false }
}

export async function completeEpisodeRepaintMockStage(params: {
  screenwriterTaskId: string
  workerTaskId: string
}) {
  const task = await prisma.screenwriterTask.findUnique({
    where: { id: params.screenwriterTaskId },
    select: { requirement: true },
  })
  if (!task) throw new Error('SCREENWRITER_TASK_NOT_FOUND')
  const sourceEpisodes = await prisma.screenwriterScriptEpisode.findMany({
    where: {
      screenwriterTaskId: params.screenwriterTaskId,
      scriptKind: 'source',
    },
    orderBy: { episodeNumber: 'asc' },
  })
  const episodes = sourceEpisodes.length > 0
    ? sourceEpisodes
    : [{ episodeNumber: 1, title: '源剧本 第 1 集', content: await readSourceScriptText(params.screenwriterTaskId) }]

  await prisma.$transaction(async (tx) => {
    await tx.screenwriterStageState.update({
      where: {
        screenwriterTaskId_stageKey: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.EPISODE_REPAINT,
        },
      },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.RUNNING,
        progress: 30,
        workerTaskId: params.workerTaskId,
        startedAt: new Date(),
      },
    })
    for (const episode of episodes) {
      const content = [
        `# 目标剧本 第 ${episode.episodeNumber} 集`,
        '',
        `改写方向：${task.requirement}`,
        '',
        'Mock目标剧本：海外职场复仇短剧版本。',
        '',
        episode.content,
      ].join('\n')
      const target = await tx.screenwriterScriptEpisode.upsert({
        where: {
          screenwriterTaskId_scriptKind_episodeNumber_version: {
            screenwriterTaskId: params.screenwriterTaskId,
            scriptKind: 'target',
            episodeNumber: episode.episodeNumber,
            version: 1,
          },
        },
        update: {
          title: `目标剧本 第 ${episode.episodeNumber} 集`,
          content,
          wordCount: countWords(content),
          status: 'succeeded',
        },
        create: {
          screenwriterTaskId: params.screenwriterTaskId,
          scriptKind: 'target',
          episodeNumber: episode.episodeNumber,
          title: `目标剧本 第 ${episode.episodeNumber} 集`,
          content,
          wordCount: countWords(content),
          status: 'succeeded',
          version: 1,
        },
      })
      await tx.screenwriterEpisodeProcess.upsert({
        where: {
          screenwriterTaskId_stageKey_episodeNumber: {
            screenwriterTaskId: params.screenwriterTaskId,
            stageKey: VIDEO_REPAINT_STAGE.EPISODE_REPAINT,
            episodeNumber: episode.episodeNumber,
          },
        },
        update: {
          status: 'succeeded',
          progress: 100,
          workerTaskId: params.workerTaskId,
          targetEpisodeId: target.id,
          finishedAt: new Date(),
        },
        create: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.EPISODE_REPAINT,
          episodeNumber: episode.episodeNumber,
          status: 'succeeded',
          progress: 100,
          workerTaskId: params.workerTaskId,
          targetEpisodeId: target.id,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      })
    }
    await tx.screenwriterStageState.update({
      where: {
        screenwriterTaskId_stageKey: {
          screenwriterTaskId: params.screenwriterTaskId,
          stageKey: VIDEO_REPAINT_STAGE.EPISODE_REPAINT,
        },
      },
      data: {
        status: VIDEO_REPAINT_STAGE_STATUS.SUCCEEDED,
        progress: 100,
        workerTaskId: params.workerTaskId,
        finishedAt: new Date(),
      },
    })
    await tx.screenwriterTask.update({
      where: { id: params.screenwriterTaskId },
      data: {
        currentStage: 'target_script',
        currentStageStatus: VIDEO_REPAINT_STAGE_STATUS.SUCCEEDED,
        status: 'available',
      },
    })
  })
  return { skipped: false, episodeCount: episodes.length }
}
