import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn() },
}))
const extractionMock = vi.hoisted(() => vi.fn())
const persistMock = vi.hoisted(() => vi.fn())
const createArtifactMock = vi.hoisted(() => vi.fn())
const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: 'configured-model' })),
}))
vi.mock('@/lib/novel-promotion/asset-extraction', () => ({
  executeAssetExtraction: extractionMock,
}))
vi.mock('@/lib/novel-promotion/project-import-pipeline', () => ({
  persistAssetExtractionPackage: persistMock,
}))
vi.mock('@/lib/run-runtime/service', () => ({ createArtifact: createArtifactMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: assertTaskActiveMock }))

import { handleAssetExtractionTask } from '@/lib/workers/handlers/asset-extraction'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'asset-task-1',
      type: TASK_TYPE.ASSET_EXTRACTION_RUN,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'NovelPromotionProject',
      targetId: 'project-1',
      payload: {
        analysisModel: 'nori-gpt',
        persist: true,
        clearExisting: true,
        runId: 'run-1',
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('asset extraction worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'novel-project-1',
      artStylePrompt: 'cinematic',
      episodes: [{
        episodeNumber: 1,
        name: '第一集',
        description: null,
        novelText: '人物：苏晚卿。场景：柴房。道具：油灯。',
      }],
    })
    const pkg = {
      version: 'asset-extraction-v1',
      worldBackground: 'world',
      characters: [{ id: 'c1' }],
      environments: [{ id: 'e1' }],
      props: [{ id: 'p1' }],
      warnings: [],
    }
    extractionMock.mockImplementation(async (input: {
      onProgress?: (event: Record<string, unknown>) => Promise<void>
    }) => {
      await input.onProgress?.({
        phase: 'extract',
        completed: 1,
        total: 1,
        completedEpisodes: 1,
        totalEpisodes: 1,
        characters: 1,
        environments: 1,
        props: 1,
      })
      await input.onProgress?.({
        phase: 'merge',
        completed: 1,
        total: 1,
        completedEpisodes: 1,
        totalEpisodes: 1,
        characters: 1,
        environments: 1,
        props: 1,
      })
      return {
        package: pkg,
        rawText: '{}',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }
    })
    persistMock.mockResolvedValue({ characters: 1, environments: 1, props: 1 })
    createArtifactMock.mockResolvedValue({ id: 'artifact-1', runId: 'run-1' })
  })

  it('reports durable progress, persists atomically, and returns count and token results', async () => {
    const result = await handleAssetExtractionTask(buildJob())

    expect(extractionMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'nori-gpt',
      batchConcurrency: 1,
    }))
    expect(persistMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      clearExisting: true,
    }))
    expect(createArtifactMock).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      artifactType: 'asset_extraction.package',
    }))
    expect(reportTaskProgressMock).toHaveBeenCalledWith(
      expect.anything(),
      97,
      expect.objectContaining({ stage: 'asset_extraction_done' }),
    )
    expect(assertTaskActiveMock).toHaveBeenCalled()
    expect(result).toEqual({
      assets: { characters: 1, environments: 1, props: 1 },
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      model: 'nori-gpt',
    })
  })
})
