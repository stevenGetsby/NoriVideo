import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getProjectModelConfig } from '@/lib/config-service'
import { createArtifact } from '@/lib/run-runtime/service'
import type { TaskJobData } from '@/lib/task/types'
import {
  executeAssetExtraction,
  type AssetExtractionProgressEvent,
} from '@/lib/novel-promotion/asset-extraction'
import { persistAssetExtractionPackage } from '@/lib/novel-promotion/project-import-pipeline'
import { reportTaskProgress } from '../shared'
import { assertTaskActive } from '../utils'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assetTotal(event: AssetExtractionProgressEvent) {
  return event.characters + event.environments + event.props
}

function estimateRemainingSeconds(startedAt: number, progress: number): number | null {
  if (progress < 8 || progress >= 100) return null
  const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000)
  const estimate = Math.ceil((elapsedSeconds / progress) * (100 - progress))
  return Math.max(5, Math.min(7_200, estimate))
}

function progressForEvent(event: AssetExtractionProgressEvent) {
  if (event.phase === 'extract') {
    return 15 + Math.floor((event.completed / Math.max(1, event.total)) * 40)
  }
  if (event.phase === 'merge') return 60
  return 62 + Math.floor((event.completed / Math.max(1, event.total)) * 24)
}

function stageForEvent(event: AssetExtractionProgressEvent) {
  if (event.phase === 'extract') return 'asset_extraction_analyze'
  if (event.phase === 'merge') return 'asset_extraction_merge'
  return 'asset_extraction_refine'
}

export async function handleAssetExtractionTask(job: Job<TaskJobData>) {
  const payload = toObject(job.data.payload)
  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId: job.data.projectId },
    select: {
      id: true,
      artStylePrompt: true,
      episodes: {
        orderBy: { episodeNumber: 'asc' },
        select: {
          episodeNumber: true,
          name: true,
          description: true,
          novelText: true,
        },
      },
    },
  })
  if (!novelData) throw new Error('Novel promotion project not found')

  const episodes = novelData.episodes
    .map((episode) => ({
      episodeNumber: episode.episodeNumber,
      title: episode.name || `第${episode.episodeNumber}集`,
      sourceText: readString(episode.novelText) || readString(episode.description),
    }))
    .filter((episode) => Boolean(episode.sourceText))
  if (episodes.length === 0) throw new Error('没有可解析的剧本文本')

  const configuredModel = readString(payload.analysisModel) || readString(payload.model)
  const model = configuredModel || (await getProjectModelConfig(
    job.data.projectId,
    job.data.userId,
  )).analysisModel
  if (!model) throw new Error('请先配置资产解析文本模型')

  const startedAt = Date.now()
  await reportTaskProgress(job, 10, {
    stage: 'asset_extraction_prepare',
    stageLabel: 'progress.stage.assetExtractionPrepare',
    message: '正在读取项目剧本',
    progressDetails: {
      completed: 0,
      total: episodes.length,
      unit: '集剧本',
      episodeCompleted: 0,
      episodeTotal: episodes.length,
      assetCompleted: 0,
      assetTotal: null,
      estimatedRemainingSeconds: null,
    },
  })
  await assertTaskActive(job, 'asset_extraction_prepare')

  const extraction = await executeAssetExtraction({
    userId: job.data.userId,
    projectId: job.data.projectId,
    model,
    episodes,
    batchConcurrency: 1,
    onProgress: async (event) => {
      const progress = progressForEvent(event)
      const totalAssets = assetTotal(event)
      await assertTaskActive(job, stageForEvent(event))
      await reportTaskProgress(job, progress, {
        stage: stageForEvent(event),
        stageLabel: `progress.stage.${event.phase === 'extract'
          ? 'assetExtractionAnalyze'
          : event.phase === 'merge'
            ? 'assetExtractionMerge'
            : 'assetExtractionRefine'}`,
        message: event.phase === 'extract'
          ? `已分析 ${event.completedEpisodes}/${event.totalEpisodes} 集剧本`
          : event.phase === 'merge'
            ? `已识别 ${totalAssets} 个资产，正在合并校验`
            : `正在完善角色视觉设定 ${event.completed}/${event.total}`,
        progressDetails: {
          completed: event.phase === 'extract' ? event.completedEpisodes : totalAssets,
          total: event.phase === 'extract' ? event.totalEpisodes : totalAssets,
          unit: event.phase === 'extract' ? '集剧本' : '个资产',
          episodeCompleted: event.completedEpisodes,
          episodeTotal: event.totalEpisodes,
          assetCompleted: totalAssets,
          assetTotal: event.phase === 'extract' ? null : totalAssets,
          refineCompleted: event.phase === 'refine' ? event.completed : 0,
          refineTotal: event.phase === 'refine' ? event.total : event.characters,
          characters: event.characters,
          environments: event.environments,
          props: event.props,
          estimatedRemainingSeconds: estimateRemainingSeconds(startedAt, progress),
        },
      })
    },
  })

  const counts = {
    characters: extraction.package.characters.length,
    environments: extraction.package.environments.length,
    props: extraction.package.props.length,
  }
  const totalAssets = counts.characters + counts.environments + counts.props
  await assertTaskActive(job, 'asset_extraction_persist')
  await reportTaskProgress(job, 90, {
    stage: 'asset_extraction_persist',
    stageLabel: 'progress.stage.assetExtractionPersist',
    message: `正在保存 ${totalAssets} 个项目资产`,
    progressDetails: {
      completed: totalAssets,
      total: totalAssets,
      unit: '个资产',
      episodeCompleted: episodes.length,
      episodeTotal: episodes.length,
      assetCompleted: totalAssets,
      assetTotal: totalAssets,
      ...counts,
      estimatedRemainingSeconds: estimateRemainingSeconds(startedAt, 90),
    },
  })

  const persistedAssets = payload.persist === false
    ? counts
    : await persistAssetExtractionPackage({
      projectId: job.data.projectId,
      package: extraction.package,
      clearExisting: payload.clearExisting !== false,
      artStylePrompt: readString(novelData.artStylePrompt),
    })

  const runId = readString(payload.runId) || readString(toObject(payload.meta).runId)
  if (runId) {
    await createArtifact({
      runId,
      stepKey: 'asset_extraction',
      artifactType: 'asset_extraction.package',
      refId: job.data.projectId,
      payload: extraction.package as unknown as Record<string, unknown>,
    })
  }

  await reportTaskProgress(job, 97, {
    stage: 'asset_extraction_done',
    stageLabel: 'progress.stage.assetExtractionDone',
    message: `资产解析完成：${persistedAssets.characters} 个角色、${persistedAssets.environments} 个环境、${persistedAssets.props} 个物品`,
    progressDetails: {
      completed: totalAssets,
      total: totalAssets,
      unit: '个资产',
      episodeCompleted: episodes.length,
      episodeTotal: episodes.length,
      assetCompleted: totalAssets,
      assetTotal: totalAssets,
      ...persistedAssets,
      estimatedRemainingSeconds: 0,
    },
  })

  return {
    assets: persistedAssets,
    usage: extraction.usage,
    model,
  }
}
